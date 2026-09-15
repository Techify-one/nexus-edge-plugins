import { Hono, type Context } from "hono";
import { createDatabase } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
  PluginPublicContext,
} from "@nexus/plugin-sdk/backend";
import { z } from "zod";
import type { AsaasEnv } from "./env.js";
import {
  AsaasApiError,
  PIX_KEY_TYPES,
  createPixTransfer,
  getBalance,
  getPersonalAccount,
  getStatement,
  getTransfer,
  inspectPixKey,
  maskPixKey,
  normalizePixKey,
  parseValueCents,
  validateProductionApiKey,
} from "./asaas-client.js";
import { PixTransferRepository, type PixTransferRecord } from "./repository.js";
import {
  decideWithdrawalAuthorization,
  parseWithdrawalPayload,
  pixKeyHash,
  secureTokenMatches,
} from "./withdrawal-authorization.js";

const app = new Hono<AsaasEnv>();
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,120}$/u;

const pixInput = z.object({
  value: z.union([z.string(), z.number()]),
  pixAddressKey: z.string().trim().min(3).max(254),
  pixAddressKeyType: z.enum(PIX_KEY_TYPES),
  description: z.string().trim().max(120).optional(),
  confirmed: z.literal(true),
});

const connectionInput = z.object({
  apiKey: z.string().trim().min(20).max(8192),
});

const inspectPixKeyInput = z.object({
  pixAddressKey: z.string().trim().min(3).max(254),
  pixAddressKeyType: z.enum(PIX_KEY_TYPES),
});

const repository = (c: Context<AsaasEnv>) =>
  new PixTransferRepository(c.get("db"));

const requirePermission = (
  c: Context<AsaasEnv>,
  permission: string,
): PluginContext => {
  const context = c.get("pluginContext");
  if (!context?.permissions.includes(permission))
    throw new AsaasApiError("FORBIDDEN", "Permission denied.", 403);
  return context;
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const parseInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new AsaasApiError(
      "VALIDATION_ERROR",
      "Invalid pagination value.",
      422,
    );
  return parsed;
};

app.get("/health", (c) =>
  c.json({ ok: true, plugin: "asaas", version: "1.1.0" }),
);

app.use("/*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const encoded = {
    user: c.req.header("X-Plugin-Context"),
    public: c.req.header("X-Plugin-Public-Context"),
    installer: c.req.header("X-Plugin-Installer-Context"),
  };
  if (Object.values(encoded).filter(Boolean).length !== 1)
    return c.json(
      {
        error: {
          code: "MISSING_PLUGIN_CONTEXT",
          message: "Internal context required",
        },
      },
      401,
    );
  try {
    const value = encoded.user ?? encoded.public ?? encoded.installer!;
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const context = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as PluginContext | PluginPublicContext | PluginInstallerContext;
    if (encoded.user) {
      if (
        !("userId" in context) ||
        !context.userId ||
        !context.requestId ||
        !Array.isArray(context.permissions)
      )
        throw new Error("invalid context");
      c.set("pluginContext", context);
    } else if (encoded.public) {
      if (
        !("pluginId" in context) ||
        context.pluginId !== "asaas" ||
        !context.requestId
      )
        throw new Error("invalid public context");
      c.set("publicContext", context);
    } else {
      if (
        !("operationId" in context) ||
        context.pluginId !== "asaas" ||
        !context.operationId ||
        !context.requestId
      )
        throw new Error("invalid installer context");
      c.set("installerContext", context);
    }
  } catch {
    return c.json(
      {
        error: {
          code: "INVALID_PLUGIN_CONTEXT",
          message: "Internal context is invalid",
        },
      },
      401,
    );
  }
  const db = await createDatabase(c.env);
  c.set("db", db);
  try {
    await next();
  } finally {
    await db.close();
  }
});

app.post("/__installer/smoke", async (c) => {
  const installer = c.get("installerContext");
  if (!installer)
    return c.json(
      {
        error: {
          code: "INSTALLER_CONTEXT_REQUIRED",
          message: "Installer context required",
        },
      },
      403,
    );
  const key = `smoke-${crypto.randomUUID()}`;
  const { record } = await repository(c).begin({
    idempotencyKey: key,
    requestHash: await sha256(key),
    pixKeyType: "EVP",
    pixKeyMasked: "installer-smoke",
    pixKeyHash: await pixKeyHash("EVP", "00000000-0000-4000-8000-000000000000"),
    valueCents: 1,
    description: "Installer smoke",
    userId: installer.operationId,
  });
  const created = await repository(c).get(record.id);
  await c
    .get("db")
    .execute("DELETE FROM asaas_pix_transfers WHERE id = ?", [record.id]);
  return created?.id === record.id
    ? c.json({ ok: true, read: true, write: true })
    : c.json({ ok: false }, 500);
});

export const asaasRoutes = new Hono<AsaasEnv>()
  .get("/balance", async (c) => {
    requirePermission(c, "asaas.balance.read");
    return c.json({
      ...(await getBalance(c.env)),
      updatedAt: new Date().toISOString(),
    });
  })
  .get("/statement", async (c) => {
    requirePermission(c, "asaas.statement.read");
    const startDate = c.req.query("startDate") ?? "";
    const finishDate = c.req.query("finishDate") ?? "";
    return c.json(
      await getStatement(c.env, {
        startDate,
        finishDate,
        offset: parseInteger(c.req.query("offset"), 0, 0, 1_000_000),
        limit: parseInteger(c.req.query("limit"), 50, 1, 100),
        order: c.req.query("order") === "asc" ? "asc" : "desc",
      }),
    );
  })
  .post("/connection/validate", async (c) => {
    requirePermission(c, "asaas.settings.update");
    const { apiKey } = connectionInput.parse(await c.req.json());
    validateProductionApiKey(apiKey);
    await getPersonalAccount(c.env, apiKey);
    const balance = await getBalance(c.env, apiKey);
    return c.json({ ok: true, personType: "FISICA", balance: balance.balance });
  })
  .get("/connection", async (c) => {
    requirePermission(c, "asaas.settings.read");
    await getPersonalAccount(c.env);
    const balance = await getBalance(c.env);
    return c.json({ ok: true, personType: "FISICA", balance: balance.balance });
  })
  .post("/pix/address-keys/inspect", async (c) => {
    requirePermission(c, "asaas.pix.create");
    const input = inspectPixKeyInput.parse(await c.req.json());
    return c.json({
      recipient: await inspectPixKey(
        c.env,
        input.pixAddressKeyType,
        input.pixAddressKey,
      ),
    });
  })
  .get("/pix/transfers", async (c) => {
    requirePermission(c, "asaas.pix.read");
    return c.json({
      items: await repository(c).list(
        parseInteger(c.req.query("limit"), 50, 1, 100),
      ),
    });
  })
  .get("/pix/transfers/:id", async (c) => {
    requirePermission(c, "asaas.pix.read");
    const record = await repository(c).get(c.req.param("id"));
    if (!record)
      throw new AsaasApiError("NOT_FOUND", "Pix transfer not found.", 404);
    if (!record.asaasTransferId) return c.json({ transfer: record });
    return c.json({
      transfer: await repository(c).sync(
        record.id,
        await getTransfer(c.env, record.asaasTransferId),
      ),
    });
  })
  .post("/pix/transfers", async (c) => {
    const context = requirePermission(c, "asaas.pix.create");
    const idempotencyKey = c.req.header("Idempotency-Key")?.trim() ?? "";
    if (!IDEMPOTENCY_KEY.test(idempotencyKey))
      throw new AsaasApiError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key header is required.",
        422,
      );
    const input = pixInput.parse(await c.req.json());
    const valueCents = parseValueCents(input.value);
    const pixAddressKey = normalizePixKey(
      input.pixAddressKeyType,
      input.pixAddressKey,
    );
    const requestHash = await sha256(
      JSON.stringify({
        valueCents,
        pixAddressKey,
        pixAddressKeyType: input.pixAddressKeyType,
        description: input.description ?? "",
      }),
    );
    const transfers = repository(c);
    const started = await transfers.begin({
      idempotencyKey,
      requestHash,
      pixKeyType: input.pixAddressKeyType,
      pixKeyMasked: maskPixKey(input.pixAddressKeyType, pixAddressKey),
      pixKeyHash: await pixKeyHash(input.pixAddressKeyType, pixAddressKey),
      valueCents,
      description: input.description,
      userId: context.userId,
    });
    const { record } = started;
    if (record.requestHash !== requestHash)
      throw new AsaasApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This Idempotency-Key was already used with different Pix data.",
        409,
      );
    if (!started.created) return c.json({ transfer: record, replayed: true });
    let balance: Awaited<ReturnType<typeof getBalance>>;
    try {
      balance = await getBalance(c.env);
    } catch (error) {
      const asaasError =
        error instanceof AsaasApiError
          ? error
          : new AsaasApiError(
              "ASAAS_BALANCE_CHECK_FAILED",
              "The available balance could not be checked.",
              502,
            );
      await transfers.markFailed(record.id, asaasError.code);
      throw asaasError;
    }
    if (Math.round(balance.balance * 100) < valueCents) {
      await transfers.markFailed(record.id, "INSUFFICIENT_BALANCE");
      throw new AsaasApiError(
        "INSUFFICIENT_BALANCE",
        "The available Asaas balance is lower than the Pix amount.",
        422,
      );
    }
    let submitted: PixTransferRecord;
    try {
      submitted = await transfers.markSubmitted(
        record.id,
        await createPixTransfer(c.env, {
          valueCents,
          pixAddressKey,
          pixAddressKeyType: input.pixAddressKeyType,
          description: input.description,
          externalReference: record.externalReference,
        }),
      );
    } catch (error) {
      const asaasError =
        error instanceof AsaasApiError
          ? error
          : new AsaasApiError(
              "ASAAS_TRANSFER_OUTCOME_UNKNOWN",
              "The Pix result is unknown. Check Asaas before trying again.",
              502,
              true,
            );
      if (asaasError.outcomeUnknown)
        await transfers.markUnknown(record.id, asaasError.code);
      else await transfers.markFailed(record.id, asaasError.code);
      throw asaasError.outcomeUnknown
        ? new AsaasApiError(
            "ASAAS_TRANSFER_OUTCOME_UNKNOWN",
            "The Pix result is unknown. Check Asaas before trying again.",
            502,
            true,
          )
        : asaasError;
    }
    try {
      await transfers.audit(
        "asaas.pix.submitted",
        submitted,
        context.requestId,
        context.userId,
      );
    } catch {
      // The transfer is already submitted and must not be reclassified or retried
      // because a secondary audit write failed.
    }
    return c.json({ transfer: submitted, replayed: false }, 201);
  });

app.post("/public/withdrawal-authorization", async (c) => {
  const context = c.get("publicContext");
  if (!context)
    return c.json(
      { status: "REFUSED", refuseReason: "Contexto público inválido" },
      403,
    );
  const configuredToken = c.env.ASAAS_WEBHOOK_TOKEN ?? "";
  const suppliedToken = c.req.header("asaas-access-token") ?? "";
  if (
    configuredToken.length < 32 ||
    configuredToken.length > 255 ||
    suppliedToken.length < 32 ||
    suppliedToken.length > 255 ||
    !(await secureTokenMatches(suppliedToken, configuredToken))
  )
    return c.json(
      { status: "REFUSED", refuseReason: "Token do webhook inválido" },
      401,
    );
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  const payload =
    Number.isFinite(contentLength) && contentLength <= 65_536
      ? parseWithdrawalPayload(await c.req.text())
      : null;
  if (!payload)
    return c.json({
      status: "REFUSED",
      refuseReason: "Solicitação de autorização inválida",
    });
  const record = payload.transfer?.id
    ? await repository(c).getByAsaasTransferId(payload.transfer.id)
    : null;
  const decision = await decideWithdrawalAuthorization(payload, record);
  if (!record)
    return c.json({
      status: "REFUSED",
      refuseReason: decision.refuseReason,
    });
  const saved = await repository(c).decideAuthorization(
    record.id,
    decision.status,
    decision.reason,
    context.requestId,
  );
  const approved =
    decision.status === "APPROVED" && saved.authorizationStatus === "APPROVED";
  try {
    await repository(c).audit(
      approved
        ? "asaas.withdrawal_authorization.approved"
        : "asaas.withdrawal_authorization.refused",
      saved,
      context.requestId,
      record.createdByUserId,
    );
  } catch {
    // The durable authorization decision has already been persisted. A
    // secondary audit failure must not make Asaas retry a valid decision.
  }
  return approved
    ? c.json({ status: "APPROVED" as const })
    : c.json({
        status: "REFUSED" as const,
        refuseReason: decision.refuseReason,
      });
});

app.route("/", asaasRoutes);
app.onError((error, c) => {
  if (error instanceof AsaasApiError)
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    );
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Review the submitted values.",
        },
      },
      422,
    );
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected plugin error." } },
    500,
  );
});

export type AsaasAppType = typeof asaasRoutes;
export default app;
