CREATE TABLE IF NOT EXISTS platform_probe_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
