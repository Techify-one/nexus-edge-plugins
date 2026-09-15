ALTER TABLE asaas_pix_transfers ADD COLUMN pix_key_hash TEXT;
ALTER TABLE asaas_pix_transfers ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE asaas_pix_transfers ADD COLUMN authorization_reason TEXT;
ALTER TABLE asaas_pix_transfers ADD COLUMN authorization_request_id TEXT;
ALTER TABLE asaas_pix_transfers ADD COLUMN authorization_decided_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS asaas_pix_transfers_authorization_idx
  ON asaas_pix_transfers(authorization_status, updated_at DESC);
