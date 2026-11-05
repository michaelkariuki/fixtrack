CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  job_id TEXT NOT NULL REFERENCES repair_jobs(id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  error TEXT,
  sent_by TEXT NOT NULL REFERENCES owner_users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS notifications_job ON notifications(workspace_id, job_id, created_at);

ALTER TABLE payment_intents ADD COLUMN received_amount INTEGER;
ALTER TABLE payment_intents ADD COLUMN resolved_at INTEGER;
ALTER TABLE payment_intents ADD COLUMN resolved_by TEXT;
ALTER TABLE payment_intents ADD COLUMN resolution TEXT;
