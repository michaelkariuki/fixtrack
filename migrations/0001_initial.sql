CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  location TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repair_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  job_number TEXT NOT NULL,
  device_category TEXT NOT NULL,
  device_model TEXT NOT NULL,
  serial_number TEXT,
  fault_description TEXT NOT NULL,
  accessories_included TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES repair_jobs(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  version INTEGER NOT NULL DEFAULT 1,
  total_amount INTEGER NOT NULL,
  required_deposit INTEGER NOT NULL DEFAULT 0,
  approval_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_at INTEGER,
  customer_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES repair_jobs(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  amount INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  reference_code TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
