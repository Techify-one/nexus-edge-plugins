CREATE TABLE IF NOT EXISTS asaas_pix_transfers (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  external_reference TEXT NOT NULL UNIQUE,
  asaas_transfer_id TEXT UNIQUE,
  pix_key_type TEXT NOT NULL,
  pix_key_masked TEXT NOT NULL,
  value_cents INTEGER NOT NULL CHECK (value_cents > 0),
  description TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS asaas_pix_transfers_created_idx
  ON asaas_pix_transfers(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS asaas_pix_transfers_status_idx
  ON asaas_pix_transfers(status, updated_at DESC);
