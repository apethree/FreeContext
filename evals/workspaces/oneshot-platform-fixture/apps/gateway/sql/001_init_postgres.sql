-- Core relational state migrated from Cloudflare D1 + new fly-era tables.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  slug TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at BIGINT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_type_external ON tenants (type, external_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  display_name TEXT,
  platform TEXT,
  public_key TEXT,
  device_token TEXT UNIQUE,
  paired_at BIGINT NOT NULL,
  last_seen_at BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  device_id TEXT REFERENCES devices(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  meta JSONB
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tenant_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  idempotency_key TEXT,
  in_r2 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  meta JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_session_seq ON messages (tenant_id, session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_session_idem ON messages (tenant_id, session_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages (session_id, seq DESC);

CREATE TABLE IF NOT EXISTS message_idempotency (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, session_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_channels_tenant_created ON channels (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  payload_ref TEXT,
  channel_id TEXT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_channel_status ON jobs (tenant_id, channel_id, status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  payload_ref TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, source, source_event_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  meta JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_log (tenant_id, created_at DESC);

-- New durable token source-of-truth
CREATE TABLE IF NOT EXISTS token_records (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  token_kind TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  email TEXT,
  pi_provider_id TEXT,
  oauth_provider_id TEXT,
  expires_at_ms BIGINT,
  account_id TEXT,
  project_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, provider)
);

-- Optional owner trace for debugging/failover audits
CREATE TABLE IF NOT EXISTS tenant_owner_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  epoch BIGINT NOT NULL,
  action TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_owner_audit_tenant_time
ON tenant_owner_audit (tenant_id, created_at_ms DESC);

-- Offline inbound queue drain source
CREATE TABLE IF NOT EXISTS inbound_backlog (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_ref TEXT,
  payload_json JSONB,
  created_at_ms BIGINT NOT NULL,
  delivered_at_ms BIGINT,
  PRIMARY KEY (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_backlog_ready
ON inbound_backlog (tenant_id, delivered_at_ms, created_at_ms);

-- Hot write recovery buffer (crash recovery), not primary source of truth
CREATE UNLOGGED TABLE IF NOT EXISTS session_buffer (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  meta JSONB,
  PRIMARY KEY (tenant_id, session_id, seq)
);
