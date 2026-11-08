CREATE TABLE financeiro_webhook_deliveries (
 outbox_id TEXT PRIMARY KEY REFERENCES financeiro_outbox(id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','BLOCKED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 next_attempt_at BIGINT NOT NULL CHECK (next_attempt_at >= 0),
 lease_token TEXT,
 lease_until BIGINT,
 destination_sha256 TEXT NOT NULL CHECK (length(destination_sha256) = 64),
 body TEXT,
 last_error TEXT CHECK (last_error IS NULL OR last_error IN ('ATTEMPTS_EXHAUSTED','DESTINATION_CHANGED','INVALID_EVENT','HTTP_RETRYABLE','REDIRECT_REJECTED','HTTP_REJECTED','TIMEOUT','TRANSPORT_ERROR')),
 last_http_status INTEGER CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
 updated_at TEXT NOT NULL,
 CHECK (lease_until IS NULL OR lease_token IS NOT NULL)
);
CREATE INDEX financeiro_webhook_deliveries_pending_idx ON financeiro_webhook_deliveries(status,next_attempt_at,lease_until);
