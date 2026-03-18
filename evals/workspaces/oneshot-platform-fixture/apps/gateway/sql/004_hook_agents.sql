CREATE TABLE IF NOT EXISTS hook_agents (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_hook_agents_tenant_enabled
ON hook_agents (tenant_id, enabled, updated_at_ms DESC);
