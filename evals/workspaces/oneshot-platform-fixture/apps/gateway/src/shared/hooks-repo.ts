import type { Pool } from "pg";
import type { HookAction, HookEventRecord, HookEventStatus, HookRouteConfig, HookRouteRecord } from "./types.js";

type HookRouteRow = {
  tenant_id: string;
  name: string;
  action: string;
  enabled: boolean;
  token_hash: string | null;
  config_json: unknown;
  created_at_ms: number | string;
  updated_at_ms: number | string;
};

type HookEventRow = {
  event_id: string;
  tenant_id: string;
  hook_name: string;
  action: string;
  source: string;
  path: string;
  status: string;
  error: string | null;
  payload_ref: string | null;
  payload_json: unknown;
  created_at_ms: number | string;
  processed_at_ms: number | string | null;
};

export type UpsertHookRouteInput = {
  tenantId: string;
  name: string;
  action: HookAction;
  enabled: boolean;
  tokenHash?: string | null;
  config?: Partial<HookRouteConfig>;
  nowMs?: number;
};

export type InsertHookEventInput = {
  eventId: string;
  tenantId: string;
  hookName: string;
  action: HookAction;
  source: string;
  path: string;
  status: HookEventStatus;
  error?: string | null;
  payloadRef?: string | null;
  payloadJson?: unknown;
  createdAtMs?: number;
  processedAtMs?: number | null;
};

function normalizeAction(action: string): HookAction {
  const value = action.trim().toLowerCase();
  if (value === "wake" || value === "agent") return value;
  throw new Error(`invalid hook action: ${action}`);
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function rowToRoute(row: HookRouteRow): HookRouteRecord {
  const configRaw = row.config_json && typeof row.config_json === "object"
    ? (row.config_json as Record<string, unknown>)
    : {};
  const config: HookRouteConfig = {
    name: row.name,
    action: normalizeAction(row.action),
    enabled: row.enabled,
    ...(row.token_hash ? { tokenHash: row.token_hash } : {}),
    ...(configRaw as Partial<HookRouteConfig>),
  };
  return {
    tenantId: row.tenant_id,
    name: row.name,
    action: normalizeAction(row.action),
    enabled: row.enabled,
    tokenHash: row.token_hash,
    config,
    createdAtMs: toNumber(row.created_at_ms),
    updatedAtMs: toNumber(row.updated_at_ms),
  };
}

function rowToEvent(row: HookEventRow): HookEventRecord {
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    hookName: row.hook_name,
    action: normalizeAction(row.action),
    source: row.source,
    path: row.path,
    status: row.status as HookEventStatus,
    error: row.error,
    payloadRef: row.payload_ref,
    payloadJson: row.payload_json,
    createdAtMs: toNumber(row.created_at_ms),
    processedAtMs: row.processed_at_ms == null ? null : toNumber(row.processed_at_ms),
  };
}

export class HooksRepo {
  constructor(private readonly pg: Pool) {}

  async listRoutes(tenantId: string): Promise<HookRouteRecord[]> {
    const result = await this.pg.query<HookRouteRow>(
      `SELECT tenant_id, name, action, enabled, token_hash, config_json, created_at_ms, updated_at_ms
       FROM hook_routes
       WHERE tenant_id = $1
       ORDER BY updated_at_ms DESC, name ASC`,
      [tenantId],
    );
    return result.rows.map(rowToRoute);
  }

  async getRoute(tenantId: string, name: string): Promise<HookRouteRecord | null> {
    const result = await this.pg.query<HookRouteRow>(
      `SELECT tenant_id, name, action, enabled, token_hash, config_json, created_at_ms, updated_at_ms
       FROM hook_routes
       WHERE tenant_id = $1 AND name = $2
       LIMIT 1`,
      [tenantId, name],
    );
    const row = result.rows[0];
    return row ? rowToRoute(row) : null;
  }

  async upsertRoute(input: UpsertHookRouteInput): Promise<HookRouteRecord> {
    const nowMs = input.nowMs ?? Date.now();
    const name = input.name.trim();
    if (!name) throw new Error("hook route name is required");

    const action = normalizeAction(input.action);
    const config: HookRouteConfig = {
      ...(input.config ?? {}),
      name,
      action,
      enabled: input.enabled,
      ...(typeof input.tokenHash === "string" && input.tokenHash.trim().length > 0 ? { tokenHash: input.tokenHash.trim() } : {}),
    };

    const result = await this.pg.query<HookRouteRow>(
      `INSERT INTO hook_routes (
         tenant_id, name, action, enabled, token_hash, config_json, created_at_ms, updated_at_ms
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7, $7
       )
       ON CONFLICT (tenant_id, name)
       DO UPDATE SET
         action = EXCLUDED.action,
         enabled = EXCLUDED.enabled,
         token_hash = EXCLUDED.token_hash,
         config_json = EXCLUDED.config_json,
         updated_at_ms = EXCLUDED.updated_at_ms
       RETURNING tenant_id, name, action, enabled, token_hash, config_json, created_at_ms, updated_at_ms`,
      [
        input.tenantId,
        name,
        action,
        input.enabled,
        input.tokenHash ?? null,
        JSON.stringify(config),
        nowMs,
      ],
    );
    return rowToRoute(result.rows[0]);
  }

  async deleteRoute(tenantId: string, name: string): Promise<boolean> {
    const result = await this.pg.query(
      `DELETE FROM hook_routes WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertEvent(input: InsertHookEventInput): Promise<HookEventRecord> {
    const createdAtMs = input.createdAtMs ?? Date.now();
    const result = await this.pg.query<HookEventRow>(
      `INSERT INTO hook_events (
         event_id, tenant_id, hook_name, action, source, path, status, error,
         payload_ref, payload_json, created_at_ms, processed_at_ms
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10::jsonb, $11, $12
       )
       RETURNING event_id, tenant_id, hook_name, action, source, path, status, error,
                 payload_ref, payload_json, created_at_ms, processed_at_ms`,
      [
        input.eventId,
        input.tenantId,
        input.hookName,
        normalizeAction(input.action),
        input.source,
        input.path,
        input.status,
        input.error ?? null,
        input.payloadRef ?? null,
        JSON.stringify(input.payloadJson ?? {}),
        createdAtMs,
        input.processedAtMs ?? null,
      ],
    );
    return rowToEvent(result.rows[0]);
  }

  async updateEventStatus(
    eventId: string,
    status: HookEventStatus,
    error: string | null = null,
    processedAtMs: number | null = null,
  ): Promise<void> {
    await this.pg.query(
      `UPDATE hook_events
       SET status = $2,
           error = $3,
           processed_at_ms = $4
       WHERE event_id = $1`,
      [eventId, status, error, processedAtMs],
    );
  }
}
