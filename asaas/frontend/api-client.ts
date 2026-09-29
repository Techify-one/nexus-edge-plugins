import {
  api,
  idempotencyKey,
} from "../../.marketplace/frontend/src/lib/api/core-client.js";
import type {
  BalanceResponse,
  PixKeyType,
  PixTransfer,
  StatementResponse,
} from "./types.js";

const base = "/api/v1/p/asaas";

export const asaasApi = {
  balance: () => api<BalanceResponse>(`${base}/balance`),
  statement: (query: URLSearchParams) =>
    api<StatementResponse>(`${base}/statement?${query.toString()}`),
  validateConnection: (apiKey: string) =>
    api<{ ok: boolean; personType: "FISICA"; balance: number }>(
      `${base}/connection/validate`,
      {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      },
    ),
  testConnection: () =>
    api<{ ok: boolean; personType: "FISICA"; balance: number }>(
      `${base}/connection`,
    ),
  inspectPixKey: (input: {
    pixAddressKey: string;
    pixAddressKeyType: PixKeyType;
  }) =>
    api<{
      recipient: {
        ownerName: string;
        ownerDocument: string;
        institutionName: string;
        pixKeyType: PixKeyType;
        pixKeyMasked: string;
      };
    }>(`${base}/pix/address-keys/inspect`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  transfers: () =>
    api<{ items: PixTransfer[] }>(`${base}/pix/transfers?limit=50`),
  refreshTransfer: (id: string) =>
    api<{ transfer: PixTransfer }>(
      `${base}/pix/transfers/${encodeURIComponent(id)}`,
    ),
  sendPix: (input: {
    value: string;
    pixAddressKey: string;
    pixAddressKeyType: PixKeyType;
    description?: string | undefined;
  }) =>
    api<{ transfer: PixTransfer; replayed: boolean }>(`${base}/pix/transfers`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ ...input, confirmed: true }),
    }),
};

export const formatCurrency = (locale: string, value: number): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "BRL",
  }).format(value);

export const formatDate = (locale: string, value: string | number): string => {
  const parsed =
    typeof value === "number"
      ? new Date(value)
      : /^\d{4}-\d{2}-\d{2}$/u.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
};
