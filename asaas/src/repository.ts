import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import { createId } from "@nexus/plugin-sdk/backend";
import type { AsaasTransfer, PixKeyType } from "./asaas-client.js";

export type PixTransferRecord = {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  externalReference: string;
  asaasTransferId: string | null;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
  valueCents: number;
  description: string | null;
  status: string;
  errorCode: string | null;
  createdByUserId: string;
  createdAt: unknown;
  updatedAt: unknown;
};

type BeginTransferInput = {
  idempotencyKey: string;
  requestHash: string;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
  valueCents: number;
  description?: string | undefined;
  userId: string;
};

const select = `SELECT id, idempotency_key AS "idempotencyKey",
  request_hash AS "requestHash", external_reference AS "externalReference",
  asaas_transfer_id AS "asaasTransferId", pix_key_type AS "pixKeyType",
  pix_key_masked AS "pixKeyMasked", value_cents AS "valueCents", description,
  status, error_code AS "errorCode", created_by_user_id AS "createdByUserId",
  created_at AS "createdAt", updated_at AS "updatedAt"
  FROM asaas_pix_transfers`;

const dbTime = (db: DatabasePort, value = Date.now()) =>
  db.provider === "d1" ? value : new Date(value);

const normalize = (row: PixTransferRecord): PixTransferRecord => ({
  ...row,
  valueCents: Number(row.valueCents),
});

export class PixTransferRepository {
  constructor(private readonly db: DatabasePort) {}

  async get(id: string): Promise<PixTransferRecord | null> {
    const row = await this.db.first<PixTransferRecord>(
      `${select} WHERE id = ?`,
      [id],
    );
    return row ? normalize(row) : null;
  }

  async getByIdempotencyKey(key: string): Promise<PixTransferRecord | null> {
    const row = await this.db.first<PixTransferRecord>(
      `${select} WHERE idempotency_key = ?`,
      [key],
    );
    return row ? normalize(row) : null;
  }

  async list(limit: number): Promise<PixTransferRecord[]> {
    const rows = await this.db.query<PixTransferRecord>(
      `${select} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [limit],
    );
    return rows.map(normalize);
  }

  async begin(
    input: BeginTransferInput,
  ): Promise<{ record: PixTransferRecord; created: boolean }> {
    const existing = await this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) return { record: existing, created: false };
    const id = createId("apx");
    const now = dbTime(this.db);
    const externalReference = `nexus-${id}`;
    try {
      await this.db.execute(
        `INSERT INTO asaas_pix_transfers(
          id,idempotency_key,request_hash,external_reference,pix_key_type,
          pix_key_masked,value_cents,description,status,created_by_user_id,
          created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          input.idempotencyKey,
          input.requestHash,
          externalReference,
          input.pixKeyType,
          input.pixKeyMasked,
          input.valueCents,
          input.description ?? null,
          "SUBMITTING",
          input.userId,
          now,
          now,
        ],
      );
    } catch (error) {
      const concurrent = await this.getByIdempotencyKey(input.idempotencyKey);
      if (concurrent) return { record: concurrent, created: false };
      throw error;
    }
    return { record: (await this.get(id))!, created: true };
  }

  async markSubmitted(
    id: string,
    transfer: AsaasTransfer,
  ): Promise<PixTransferRecord> {
    await this.db.execute(
      `UPDATE asaas_pix_transfers
        SET asaas_transfer_id=?, status=?, error_code=NULL, updated_at=?
        WHERE id=?`,
      [transfer.id, transfer.status, dbTime(this.db), id],
    );
    return (await this.get(id))!;
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    await this.db.execute(
      `UPDATE asaas_pix_transfers SET status='FAILED', error_code=?, updated_at=?
       WHERE id=?`,
      [errorCode, dbTime(this.db), id],
    );
  }

  async markUnknown(id: string, errorCode: string): Promise<void> {
    await this.db.execute(
      `UPDATE asaas_pix_transfers SET status='UNKNOWN', error_code=?, updated_at=?
       WHERE id=?`,
      [errorCode, dbTime(this.db), id],
    );
  }

  async sync(id: string, transfer: AsaasTransfer): Promise<PixTransferRecord> {
    await this.db.execute(
      `UPDATE asaas_pix_transfers SET status=?, error_code=?, updated_at=?
       WHERE id=?`,
      [
        transfer.status,
        transfer.failReason ? "ASAAS_TRANSFER_FAILED" : null,
        dbTime(this.db),
        id,
      ],
    );
    return (await this.get(id))!;
  }

  async audit(
    action: string,
    record: PixTransferRecord,
    requestId: string,
    userId: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO audit_log(
        id,request_id,user_id,auth_method,action,resource_type,resource_id,
        metadata_json,created_at
      ) VALUES (?,?,?,'internal',?,'asaas.pix',?,?,?)`,
      [
        createId("aud"),
        requestId,
        userId,
        action,
        record.id,
        JSON.stringify({
          asaasTransferId: record.asaasTransferId,
          pixKeyType: record.pixKeyType,
          pixKeyMasked: record.pixKeyMasked,
          valueCents: record.valueCents,
          status: record.status,
        }),
        dbTime(this.db),
      ],
    );
  }
}
