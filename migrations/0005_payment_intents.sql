CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  job_id TEXT NOT NULL REFERENCES repair_jobs(id),
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  provider TEXT NOT NULL DEFAULT 'mpesa',
  amount INTEGER NOT NULL,
  phone TEXT NOT NULL,
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  result_code INTEGER,
  result_desc TEXT,
  provider_receipt TEXT,
  payment_record_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS payment_intents_job ON payment_intents(workspace_id, job_id, created_at);
