-- Tenant-scoped webhook hook routes (OpenClaw-compatible shape)
CREATE TABLE IF NOT EXISTS hook_routes (
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('wake', 'agent')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  token_hash TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_hook_routes_tenant_enabled
ON hook_routes (tenant_id, enabled);

-- Hook ingress/audit lifecycle
CREATE TABLE IF NOT EXISTS hook_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  hook_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('wake', 'agent')),
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  payload_ref TEXT,
  payload_json JSONB,
  created_at_ms BIGINT NOT NULL,
  processed_at_ms BIGINT
);
CREATE INDEX IF NOT EXISTS idx_hook_events_tenant_time
ON hook_events (tenant_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_hook_events_tenant_status
ON hook_events (tenant_id, status, created_at_ms DESC);
