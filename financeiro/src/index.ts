import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  createId,
  createPluginDatabase,
  type PluginContextV1,
} from "@nexus/plugin-sdk/backend";
import type { Bindings, FinanceEnv } from "./env.js";
import { parseContext, permission } from "./context.js";
import { FinanceError, assert } from "./errors.js";
import { LedgerService } from "./modules/ledger.js";
import { sendNotices } from "./modules/integrations.js";
import { getWebhookStatus, processWebhookOutbox } from "./modules/webhooks.js";
import { today } from "./domain/dates.js";
import { RegraInvalida } from "./domain/recurrence.js";
import * as schemas from "./schemas.js";
import type { Resource } from "./db/repository.js";
const app = new Hono<FinanceEnv>();
const service = (c: Context<FinanceEnv>) =>
  new LedgerService(c.get("db"), c.get("pluginContext"));
const company = (c: Context<FinanceEnv>) =>
  schemas.id.parse(c.req.query("empresaId"));
async function boundedBody(request: Request, max: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new FinanceError(
          "BODY_TOO_LARGE",
          "Corpo excede o limite permitido.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
async function input(c: Context<FinanceEnv>): Promise<unknown> {
  const length = Number(c.req.header("Content-Length") ?? "0");
  assert(length <= 65536, "BODY_TOO_LARGE", "Corpo excede 64 KiB.", 413);
  const bytes = await boundedBody(c.req.raw, 65536);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes) || "{}",
    );
  } catch {
    throw new FinanceError("INVALID_JSON", "JSON inválido.");
  }
}
function page(c: Context<FinanceEnv>, rows: Record<string, unknown>[]) {
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .default(0)
    .parse(c.req.query("offset"));
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(100)
    .parse(c.req.query("limit"));
  return c.json({
    data: rows.slice(offset, offset + limit),
    total: rows.length,
    offset,
    limit,
  });
}
app.use("*", async (c, next) => {
  parseContext(c);
  const db = await createPluginDatabase(c.env);
  c.set("db", db);
  try {
    await next();
  } finally {
    await db.close();
  }
});
app.onError((error, c) => {
  if (error instanceof RegraInvalida)
    return c.json(
      { error: { code: "REGRA_INVALIDA", message: error.message } },
      400,
    );
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      },
      400,
    );
  if (error instanceof FinanceError)
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as 400,
    );
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Falha interna. A operação não foi confirmada.",
      },
    },
    500,
  );
});
app.get("/health", (c) => {
  permission(c, "empresas.read");
  return c.json({ ok: true, plugin: "financeiro", version: "1.0.0" });
});
app.post("/__installer/smoke", async (c) => {
  assert(
    c.get("installerContext"),
    "INSTALLER_CONTEXT_REQUIRED",
    "Contexto Installer obrigatório.",
    403,
  );
  const db = c.get("db"),
    id = createId("smoke"),
    at = new Date().toISOString();
  await db.atomic([
    {
      sql: "INSERT INTO financeiro_empresas (id,nome,ativo,revision,created_at,updated_at) VALUES (?,?,0,0,?,?)",
      params: [id, "Installer smoke isolado", at, at],
    },
    {
      sql: "UPDATE financeiro_empresas SET revision = CASE WHEN revision = 0 THEN 1 ELSE -1 END WHERE id = ?",
      params: [id],
    },
    { sql: "DELETE FROM financeiro_empresas WHERE id = ?", params: [id] },
  ]);
  return c.json({ ok: true, plugin: "financeiro", database: db.provider });
});
app.get("/empresas", async (c) => {
  permission(c, "empresas.read");
  return page(c, await service(c).companies());
});
app.post("/empresas", async (c) => {
  permission(c, "empresas.create");
  return c.json({ data: await service(c).createCompany(await input(c)) }, 201);
});
app.patch("/empresas/:id", async (c) => {
  permission(c, "empresas.update");
  return c.json({
    data: await service(c).updateCompany(
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
for (const resource of [
  "contas",
  "categorias",
  "lancamentos",
  "movimentos",
  "transferencias",
  "recorrencias",
  "fechamentos",
  "visoes",
  "anexos",
] as Resource[]) {
  app.get(`/${resource}`, async (c) => {
    permission(c, `${resource}.read`);
    let rows = await service(c).list(company(c), resource);
    if (resource === "lancamentos") {
      const mes = c.req.query("mes");
      if (mes) schemas.monthSchema.parse(mes);
      const tipo = c.req.query("tipo"),
        situacao = c.req.query("situacao"),
        busca = c.req.query("busca")?.toLocaleLowerCase("pt-BR");
      rows = rows.filter(
        (r) =>
          (!mes || String(r.competencia).startsWith(mes)) &&
          (!tipo || r.tipo === tipo) &&
          (!situacao || r.situacao === situacao) &&
          (!c.req.query("categoriaId") ||
            r.categoriaId === c.req.query("categoriaId")) &&
          (!c.req.query("contaPrevistaId") ||
            r.contaPrevistaId === c.req.query("contaPrevistaId")) &&
          (!busca ||
            `${String(r.descricao)} ${String(r.contraparte ?? "")}`
              .toLocaleLowerCase("pt-BR")
              .includes(busca)),
      );
    }
    if (
      c.req.query("mes") &&
      ["movimentos", "transferencias", "fechamentos"].includes(resource)
    ) {
      const mes = schemas.monthSchema.parse(c.req.query("mes"));
      rows = rows.filter((r) =>
        resource === "fechamentos"
          ? r.mes === mes
          : String(r.dataEfetiva).startsWith(mes),
      );
    }
    if (c.req.query("lancamentoId"))
      rows = rows.filter((r) => r.lancamentoId === c.req.query("lancamentoId"));
    if (resource === "anexos") rows = rows.map(({ objectKey, ...r }) => r);
    return page(c, rows);
  });
}
for (const resource of ["contas", "categorias"] as const) {
  app.post(`/${resource}`, async (c) => {
    permission(c, `${resource}.create`);
    const body = await input(c);
    return c.json(
      {
        data: await (resource === "contas"
          ? service(c).createAccount(company(c), body)
          : service(c).createCategory(company(c), body)),
      },
      201,
    );
  });
  app.patch(`/${resource}/:id`, async (c) => {
    permission(c, `${resource}.update`);
    return c.json({
      data: await service(c).updateCatalog(
        company(c),
        resource,
        schemas.id.parse(c.req.param("id")),
        await input(c),
      ),
    });
  });
}
app.post("/lancamentos", async (c) => {
  permission(c, "lancamentos.create");
  const body = await input(c);
  if (typeof body === "object" && body && "liquidacao" in body)
    permission(c, "movimentos.create");
  return c.json({ data: await service(c).createEntry(company(c), body) }, 201);
});
app.get("/lancamentos/:id", async (c) => {
  permission(c, "lancamentos.read");
  const data = await service(c).getEntry(
    company(c),
    schemas.id.parse(c.req.param("id")),
  );
  return c.json({
    data: {
      ...data,
      movimentos: c
        .get("pluginContext")
        .permissions.includes("financeiro.movimentos.read")
        ? data.movimentos
        : [],
      anexos: c
        .get("pluginContext")
        .permissions.includes("financeiro.anexos.read")
        ? data.anexos.map(({ objectKey, ...a }) => a)
        : [],
    },
  });
});
app.patch("/lancamentos/:id", async (c) => {
  permission(c, "lancamentos.update");
  return c.json({
    data: await service(c).updateEntry(
      company(c),
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
app.post("/lancamentos/:id/cancelar", async (c) => {
  permission(c, "lancamentos.cancel");
  return c.json({
    data: await service(c).cancel(
      company(c),
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
app.post("/lancamentos/:id/baixas", async (c) => {
  permission(c, "movimentos.create");
  return c.json(
    {
      data: await service(c).settle(
        company(c),
        schemas.id.parse(c.req.param("id")),
        await input(c),
      ),
    },
    201,
  );
});
app.post("/movimentos/:id/estornar", async (c) => {
  permission(c, "movimentos.reverse");
  return c.json(
    {
      data: await service(c).reverse(
        company(c),
        schemas.id.parse(c.req.param("id")),
        await input(c),
      ),
    },
    201,
  );
});
app.post("/transferencias", async (c) => {
  permission(c, "transferencias.create");
  return c.json(
    { data: await service(c).transfer(company(c), await input(c)) },
    201,
  );
});
app.post("/transferencias/:id/estornar", async (c) => {
  permission(c, "transferencias.reverse");
  return c.json({
    data: await service(c).reverseTransfer(
      company(c),
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
app.post("/recorrencias", async (c) => {
  permission(c, "recorrencias.create");
  return c.json(
    { data: await service(c).createRecurrence(company(c), await input(c)) },
    201,
  );
});
app.post("/recorrencias/previa", async (c) => {
  permission(c, "recorrencias.read");
  company(c);
  return c.json({ data: service(c).preview(await input(c)) });
});
app.patch("/recorrencias/:id", async (c) => {
  permission(c, "recorrencias.update");
  return c.json({
    data: await service(c).updateRecurrence(
      company(c),
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
app.post("/recorrencias/gerar", async (c) => {
  permission(c, "recorrencias.generate");
  return c.json({
    data: await service(c).generate(company(c), await input(c)),
  });
});
app.post("/fechamentos", async (c) => {
  permission(c, "fechamentos.close");
  return c.json(
    { data: await service(c).closePeriod(company(c), await input(c)) },
    201,
  );
});
app.post("/fechamentos/:id/reabrir", async (c) => {
  permission(c, "fechamentos.reopen");
  return c.json({
    data: await service(c).reopen(
      company(c),
      schemas.id.parse(c.req.param("id")),
      await input(c),
    ),
  });
});
app.get("/resumo", async (c) => {
  permission(c, "resumo.read");
  return c.json({
    data: await service(c).summary(
      company(c),
      schemas.monthSchema.parse(c.req.query("mes") ?? today().slice(0, 7)),
    ),
  });
});
app.post("/visoes", async (c) => {
  permission(c, "visoes.create");
  return c.json(
    { data: await service(c).createView(company(c), await input(c)) },
    201,
  );
});
app.delete("/visoes/:id", async (c) => {
  permission(c, "visoes.delete");
  return c.json({
    data: await service(c).deleteView(
      company(c),
      schemas.id.parse(c.req.param("id")),
    ),
  });
});
app.get("/auditoria", async (c) => {
  permission(c, "auditoria.read");
  const empresaId = company(c);
  const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .parse(c.req.query("limit")),
    offset = z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .parse(c.req.query("offset"));
  const rows = await c
    .get("db")
    .query<
      Record<string, unknown>
    >("SELECT id,user_id,request_id,action,before_json,after_json,created_at FROM financeiro_auditoria WHERE empresa_id = ? ORDER BY created_at DESC,id LIMIT ? OFFSET ?", [empresaId, limit, offset]);
  const count = await c.get("db").first<{
    total: number | string;
  }>("SELECT COUNT(*) AS total FROM financeiro_auditoria WHERE empresa_id = ?", [empresaId]);
  return c.json({
    data: rows.map((row) => ({
      ...row,
      before: JSON.parse(String(row.before_json)),
      after: JSON.parse(String(row.after_json)),
      before_json: undefined,
      after_json: undefined,
    })),
    total: Number(count?.total ?? 0),
    offset,
    limit,
  });
});
const csv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
app.get("/relatorios/csv", async (c) => {
  permission(c, "relatorios.read");
  const empresaId = company(c),
    mes = schemas.monthSchema.parse(c.req.query("mes") ?? today().slice(0, 7)),
    regime = z
      .enum(["competencia", "caixa"])
      .default("competencia")
      .parse(c.req.query("regime"));
  const rows = await service(c).list(
    empresaId,
    regime === "caixa" ? "movimentos" : "lancamentos",
  );
  const filtered = rows.filter((row) =>
    String(regime === "caixa" ? row.dataEfetiva : row.competencia).startsWith(
      mes,
    ),
  );
  const keys =
    regime === "caixa"
      ? [
          "id",
          "lancamentoId",
          "transferenciaId",
          "contaId",
          "dataEfetiva",
          "valorCentavos",
          "sinal",
          "estornoDeId",
        ]
      : [
          "id",
          "tipo",
          "descricao",
          "contraparte",
          "competencia",
          "vencimento",
          "valorCentavos",
          "liquidadoCentavos",
          "pendenteCentavos",
          "situacao",
          "confirmado",
        ];
  return new Response(
    "﻿" +
      [
        keys.map(csv).join(";"),
        ...filtered.map((row) => keys.map((key) => csv(row[key])).join(";")),
      ].join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="financeiro-${mes}-${regime}.csv"`,
        "Cache-Control": "no-store",
      },
    },
  );
});
app.post("/anexos", async (c) => {
  permission(c, "anexos.create");
  assert(
    c.env.DOCUMENTS,
    "R2_NOT_CONFIGURED",
    "Recurso DOCUMENTS indisponível.",
    503,
  );
  const empresaId = company(c),
    lancamentoId = schemas.id.parse(c.req.query("lancamentoId"));
  await service(c).getEntry(empresaId, lancamentoId);
  const contentType = c.req.header("Content-Type")?.split(";")[0] ?? "",
    allowed = ["application/pdf", "image/png", "image/jpeg"];
  assert(
    allowed.includes(contentType),
    "INVALID_FILE_TYPE",
    "Somente PDF, PNG e JPEG são aceitos.",
    415,
  );
  const size = Number(c.req.header("Content-Length"));
  assert(
    Number.isInteger(size) && size > 0 && size <= 5 * 1024 * 1024,
    "INVALID_FILE_SIZE",
    "Informe Content-Length de até 5 MiB.",
    413,
  );
  const bytes = await boundedBody(c.req.raw, 5 * 1024 * 1024);
  assert(
    bytes.byteLength === size,
    "INVALID_FILE_SIZE",
    "Tamanho do arquivo divergente.",
  );
  const prefix = bytes.slice(0, 8);
  assert(
    contentType === "application/pdf"
      ? new TextDecoder().decode(prefix).startsWith("%PDF-")
      : contentType === "image/png"
        ? prefix[0] === 137 &&
          prefix[1] === 80 &&
          prefix[2] === 78 &&
          prefix[3] === 71
        : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255,
    "INVALID_FILE_SIGNATURE",
    "Conteúdo não corresponde ao tipo declarado.",
  );
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(
      c.req.header("X-File-Name") ?? "comprovante",
    );
  } catch {
    throw new FinanceError("INVALID_FILE_NAME", "Nome do arquivo inválido.");
  }
  const nome = z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\x00-\x1f\x7f/\\]+$/)
    .parse(decodedName);
  const key = `financeiro/${empresaId}/${createId("blob")}`;
  await c.env.DOCUMENTS.put(key, bytes, { httpMetadata: { contentType } });
  try {
    const data = await service(c).addAttachment(empresaId, lancamentoId, {
      nome,
      contentType,
      tamanho: size,
      objectKey: key,
    });
    const { objectKey, ...safe } = data;
    return c.json({ data: safe }, 201);
  } catch (error) {
    try {
      await c.env.DOCUMENTS.delete(key);
    } catch {
      /* An orphan remains private; maintenance must inspect before deleting. */
    }
    throw error;
  }
});
app.get("/anexos/:id", async (c) => {
  permission(c, "anexos.read");
  assert(
    c.env.DOCUMENTS,
    "R2_NOT_CONFIGURED",
    "Recurso DOCUMENTS indisponível.",
    503,
  );
  const attachment = (await service(c).list(company(c), "anexos")).find(
    (row) => row.id === c.req.param("id"),
  );
  assert(attachment, "NOT_FOUND", "Anexo não encontrado.", 404);
  const object = await c.env.DOCUMENTS.get(String(attachment.objectKey));
  assert(object, "FILE_UNAVAILABLE", "Arquivo indisponível.", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": String(attachment.contentType),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(attachment.nome))}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
app.delete("/anexos/:id", async (c) => {
  permission(c, "anexos.delete");
  assert(
    c.env.DOCUMENTS,
    "R2_NOT_CONFIGURED",
    "Recurso DOCUMENTS indisponível.",
    503,
  );
  const record = await service(c).deleteAttachment(
    company(c),
    schemas.id.parse(c.req.param("id")),
  );
  try {
    await c.env.DOCUMENTS.delete(String(record.objectKey));
  } catch {
    return c.json({
      data: {
        id: record.id,
        arquivoRemovido: false,
        manutencaoNecessaria: true,
      },
    });
  }
  return c.json({ data: { id: record.id, arquivoRemovido: true } });
});
app.get("/avisos/configuracao", async (c) => {
  permission(c, "avisos.read");
  const rows = await service(c).list(company(c), "avisos");
  return c.json({
    data: {
      ...(rows[0] ?? { ativo: false }),
      telegramConfigurado: Boolean(c.env.TELEGRAM_BOT_TOKEN),
    },
  });
});
app.put("/avisos/configuracao", async (c) => {
  permission(c, "avisos.manage");
  return c.json({
    data: await service(c).configureNotices(company(c), await input(c)),
  });
});
app.post("/avisos/enviar", async (c) => {
  const actor = permission(c, "avisos.manage");
  return c.json({
    data: await sendNotices(c.get("db"), c.env, company(c), actor),
  });
});
app.get("/webhooks/status", (c) => {
  permission(c, "avisos.read");
  return c.json({ data: getWebhookStatus(c.env) });
});
app.notFound((c) =>
  c.json(
    { error: { code: "NOT_FOUND", message: "Rota não encontrada." } },
    404,
  ),
);
export { app, LedgerService };
export async function runScheduled(
  env: Bindings,
  job: "generate" | "notices" | "webhooks" = "generate",
): Promise<void> {
  const db = await createPluginDatabase(env);
  try {
    if (job === "webhooks") {
      await processWebhookOutbox(db, env, { limit: 3 });
      return;
    }
    if (job === "notices" && !env.TELEGRAM_BOT_TOKEN) return;
    const state = await db.first<{ company_cursor: string }>(
      "SELECT company_cursor FROM financeiro_scheduler WHERE id = ?",
      [job],
    );
    let row = await db.first<{ id: string }>(
      "SELECT id FROM financeiro_empresas WHERE ativo = 1 AND id > ? ORDER BY id",
      [state?.company_cursor ?? ""],
    );
    if (!row)
      row = await db.first<{ id: string }>(
        "SELECT id FROM financeiro_empresas WHERE ativo = 1 ORDER BY id",
      );
    if (!row) return;
    const context: PluginContextV1 = {
      userId: "system:cron",
      permissions: [],
      requestId: createId("cron"),
    };
    try {
      if (job === "generate") {
        const generated = await new LedgerService(db, context).generate(
          row.id,
          {},
        );
        if (!generated.concluido)
          console.info("financeiro generation continuation pending", {
            companyId: row.id,
            remaining: generated.restantes,
          });
      } else {
        const config = await db.first<{ payload: string }>(
          "SELECT payload FROM financeiro_avisos WHERE empresa_id = ?",
          [row.id],
        );
        if (config && JSON.parse(config.payload).ativo)
          await sendNotices(db, env, row.id, context);
      }
    } catch (error) {
      console.error("financeiro scheduled company failed", {
        companyId: row.id,
        code: error instanceof FinanceError ? error.code : "INTERNAL_ERROR",
      });
    }
    await db.execute(
      "INSERT INTO financeiro_scheduler (id,company_cursor,updated_at) VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET company_cursor = excluded.company_cursor, updated_at = excluded.updated_at",
      [job, row.id, new Date().toISOString()],
    );
  } finally {
    await db.close();
  }
}
export default {
  fetch: app.fetch,
  scheduled: (
    event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) =>
    ctx.waitUntil(
      runScheduled(
        env,
        event.cron === "10,31,52 * * * *"
          ? "notices"
          : event.cron === "17,38,59 * * * *"
            ? "webhooks"
            : "generate",
      ),
    ),
};
