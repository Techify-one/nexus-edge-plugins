import type { AsaasBindings } from "./env.js";

const API_BASE = "https://api.asaas.com/v3";
const PRODUCTION_KEY = /^\$aact_prod_[A-Za-z0-9:_-]{40,8180}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

type AsaasErrorBody = {
  errors?: Array<{ code?: unknown; description?: unknown }>;
};

export type AsaasBalance = { balance: number };

export type AsaasPersonalAccount = { personType: "FISICA" };

export type AsaasPixRecipient = {
  ownerName: string;
  ownerDocument: string;
  institutionName: string;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
};

export type AsaasFinancialTransaction = {
  id: string;
  type: string;
  date: string;
  description: string;
  value: number;
  balance: number | null;
  paymentId: string | null;
  transferId: string | null;
};

export type AsaasStatement = {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasFinancialTransaction[];
};

export type AsaasTransfer = {
  id: string;
  status: string;
  value: number;
  effectiveDate: string | null;
  scheduleDate: string | null;
  endToEndIdentifier: string | null;
  transactionReceiptUrl: string | null;
  failReason: string | null;
  externalReference: string | null;
};

export class AsaasApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}

const safeText = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  return (
    value
      .replace(/[\r\n\t]+/gu, " ")
      .trim()
      .slice(0, 300) || fallback
  );
};

const safeCode = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/u.test(value)
    ? value
    : fallback;

export const validateProductionApiKey = (value: string): string => {
  const key = String(value).trim();
  if (!PRODUCTION_KEY.test(key))
    throw new AsaasApiError(
      "ASAAS_API_KEY_FORMAT_INVALID",
      "The Asaas production API key format is invalid.",
      422,
    );
  return key;
};

const configuredApiKey = (env: AsaasBindings): string => {
  if (!env.ASAAS_API_KEY)
    throw new AsaasApiError(
      "ASAAS_API_KEY_NOT_CONFIGURED",
      "The Asaas API key is not configured for this plugin.",
      503,
    );
  return validateProductionApiKey(env.ASAAS_API_KEY);
};

const numberOr = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringOr = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const upstreamError = (
  response: Response,
  body: AsaasErrorBody,
): AsaasApiError => {
  const upstream = body.errors?.[0];
  const upstreamCode = safeCode(upstream?.code, `HTTP_${response.status}`);
  const message = safeText(
    upstream?.description,
    `Asaas API request failed (${response.status}).`,
  );
  if (response.status === 401)
    return new AsaasApiError("ASAAS_API_KEY_INVALID", message, 422);
  if (response.status === 429)
    return new AsaasApiError("ASAAS_RATE_LIMITED", message, 429);
  if (response.status >= 500)
    return new AsaasApiError(
      "ASAAS_UPSTREAM_UNAVAILABLE",
      "Asaas is temporarily unavailable.",
      502,
      true,
    );
  return new AsaasApiError(`ASAAS_${upstreamCode}`, message, 422);
};

async function requestJson<T>(
  env: AsaasBindings,
  path: string,
  init: RequestInit = {},
  apiKey?: string,
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new AsaasApiError(
      "ASAAS_PATH_INVALID",
      "Invalid Asaas API path.",
      500,
    );
  const key = apiKey ? validateProductionApiKey(apiKey) : configuredApiKey(env);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("User-Agent", "Nexus-Asaas-Plugin/1.0 (Cloudflare Workers)");
  headers.set("access_token", key);
  if (init.body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AsaasApiError(
      "ASAAS_NETWORK_ERROR",
      "The Asaas API could not be reached.",
      502,
      true,
    );
  }
  const body = (await response.json().catch(() => ({}))) as T & AsaasErrorBody;
  if (!response.ok || (Array.isArray(body.errors) && body.errors.length))
    throw upstreamError(response, body);
  return body;
}

export async function getBalance(
  env: AsaasBindings,
  apiKey?: string,
): Promise<AsaasBalance> {
  const body = await requestJson<{ balance?: unknown }>(
    env,
    "/finance/balance",
    {},
    apiKey,
  );
  const balance = Number(body.balance);
  if (!Number.isFinite(balance))
    throw new AsaasApiError(
      "ASAAS_RESPONSE_INVALID",
      "Asaas returned an invalid balance response.",
      502,
    );
  return { balance };
}

export async function getPersonalAccount(
  env: AsaasBindings,
  apiKey?: string,
): Promise<AsaasPersonalAccount> {
  const body = await requestJson<{ personType?: unknown }>(
    env,
    "/myAccount/commercialInfo/",
    {},
    apiKey,
  );
  if (body.personType !== "FISICA")
    throw new AsaasApiError(
      "ASAAS_PERSONAL_ACCOUNT_REQUIRED",
      "This plugin only accepts an Asaas personal account.",
      422,
    );
  return { personType: "FISICA" };
}

export const validateStatementRange = (
  startDate: string,
  finishDate: string,
): void => {
  if (!DATE.test(startDate) || !DATE.test(finishDate) || startDate > finishDate)
    throw new AsaasApiError(
      "STATEMENT_DATE_RANGE_INVALID",
      "The statement date range is invalid.",
      422,
    );
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const finish = Date.parse(`${finishDate}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(finish) ||
    finish - start > 366 * 86_400_000
  )
    throw new AsaasApiError(
      "STATEMENT_DATE_RANGE_TOO_LARGE",
      "The statement period cannot exceed 366 days.",
      422,
    );
};

export async function getStatement(
  env: AsaasBindings,
  input: {
    startDate: string;
    finishDate: string;
    offset: number;
    limit: number;
    order: "asc" | "desc";
  },
): Promise<AsaasStatement> {
  validateStatementRange(input.startDate, input.finishDate);
  const query = new URLSearchParams({
    startDate: input.startDate,
    finishDate: input.finishDate,
    offset: String(input.offset),
    limit: String(input.limit),
    order: input.order,
  });
  const body = await requestJson<{
    object?: unknown;
    hasMore?: unknown;
    totalCount?: unknown;
    limit?: unknown;
    offset?: unknown;
    data?: unknown;
  }>(env, `/financialTransactions?${query.toString()}`);
  const rows = Array.isArray(body.data) ? body.data : [];
  return {
    object: stringOr(body.object, "list"),
    hasMore: body.hasMore === true,
    totalCount: Math.max(0, numberOr(body.totalCount)),
    limit: Math.max(1, numberOr(body.limit, input.limit)),
    offset: Math.max(0, numberOr(body.offset, input.offset)),
    data: rows
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object"),
      )
      .map((row, index) => ({
        id: stringOr(row.id, `statement-${input.offset + index}`),
        type: stringOr(row.type, "UNKNOWN"),
        date: stringOr(row.date),
        description: stringOr(row.description, stringOr(row.type, "Movement")),
        value: numberOr(row.value),
        balance:
          row.balance === null || row.balance === undefined
            ? null
            : numberOr(row.balance),
        paymentId: nullableString(row.paymentId),
        transferId: nullableString(row.transferId),
      })),
  };
}

const normalizeTransfer = (body: Record<string, unknown>): AsaasTransfer => ({
  id: stringOr(body.id),
  status: stringOr(body.status, "PENDING"),
  value: numberOr(body.value),
  effectiveDate: nullableString(body.effectiveDate),
  scheduleDate: nullableString(body.scheduleDate),
  endToEndIdentifier: nullableString(body.endToEndIdentifier),
  transactionReceiptUrl: nullableString(body.transactionReceiptUrl),
  failReason: nullableString(body.failReason),
  externalReference: nullableString(body.externalReference),
});

export async function createPixTransfer(
  env: AsaasBindings,
  input: {
    valueCents: number;
    pixAddressKey: string;
    pixAddressKeyType: PixKeyType;
    description?: string | undefined;
    externalReference: string;
  },
): Promise<AsaasTransfer> {
  const body = await requestJson<Record<string, unknown>>(env, "/transfers", {
    method: "POST",
    body: JSON.stringify({
      value: input.valueCents / 100,
      pixAddressKey: input.pixAddressKey,
      pixAddressKeyType: input.pixAddressKeyType,
      ...(input.description ? { description: input.description } : {}),
      externalReference: input.externalReference,
    }),
  });
  const transfer = normalizeTransfer(body);
  if (!transfer.id)
    throw new AsaasApiError(
      "ASAAS_RESPONSE_INVALID",
      "Asaas returned an invalid transfer response.",
      502,
      true,
    );
  return transfer;
}

export async function getTransfer(
  env: AsaasBindings,
  transferId: string,
): Promise<AsaasTransfer> {
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(transferId))
    throw new AsaasApiError("TRANSFER_ID_INVALID", "Invalid transfer ID.", 422);
  return normalizeTransfer(
    await requestJson<Record<string, unknown>>(
      env,
      `/transfers/${encodeURIComponent(transferId)}`,
    ),
  );
}

export const PIX_KEY_TYPES = ["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

const cpfCheck = (digits: string): boolean => {
  if (/^(\d)\1+$/u.test(digits)) return false;
  const digit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1)
      sum += Number(digits[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
};

const cnpjCheck = (digits: string): boolean => {
  if (/^(\d)\1+$/u.test(digits)) return false;
  const calculate = (length: 12 | 13): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + Number(digits[index]) * weight,
      0,
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return (
    calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13])
  );
};

export const normalizePixKey = (type: PixKeyType, value: string): string => {
  const trimmed = String(value).trim();
  if (type === "CPF") {
    const digits = trimmed.replace(/\D/gu, "");
    if (digits.length !== 11 || !cpfCheck(digits))
      throw new AsaasApiError(
        "PIX_KEY_INVALID",
        "Enter a valid CPF Pix key.",
        422,
      );
    return digits;
  }
  if (type === "CNPJ") {
    const digits = trimmed.replace(/\D/gu, "");
    if (digits.length !== 14 || !cnpjCheck(digits))
      throw new AsaasApiError(
        "PIX_KEY_INVALID",
        "Enter a valid CNPJ Pix key.",
        422,
      );
    return digits;
  }
  if (type === "EMAIL") {
    const email = trimmed.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new AsaasApiError(
        "PIX_KEY_INVALID",
        "Enter a valid email Pix key.",
        422,
      );
    return email;
  }
  if (type === "PHONE") {
    const digits = trimmed.replace(/\D/gu, "");
    if (digits.length !== 11)
      throw new AsaasApiError(
        "PIX_KEY_INVALID",
        "Enter a phone with DDD and 11 digits.",
        422,
      );
    return digits;
  }
  const evp = trimmed.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      evp,
    )
  )
    throw new AsaasApiError(
      "PIX_KEY_INVALID",
      "Enter a valid random Pix key.",
      422,
    );
  return evp;
};

export const maskPixKey = (type: PixKeyType, value: string): string => {
  if (type === "CPF") return `***.***.***-${value.slice(-2)}`;
  if (type === "CNPJ") return `**.***.***/****-${value.slice(-2)}`;
  if (type === "PHONE") return `(**) *****-${value.slice(-4)}`;
  if (type === "EVP") return `${value.slice(0, 8)}…${value.slice(-4)}`;
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

const maskDocument = (value: unknown): string => {
  const source = stringOr(value);
  if (source.includes("*")) return source.slice(0, 32);
  const digits = source.replace(/\D/gu, "");
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "***";
};

export async function inspectPixKey(
  env: AsaasBindings,
  type: PixKeyType,
  value: string,
): Promise<AsaasPixRecipient> {
  const key = normalizePixKey(type, value);
  const query = new URLSearchParams({ type, key });
  const body = await requestJson<Record<string, unknown>>(
    env,
    `/pix/addressKeys/external?${query.toString()}`,
  );
  const owner =
    body.owner && typeof body.owner === "object"
      ? (body.owner as Record<string, unknown>)
      : {};
  const institution =
    body.financialInstitution && typeof body.financialInstitution === "object"
      ? (body.financialInstitution as Record<string, unknown>)
      : {};
  const ownerName = safeText(owner.name, "Recipient not identified");
  const institutionName = safeText(
    institution.name ?? body.ispbName,
    "Institution not identified",
  );
  return {
    ownerName,
    ownerDocument: maskDocument(owner.cpfCnpj),
    institutionName,
    pixKeyType: type,
    pixKeyMasked: maskPixKey(type, key),
  };
}

export const parseValueCents = (value: unknown): number => {
  const source =
    typeof value === "number"
      ? String(value)
      : String(value).trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/u.test(source))
    throw new AsaasApiError(
      "PIX_VALUE_INVALID",
      "Enter a valid Pix amount.",
      422,
    );
  const [units, fraction = ""] = source.split(".");
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1)
    throw new AsaasApiError(
      "PIX_VALUE_INVALID",
      "Enter a Pix amount greater than zero.",
      422,
    );
  return cents;
};
