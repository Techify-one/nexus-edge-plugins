import type { PluginHostV1 } from "@nexus/plugin-sdk";
import {
  financeiroFrontendMessages,
  type Label,
  type MessageKey,
} from "./i18n.js";

export class FinanceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
const errorAliases: Record<string, string> = {
  REVISION_CONFLICT: "CONFLICT",
  CONCURRENT_WRITE: "CONFLICT",
  EMPRESA_INACTIVE: "CONFLICT",
  EMPRESA_NOT_FOUND: "NOT_FOUND",
  IDEMPOTENCY_KEY_REQUIRED: "VALIDATION_ERROR",
  PERIODO_FECHADO: "PERIOD_CLOSED",
  SOBREPAGAMENTO: "limite",
  CONTAS_IGUAIS: "contasIguais",
  VALOR_ESTIMADO: "financeiroEstimado",
  VALOR_NAO_CONFIRMADO: "financeiroEstimado",
  IDEMPOTENCY_CONFLICT: "CONFLICT",
  PERIODO_POSTERIOR_FECHADO: "PERIOD_CLOSED",
  REGRA_INVALIDA: "VALIDATION_ERROR",
  JANELA_INVALIDA: "VALIDATION_ERROR",
  DATA_ESTORNO_INVALIDA: "dataInvalida",
  DATA_ANTERIOR_SALDO: "dataInvalida",
  CONTA_INATIVA: "VALIDATION_ERROR",
  CATEGORIA_INVALIDA: "VALIDATION_ERROR",
  SALDO_IMUTAVEL: "CONFLICT",
  NATUREZA_IMUTAVEL: "CONFLICT",
  LANCAMENTO_LIQUIDADO: "CONFLICT",
  ESTORNO_INVALIDO: "CONFLICT",
  CANCELAMENTO_INVALIDO: "CONFLICT",
  RECORRENCIA_ENCERRADA: "CONFLICT",
  TRANSFERENCIA_INVALIDA: "CONFLICT",
  LANCAMENTO_CANCELADO: "CONFLICT",
  R2_NOT_CONFIGURED: "RESOURCE_UNAVAILABLE",
  TELEGRAM_NOT_CONFIGURED: "avisoSemBot",
  INVALID_FILE_SIZE: "arquivoInvalido",
  INVALID_FILE_TYPE: "arquivoInvalido",
  INVALID_FILE_SIGNATURE: "arquivoInvalido",
};
export const errorLabel = (error: unknown, t: Label): string => {
  const key =
    error instanceof Error && error.message.startsWith("financeiro.")
      ? error.message
      : error instanceof FinanceError
        ? `financeiro.${errorAliases[error.code] ?? error.code}`
        : "";
  return key in financeiroFrontendMessages["pt-BR"]
    ? t(key as MessageKey)
    : t("financeiro.erro");
};
export class FinanceApi {
  constructor(readonly host: PluginHostV1) {}
  async response(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept-Language", this.host.locale);
    const response = await this.host.api(path, { ...init, headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string };
      };
      throw new FinanceError(body.error?.code ?? "HTTP_ERROR", response.status);
    }
    return response;
  }
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await this.response(path, signal ? { signal } : {});
    return response.json() as Promise<T>;
  }
  async write<T>(path: string, method: string, body?: unknown): Promise<T> {
    const response = await this.response(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  async upload(path: string, file: File): Promise<void> {
    await this.response(path, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
  }
  async download(path: string, name: string): Promise<void> {
    const response = await this.response(path);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export const scoped = (
  path: string,
  empresaId: string,
  params: Record<string, string> = {},
): string => {
  const search = new URLSearchParams({ empresaId, ...params });
  for (const [key, value] of [...search]) if (!value) search.delete(key);
  return `${path}?${search}`;
};
export const hasPermission = (
  host: Pick<PluginHostV1, "permissions">,
  resource: string,
  action = "read",
): boolean => host.permissions.includes(`financeiro.${resource}.${action}`);
