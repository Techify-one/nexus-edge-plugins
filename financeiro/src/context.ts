import type { Context } from "hono";
import { z } from "zod";
import type { FinanceEnv } from "./env.js";
import { FinanceError } from "./errors.js";
const requestId = z.string().min(1).max(200);
const userContext = z.object({
  userId: z.string().min(1).max(200),
  permissions: z.array(z.string().min(1).max(200)).max(10000),
  requestId,
  origin: z.string().url().optional(),
});
const installerContext = z.object({
  pluginId: z.literal("financeiro"),
  operationId: requestId,
  requestId,
});
export function parseContext(c: Context<FinanceEnv>): void {
  const encoded = c.req.header("X-Plugin-Context"),
    installer = c.req.header("X-Plugin-Installer-Context"),
    publicHeader = c.req.header("X-Plugin-Public-Context");
  if (publicHeader || Boolean(encoded) === Boolean(installer))
    throw new FinanceError(
      "INVALID_PLUGIN_CONTEXT",
      "Exatamente um contexto interno é obrigatório.",
      401,
    );
  try {
    const raw = encoded ?? installer!;
    if (raw.length > 65536) throw new Error("oversized");
    const bytes = Uint8Array.from(
      atob(raw.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (encoded) c.set("pluginContext", userContext.parse(value));
    else {
      if (c.req.path !== "/__installer/smoke" || c.req.method !== "POST")
        throw new Error("installer scope");
      c.set("installerContext", installerContext.parse(value));
    }
  } catch {
    throw new FinanceError(
      "INVALID_PLUGIN_CONTEXT",
      "Contexto interno inválido.",
      401,
    );
  }
}
export function permission(c: Context<FinanceEnv>, key: string) {
  const context = c.get("pluginContext");
  if (!context?.permissions.includes(`financeiro.${key}`))
    throw new FinanceError("FORBIDDEN", "Permissão insuficiente.", 403);
  return context;
}
