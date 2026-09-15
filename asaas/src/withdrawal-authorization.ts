import { z } from "zod";
import {
  normalizePixKey,
  parseValueCents,
  type PixKeyType,
} from "./asaas-client.js";

const MAX_WEBHOOK_BYTES = 64 * 1024;

const nullableText = z.string().max(300).nullable().optional();

const transferSchema = z
  .object({
    id: z.string().min(8).max(100),
    value: z.union([z.number(), z.string()]),
    operationType: z.string().max(40).optional(),
    externalReference: nullableText,
    description: nullableText,
    bankAccount: z
      .object({
        pixAddressKey: nullableText,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const payloadSchema = z
  .object({
    type: z.string().max(50),
    transfer: transferSchema.optional(),
  })
  .passthrough();

export type WithdrawalAuthorizationPayload = z.infer<typeof payloadSchema>;

export type AuthorizableTransfer = {
  asaasTransferId: string | null;
  externalReference: string;
  pixKeyType: PixKeyType;
  pixKeyHash: string | null;
  valueCents: number;
  description: string | null;
  authorizationStatus: string;
  authorizationReason: string | null;
};

export type AuthorizationDecision = {
  status: "APPROVED" | "REFUSED";
  reason: string;
  refuseReason?: string;
};

const digest = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

const encode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const pixKeyHash = async (
  type: PixKeyType,
  normalizedKey: string,
): Promise<string> => encode(await digest(`${type}:${normalizedKey}`));

export const secureTokenMatches = async (
  supplied: string,
  configured: string,
): Promise<boolean> => {
  const [left, right] = await Promise.all([
    digest(supplied),
    digest(configured),
  ]);
  let difference = supplied.length ^ configured.length;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
};

export const parseWithdrawalPayload = (
  source: string,
): WithdrawalAuthorizationPayload | null => {
  if (new TextEncoder().encode(source).byteLength > MAX_WEBHOOK_BYTES)
    return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const refused = (reason: string): AuthorizationDecision => ({
  status: "REFUSED",
  reason,
  refuseReason: "Transferência não reconhecida pelo Nexus",
});

const webhookPixKey = (type: PixKeyType, value: string): string => {
  if (type !== "PHONE") return normalizePixKey(type, value);
  const digits = value.replace(/\D/gu, "");
  return normalizePixKey(
    type,
    digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits,
  );
};

export async function decideWithdrawalAuthorization(
  payload: WithdrawalAuthorizationPayload,
  record: AuthorizableTransfer | null,
): Promise<AuthorizationDecision> {
  if (payload.type !== "TRANSFER" || !payload.transfer)
    return refused("UNSUPPORTED_OPERATION");
  if (!record) return refused("TRANSFER_NOT_FOUND");
  if (record.authorizationStatus === "REFUSED")
    return refused(record.authorizationReason ?? "ALREADY_REFUSED");
  if (record.asaasTransferId !== payload.transfer.id)
    return refused("TRANSFER_ID_MISMATCH");
  if (payload.transfer.operationType !== "PIX")
    return refused("OPERATION_TYPE_MISMATCH");
  let receivedCents: number;
  try {
    receivedCents = parseValueCents(payload.transfer.value);
  } catch {
    return refused("VALUE_INVALID");
  }
  if (receivedCents !== record.valueCents) return refused("VALUE_MISMATCH");
  if (
    payload.transfer.externalReference &&
    payload.transfer.externalReference !== record.externalReference
  )
    return refused("REFERENCE_MISMATCH");
  if (
    typeof payload.transfer.description === "string" &&
    payload.transfer.description !== (record.description ?? "")
  )
    return refused("DESCRIPTION_MISMATCH");
  const receivedKey = payload.transfer.bankAccount?.pixAddressKey;
  if (!record.pixKeyHash) return refused("DESTINATION_NOT_VERIFIABLE");
  // Asaas documents pixAddressKey as nullable in this callback. Whenever it is
  // present, verify it; otherwise the Asaas-issued transfer ID, amount and local
  // external reference remain the binding to the request created by Nexus.
  if (receivedKey) {
    try {
      if (
        (await pixKeyHash(
          record.pixKeyType,
          webhookPixKey(record.pixKeyType, receivedKey),
        )) !== record.pixKeyHash
      )
        return refused("DESTINATION_MISMATCH");
    } catch {
      return refused("DESTINATION_INVALID");
    }
  }
  return { status: "APPROVED", reason: "REGISTERED_TRANSFER_MATCHED" };
}
