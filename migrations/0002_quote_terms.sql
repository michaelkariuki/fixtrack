ALTER TABLE quotes ADD COLUMN terms TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS repair_jobs_workspace_created ON repair_jobs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS quotes_workspace_job_version ON quotes(workspace_id, job_id, version);
CREATE INDEX IF NOT EXISTS payments_workspace_job ON payment_records(workspace_id, job_id);
