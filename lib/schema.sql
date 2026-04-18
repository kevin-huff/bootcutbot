-- JsoningPg key-value store. One row per (namespace, key).
-- Namespace corresponds to the old jsoning filename (without .json extension).

CREATE TABLE IF NOT EXISTS kv_store (
  namespace   TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS kv_store_ns_idx ON kv_store (namespace);
