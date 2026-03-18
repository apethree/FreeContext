import { Pool } from "pg";
import type { GatewayEnv } from "./config.js";

export function createPgPool(env: GatewayEnv): Pool {
  return new Pool({
    connectionString: env.PG_URL,
    max: 20,
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
}

export async function applyPostgresFixups(pool: Pool): Promise<void> {
  // Dev/staging instances can lag schema migrations. Keep runtime compatible.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'token_records'
      ) THEN
        ALTER TABLE token_records
        ADD COLUMN IF NOT EXISTS email TEXT;
      END IF;
    END
    $$;
  `);

  await pool.query(`
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
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hook_routes_tenant_enabled
    ON hook_routes (tenant_id, enabled)
  `);

  await pool.query(`
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
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hook_events_tenant_time
    ON hook_events (tenant_id, created_at_ms DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hook_events_tenant_status
    ON hook_events (tenant_id, status, created_at_ms DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hook_agents (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      PRIMARY KEY (tenant_id, agent_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hook_agents_tenant_enabled
    ON hook_agents (tenant_id, enabled, updated_at_ms DESC)
  `);
}
