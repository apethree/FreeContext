import type { Pool } from "pg";
import type { HookAgentProfileConfig, HookAgentProfileRecord, HookAgentSessionMode } from "./types.js";

type HookAgentRow = {
  tenant_id: string;
  agent_id: string;
  enabled: boolean;
  config_json: unknown;
  created_at_ms: number | string;
  updated_at_ms: number | string;
};

export type UpsertHookAgentInput = {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  config?: Partial<HookAgentProfileConfig>;
  nowMs?: number;
};

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asSessionMode(value: unknown): HookAgentSessionMode | undefined {
  if (value === "isolated" || value === "shared") return value;
  return undefined;
}

function rowToRecord(row: HookAgentRow): HookAgentProfileRecord {
  const raw = asRecord(row.config_json);
  const agentId = row.agent_id;
  const enabled = Boolean(row.enabled);

  const config: HookAgentProfileConfig = {
    agentId,
    enabled,
    ...(asOptionalString(raw.provider) ? { provider: asOptionalString(raw.provider)! } : {}),
    ...(asOptionalString(raw.model) ? { model: asOptionalString(raw.model)! } : {}),
    ...(asOptionalString(raw.system) ? { system: asOptionalString(raw.system)! } : {}),
    ...(asOptionalString(raw.thinking) ? { thinking: asOptionalString(raw.thinking)! } : {}),
    ...(typeof raw.timeoutSeconds === "number" && Number.isFinite(raw.timeoutSeconds)
      ? { timeoutSeconds: Math.floor(raw.timeoutSeconds) }
      : {}),
    ...(asSessionMode(raw.sessionMode) ? { sessionMode: asSessionMode(raw.sessionMode)! } : {}),
    ...(typeof raw.summaryToMain === "boolean" ? { summaryToMain: raw.summaryToMain } : {}),
    ...(raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? { metadata: raw.metadata as Record<string, unknown> }
      : {}),
  };

  return {
    tenantId: row.tenant_id,
    agentId,
    enabled,
    config,
    createdAtMs: toNumber(row.created_at_ms),
    updatedAtMs: toNumber(row.updated_at_ms),
  };
}

function normalizeAgentConfig(input: {
  agentId: string;
  enabled: boolean;
  config?: Partial<HookAgentProfileConfig>;
}): HookAgentProfileConfig {
  const agentId = input.agentId.trim();
  if (!agentId) {
    throw new Error("agentId is required");
  }

  const source = input.config ?? {};
  const timeout = typeof source.timeoutSeconds === "number" && Number.isFinite(source.timeoutSeconds)
    ? Math.max(1, Math.min(3600, Math.floor(source.timeoutSeconds)))
    : undefined;

  return {
    agentId,
    enabled: Boolean(input.enabled),
    ...(asOptionalString(source.provider) ? { provider: asOptionalString(source.provider)! } : {}),
    ...(asOptionalString(source.model) ? { model: asOptionalString(source.model)! } : {}),
    ...(asOptionalString(source.system) ? { system: asOptionalString(source.system)! } : {}),
    ...(asOptionalString(source.thinking) ? { thinking: asOptionalString(source.thinking)! } : {}),
    ...(typeof timeout === "number" ? { timeoutSeconds: timeout } : {}),
    ...(asSessionMode(source.sessionMode) ? { sessionMode: asSessionMode(source.sessionMode)! } : {}),
    ...(typeof source.summaryToMain === "boolean" ? { summaryToMain: source.summaryToMain } : {}),
    ...(source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
      ? { metadata: source.metadata }
      : {}),
  };
}

export class HookAgentsRepo {
  constructor(private readonly pg: Pool) {}

  async listAgents(tenantId: string): Promise<HookAgentProfileRecord[]> {
    const result = await this.pg.query<HookAgentRow>(
      `SELECT tenant_id, agent_id, enabled, config_json, created_at_ms, updated_at_ms
       FROM hook_agents
       WHERE tenant_id = $1
       ORDER BY updated_at_ms DESC, agent_id ASC`,
      [tenantId],
    );
    return result.rows.map(rowToRecord);
  }

  async getAgent(tenantId: string, agentId: string): Promise<HookAgentProfileRecord | null> {
    const result = await this.pg.query<HookAgentRow>(
      `SELECT tenant_id, agent_id, enabled, config_json, created_at_ms, updated_at_ms
       FROM hook_agents
       WHERE tenant_id = $1 AND agent_id = $2
       LIMIT 1`,
      [tenantId, agentId],
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async upsertAgent(input: UpsertHookAgentInput): Promise<HookAgentProfileRecord> {
    const nowMs = input.nowMs ?? Date.now();
    const config = normalizeAgentConfig({
      agentId: input.agentId,
      enabled: input.enabled,
      config: input.config,
    });

    const result = await this.pg.query<HookAgentRow>(
      `INSERT INTO hook_agents (
         tenant_id, agent_id, enabled, config_json, created_at_ms, updated_at_ms
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5, $5
       )
       ON CONFLICT (tenant_id, agent_id)
       DO UPDATE SET
         enabled = EXCLUDED.enabled,
         config_json = EXCLUDED.config_json,
         updated_at_ms = EXCLUDED.updated_at_ms
       RETURNING tenant_id, agent_id, enabled, config_json, created_at_ms, updated_at_ms`,
      [
        input.tenantId,
        config.agentId,
        config.enabled,
        JSON.stringify(config),
        nowMs,
      ],
    );

    return rowToRecord(result.rows[0]);
  }

  async deleteAgent(tenantId: string, agentId: string): Promise<boolean> {
    const result = await this.pg.query(
      `DELETE FROM hook_agents
       WHERE tenant_id = $1 AND agent_id = $2`,
      [tenantId, agentId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
