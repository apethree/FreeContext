import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { responseError, responseOk } from "../shared/protocol.js";
import type { AuthContext, HookAction, RequestFrame, ResponseFrame, TokenKind, TokenRecord } from "../shared/types.js";
import { callLlmProviderStream, refreshOAuthTokenViaPiAi, type LlmMessage } from "../shared/pi-ai-adapter.js";
import { nextEventSeq, nextSessionSeq } from "../shared/sequence.js";
import { redisKeys } from "../shared/redis-keys.js";
import { reserveDurableIdempotency, reserveFastIdempotency } from "../shared/idempotency.js";
import { fingerprintToken } from "../shared/token-crypto.js";
import { logEvent } from "../shared/logger.js";
import type { TokenVault } from "../shared/token-vault.js";
import { hashHookToken } from "../shared/hooks-auth.js";
import { hasPlugin, dispatchPlugin } from "../channels/plugin-registry.js";

type MethodDeps = {
  pg: Pool;
  redis: Redis;
  tokenVault: TokenVault;
  emitEvent: (event: string, payload: unknown) => Promise<void>;
};

type MethodContext = AuthContext;

type LeaseRecord = {
  deviceId: string;
  userId: string;
  expiresAtMs: number;
  updatedAtMs: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeProvider(provider: string): string {
  const p = provider.toLowerCase().trim();
  if (p === "openai" || p === "openai-codex") return "openai";
  if (p === "anthropic" || p === "claude") return "anthropic";
  if (p === "gemini" || p === "google-gemini-cli" || p === "gemini-cli") return "gemini";
  return p;
}

function tokenKind(value: unknown): TokenKind {
  if (value === "oauth" || value === "api-key") return value;
  throw new Error("tokenKind must be oauth or api-key");
}

function opIdFrom(params: Record<string, unknown>): string {
  const v = optionalString(params.opId);
  return v ?? `toksync-${crypto.randomUUID()}`;
}

function sourceFrom(params: Record<string, unknown>): string {
  return optionalString(params.source) ?? "unknown";
}

const PROVIDER_PROBE_SYSTEM_PROMPT = "You are a provider capability check. Reply with OK only.";
const PROVIDER_PROBE_USER_MESSAGE = "Reply with OK.";
const PROVIDER_PROBE_MAX_TOKENS = 16;
const DEFAULT_PROVIDER_PROBE_MODELS: Record<string, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4.5",
  gemini: "gemini-2.5-flash",
};

function parseHookAction(value: unknown): HookAction {
  const action = optionalString(value)?.toLowerCase();
  if (action === "wake" || action === "agent") return action;
  throw new Error("action must be 'wake' or 'agent'");
}

function defaultProbeModel(provider: string): string {
  return DEFAULT_PROVIDER_PROBE_MODELS[provider] ?? "gpt-5-mini";
}

async function ensureSession(pg: Pool, tenantId: string, sessionId: string): Promise<void> {
  const now = Date.now();
  await pg.query(
    `INSERT INTO sessions (id, tenant_id, created_at, updated_at, revision, meta)
     VALUES ($1, $2, $3, $4, 0, '{}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
    [sessionId, tenantId, now, now],
  );
}

async function appendMessage(pg: Pool, input: {
  tenantId: string;
  sessionId: string;
  seq: number;
  role: string;
  content: string;
  idempotencyKey?: string;
  meta?: unknown;
}): Promise<{ id: string; createdAt: number }> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await pg.query(
    `INSERT INTO messages
      (id, session_id, tenant_id, seq, role, content, idempotency_key, in_r2, created_at, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8,$9::jsonb)`,
    [
      id,
      input.sessionId,
      input.tenantId,
      input.seq,
      input.role,
      input.content,
      input.idempotencyKey ?? null,
      createdAt,
      JSON.stringify(input.meta ?? {}),
    ],
  );
  return { id, createdAt };
}

async function emitChatEvent(
  deps: MethodDeps,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const seq = await nextEventSeq(deps.redis, tenantId);
  await deps.emitEvent("chat", { ...payload, seq });
}

async function methodHealthPing(ctx: MethodContext): Promise<unknown> {
  return {
    ok: true,
    tenantId: ctx.tenantId,
    tenantType: ctx.tenantType,
    userId: ctx.userId,
    role: ctx.role,
    scopes: ctx.scopes,
    ts: Date.now(),
  };
}

async function methodHealthEcho(_ctx: MethodContext, params: unknown): Promise<unknown> {
  return {
    ok: true,
    echo: params ?? null,
    ts: Date.now(),
  };
}

async function methodNodePing(ctx: MethodContext): Promise<unknown> {
  return {
    ok: true,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    deviceId: ctx.deviceId ?? null,
    role: ctx.role,
    ts: Date.now(),
  };
}

async function methodDeviceRegister(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const deviceId = asNonEmptyString(p.deviceId, "deviceId");
  const publicKey = asNonEmptyString(p.publicKey, "publicKey");
  const displayName = optionalString(p.displayName);
  const platform = optionalString(p.platform);
  const deviceToken = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();

  const existing = await deps.pg.query<{ tenant_id: string }>(
    `SELECT tenant_id
     FROM devices
     WHERE id = $1
     LIMIT 1`,
    [deviceId],
  );
  if (existing.rows.length > 0 && existing.rows[0].tenant_id !== ctx.tenantId) {
    throw new Error("device id already registered to a different tenant");
  }

  await deps.pg.query(
    `INSERT INTO devices
      (id, tenant_id, display_name, platform, public_key, device_token, paired_at, last_seen_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       platform = EXCLUDED.platform,
       public_key = EXCLUDED.public_key,
       device_token = EXCLUDED.device_token,
       last_seen_at = EXCLUDED.last_seen_at,
       is_active = TRUE
     WHERE devices.tenant_id = EXCLUDED.tenant_id`,
    [deviceId, ctx.tenantId, displayName, platform, publicKey, deviceToken, now, now],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    deviceId,
    deviceToken,
    pairedAt: now,
  };
}

async function methodSessionUpsert(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  await ensureSession(deps.pg, ctx.tenantId, sessionId);
  return { ok: true, tenantId: ctx.tenantId, sessionId };
}

async function methodChatHistory(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const afterSeq = typeof p.afterSeq === "number" && Number.isFinite(p.afterSeq) ? Math.max(0, p.afterSeq) : 0;
  const limit = typeof p.limit === "number" && Number.isFinite(p.limit)
    ? Math.min(Math.max(1, Math.floor(p.limit)), 200)
    : 50;

  const result = await deps.pg.query<{
    id: string;
    seq: number;
    role: string;
    content: string;
    created_at: number;
    meta: unknown;
  }>(
    `SELECT id, seq, role, content, created_at, meta
     FROM messages
     WHERE tenant_id = $1 AND session_id = $2 AND seq > $3
     ORDER BY seq ASC
     LIMIT $4`,
    [ctx.tenantId, sessionId, afterSeq, limit],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    sessionId,
    messages: result.rows.map((row) => ({
      id: row.id,
      seq: toFiniteNumber(row.seq),
      role: row.role,
      content: row.content,
      createdAt: toFiniteNumber(row.created_at),
      meta: row.meta,
    })),
  };
}

async function methodChatAppend(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const role = asNonEmptyString(p.role, "role");
  const content = asNonEmptyString(p.content, "content");
  const idempotencyKey = optionalString(p.idempotencyKey) ?? undefined;

  await ensureSession(deps.pg, ctx.tenantId, sessionId);

  if (idempotencyKey) {
    const existing = await deps.pg.query<{
      id: string;
      seq: number;
      created_at: number;
    }>(
      `SELECT id, seq, created_at
       FROM messages
       WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3
       LIMIT 1`,
      [ctx.tenantId, sessionId, idempotencyKey],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        ok: true,
        duplicate: true,
        tenantId: ctx.tenantId,
        sessionId,
        messageId: row.id,
        seq: toFiniteNumber(row.seq),
        createdAt: toFiniteNumber(row.created_at),
      };
    }
  }

  const seq = await nextSessionSeq(deps.redis, ctx.tenantId, sessionId);
  const saved = await appendMessage(deps.pg, {
    tenantId: ctx.tenantId,
    sessionId,
    seq,
    role,
    content,
    idempotencyKey,
    meta: asObject(p.meta) ?? {},
  });

  await emitChatEvent(deps, ctx.tenantId, {
    sessionKey: sessionId,
    tenantId: ctx.tenantId,
    messageId: saved.id,
    seq,
    state: "final",
    message: { role, text: content },
    createdAt: saved.createdAt,
  });

  return {
    ok: true,
    duplicate: false,
    tenantId: ctx.tenantId,
    sessionId,
    messageId: saved.id,
    seq,
    createdAt: saved.createdAt,
  };
}

async function methodDebugSnapshot(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const limitRaw = typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.floor(p.limit) : 20;
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  const sessions = await deps.pg.query<{
    id: string;
    updated_at: number;
    revision: number;
    meta: unknown;
  }>(
    `SELECT id, updated_at, revision, meta
     FROM sessions
     WHERE tenant_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [ctx.tenantId, limit],
  );

  const counts = await deps.pg.query<{ label: string; count: string }>(
    `SELECT 'messages' AS label, COUNT(*)::text AS count FROM messages WHERE tenant_id = $1
     UNION ALL
     SELECT 'channels' AS label, COUNT(*)::text AS count FROM channels WHERE tenant_id = $1
     UNION ALL
     SELECT 'jobs' AS label, COUNT(*)::text AS count FROM jobs WHERE tenant_id = $1
     UNION ALL
     SELECT 'tokens' AS label, COUNT(*)::text AS count FROM token_records WHERE tenant_id = $1`,
    [ctx.tenantId],
  );

  const channels = await deps.pg.query<{
    id: string;
    type: string;
    is_active: boolean;
    created_at: number;
  }>(
    `SELECT id, type, is_active, created_at
     FROM channels
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [ctx.tenantId, limit],
  );

  return {
    ok: true,
    ts: Date.now(),
    context: {
      tenantId: ctx.tenantId,
      tenantType: ctx.tenantType,
      userId: ctx.userId,
      role: ctx.role,
      scopes: ctx.scopes,
    },
    postgres: {
      sessions: sessions.rows.map((row) => ({
        id: row.id,
        updatedAt: row.updated_at,
        revision: row.revision,
        meta: row.meta ?? null,
      })),
      channels: channels.rows.map((row) => ({
        id: row.id,
        type: row.type,
        isActive: row.is_active,
        createdAt: row.created_at,
      })),
      counts: Object.fromEntries(counts.rows.map((row) => [row.label, Number(row.count)])),
    },
    redis: {
      ownerKey: redisKeys.tenantOwner(ctx.tenantId),
      owner: await deps.redis.get(redisKeys.tenantOwner(ctx.tenantId)),
    },
  };
}

async function methodChannelUpsert(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const channelId = optionalString(p.channelId) ?? crypto.randomUUID();
  const type = asNonEmptyString(p.type, "type").toLowerCase();
  const isActive = typeof p.isActive === "boolean" ? p.isActive : true;
  const config = asObject(p.config) ?? {};
  const now = Date.now();

  await deps.pg.query(
    `INSERT INTO channels (tenant_id, id, type, config, is_active, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       type = EXCLUDED.type,
       config = EXCLUDED.config,
       is_active = EXCLUDED.is_active`,
    [ctx.tenantId, channelId, type, JSON.stringify(config), isActive, now],
  );

  if (hasPlugin(type)) {
    try {
      await dispatchPlugin(type, "apply", {
        tenantId: ctx.tenantId,
        channelId,
        channelType: type,
        isActive,
        config,
      });
    } catch (err) {
      logEvent("gateway-realtime", "channel.upsert.apply-warning", {
        tenantId: ctx.tenantId,
        channelId,
        channelType: type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    tenantId: ctx.tenantId,
    channelId,
    type,
    isActive,
    updatedAtMs: now,
  };
}

async function methodChannelList(ctx: MethodContext, _params: unknown, deps: MethodDeps): Promise<unknown> {
  const rows = await deps.pg.query<{
    id: string;
    type: string;
    is_active: boolean;
    created_at: number;
  }>(
    `SELECT id, type, is_active, created_at
     FROM channels
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [ctx.tenantId],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    channels: rows.rows.map((row) => ({
      id: row.id,
      type: row.type,
      isActive: row.is_active,
      createdAt: row.created_at,
    })),
  };
}

async function methodChannelDelete(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const channelId = asNonEmptyString(p.channelId, "channelId");

  const existing = await deps.pg.query<{
    type: string;
    config: unknown;
  }>(
    `SELECT type, config FROM channels WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [ctx.tenantId, channelId],
  );

  if (existing.rows[0] && hasPlugin(existing.rows[0].type)) {
    try {
      const config = (typeof existing.rows[0].config === "object" && existing.rows[0].config
        ? existing.rows[0].config
        : {}) as Record<string, unknown>;
      await dispatchPlugin(existing.rows[0].type, "destroy", {
        tenantId: ctx.tenantId,
        channelId,
        channelType: existing.rows[0].type,
        config,
      });
    } catch (err) {
      logEvent("gateway-realtime", "channel.delete.destroy-warning", {
        tenantId: ctx.tenantId,
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = await deps.pg.query(
    `DELETE FROM channels WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, channelId],
  );
  return {
    ok: true,
    tenantId: ctx.tenantId,
    channelId,
    deleted: (result.rowCount ?? 0) > 0,
  };
}

async function methodChannelStatus(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const channelId = asNonEmptyString(p.channelId, "channelId");
  const channel = await deps.pg.query<{
    id: string;
    type: string;
    is_active: boolean;
    created_at: number;
  }>(
    `SELECT id, type, is_active, created_at
     FROM channels
     WHERE tenant_id = $1 AND id = $2
     LIMIT 1`,
    [ctx.tenantId, channelId],
  );
  if (channel.rows.length === 0) {
    return { ok: true, found: false, channelId };
  }

  const jobs = await deps.pg.query<{
    id: string;
    status: string;
    attempt: number;
    last_error: string | null;
    updated_at: number;
  }>(
    `SELECT id, status, attempt, last_error, updated_at
     FROM jobs
     WHERE tenant_id = $1 AND channel_id = $2
     ORDER BY updated_at DESC
     LIMIT 10`,
    [ctx.tenantId, channelId],
  );

  const rows = jobs.rows;
  const completed = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const queued = rows.filter((row) => row.status === "queued" || row.status === "pending" || row.status === "retrying").length;
  const lastActivity = rows[0]?.updated_at ?? null;
  const lastError = rows.find((row) => row.status === "failed" && row.last_error)?.last_error ?? null;
  const row = channel.rows[0];

  return {
    ok: true,
    found: true,
    channel: {
      id: row.id,
      type: row.type,
      isActive: row.is_active,
      createdAt: row.created_at,
    },
    health: {
      recentJobCount: rows.length,
      completed,
      failed,
      queued,
      lastActivity,
      lastError,
    },
  };
}

async function methodChannelProbe(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const channelId = asNonEmptyString(p.channelId, "channelId");
  const result = await deps.pg.query<{
    id: string;
    type: string;
    config: unknown;
    is_active: boolean;
  }>(
    `SELECT id, type, config, is_active
     FROM channels
     WHERE tenant_id = $1 AND id = $2
     LIMIT 1`,
    [ctx.tenantId, channelId],
  );

  const channel = result.rows[0];
  if (!channel) return { ok: false, channelId, error: "channel not found" };
  const config = (typeof channel.config === "object" && channel.config ? channel.config : {}) as Record<string, unknown>;
  const type = channel.type.toLowerCase();
  const startedAt = Date.now();

  if (["webhook", "relay"].includes(type)) {
    return { ok: true, channelId, probe: { ok: true, skipped: true } };
  }

  if (hasPlugin(type)) {
    const probeResult = await dispatchPlugin(type, "probe", {
      tenantId: ctx.tenantId,
      channelId,
      channelType: type,
      config,
    });
    return { ok: true, channelId, probe: probeResult, elapsed: Date.now() - startedAt };
  }

  return { ok: false, channelId, error: `unsupported channel type: ${type}` };
}

async function methodHookRouteList(ctx: MethodContext, _params: unknown, deps: MethodDeps): Promise<unknown> {
  const rows = await deps.pg.query<{
    tenant_id: string;
    name: string;
    action: string;
    enabled: boolean;
    token_hash: string | null;
    config_json: unknown;
    created_at_ms: number;
    updated_at_ms: number;
  }>(
    `SELECT tenant_id, name, action, enabled, token_hash, config_json, created_at_ms, updated_at_ms
     FROM hook_routes
     WHERE tenant_id = $1
     ORDER BY updated_at_ms DESC, name ASC`,
    [ctx.tenantId],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    routes: rows.rows.map((row) => ({
      tenantId: row.tenant_id,
      name: row.name,
      action: row.action,
      enabled: row.enabled,
      tokenHash: row.token_hash,
      config: asObject(row.config_json) ?? {},
      createdAtMs: toFiniteNumber(row.created_at_ms),
      updatedAtMs: toFiniteNumber(row.updated_at_ms),
    })),
  };
}

async function methodHookRouteUpsert(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const name = asNonEmptyString(p.name, "name");
  const action = parseHookAction(p.action);
  const enabled = typeof p.enabled === "boolean" ? p.enabled : true;
  const config = asObject(p.config) ?? {};
  const tokenHash = optionalString(p.tokenHash)
    ?? (optionalString(p.token) ? hashHookToken(optionalString(p.token)!) : null);
  const nowMs = Date.now();
  const mergedConfig = {
    ...config,
    name,
    action,
    enabled,
    ...(tokenHash ? { tokenHash } : {}),
  };

  const result = await deps.pg.query<{
    tenant_id: string;
    name: string;
    action: string;
    enabled: boolean;
    token_hash: string | null;
    config_json: unknown;
    created_at_ms: number;
    updated_at_ms: number;
  }>(
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
      ctx.tenantId,
      name,
      action,
      enabled,
      tokenHash,
      JSON.stringify(mergedConfig),
      nowMs,
    ],
  );

  const row = result.rows[0];
  return {
    ok: true,
    route: {
      tenantId: row.tenant_id,
      name: row.name,
      action: row.action,
      enabled: row.enabled,
      tokenHash: row.token_hash,
      config: asObject(row.config_json) ?? {},
      createdAtMs: toFiniteNumber(row.created_at_ms),
      updatedAtMs: toFiniteNumber(row.updated_at_ms),
    },
  };
}

async function methodHookRouteDelete(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const name = asNonEmptyString(p.name, "name");
  const result = await deps.pg.query(
    `DELETE FROM hook_routes
     WHERE tenant_id = $1 AND name = $2`,
    [ctx.tenantId, name],
  );
  return { ok: true, tenantId: ctx.tenantId, name, deleted: (result.rowCount ?? 0) > 0 };
}

async function methodHookEventList(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const limitRaw = typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.floor(p.limit) : 50;
  const limit = Math.min(Math.max(limitRaw, 1), 200);

  const rows = await deps.pg.query<{
    event_id: string;
    hook_name: string;
    action: string;
    source: string;
    path: string;
    status: string;
    error: string | null;
    payload_ref: string | null;
    payload_json: unknown;
    created_at_ms: number;
    processed_at_ms: number | null;
  }>(
    `SELECT event_id, hook_name, action, source, path, status, error, payload_ref, payload_json, created_at_ms, processed_at_ms
     FROM hook_events
     WHERE tenant_id = $1
     ORDER BY created_at_ms DESC
     LIMIT $2`,
    [ctx.tenantId, limit],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    events: rows.rows.map((row) => ({
      eventId: row.event_id,
      hookName: row.hook_name,
      action: row.action,
      source: row.source,
      path: row.path,
      status: row.status,
      error: row.error,
      payloadRef: row.payload_ref,
      payloadJson: row.payload_json,
      createdAtMs: toFiniteNumber(row.created_at_ms),
      processedAtMs: row.processed_at_ms == null ? null : toFiniteNumber(row.processed_at_ms),
    })),
  };
}

async function methodHookAgentList(ctx: MethodContext, _params: unknown, deps: MethodDeps): Promise<unknown> {
  const rows = await deps.pg.query<{
    tenant_id: string;
    agent_id: string;
    enabled: boolean;
    config_json: unknown;
    created_at_ms: number;
    updated_at_ms: number;
  }>(
    `SELECT tenant_id, agent_id, enabled, config_json, created_at_ms, updated_at_ms
     FROM hook_agents
     WHERE tenant_id = $1
     ORDER BY updated_at_ms DESC, agent_id ASC`,
    [ctx.tenantId],
  );

  return {
    ok: true,
    tenantId: ctx.tenantId,
    agents: rows.rows.map((row) => ({
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      enabled: row.enabled,
      config: asObject(row.config_json) ?? {},
      createdAtMs: toFiniteNumber(row.created_at_ms),
      updatedAtMs: toFiniteNumber(row.updated_at_ms),
    })),
  };
}

async function methodHookAgentUpsert(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const agentId = asNonEmptyString(p.agentId, "agentId");
  const enabled = typeof p.enabled === "boolean" ? p.enabled : true;
  const config = asObject(p.config) ?? {};
  const nowMs = Date.now();
  const mergedConfig = {
    ...config,
    agentId,
    enabled,
  };

  const result = await deps.pg.query<{
    tenant_id: string;
    agent_id: string;
    enabled: boolean;
    config_json: unknown;
    created_at_ms: number;
    updated_at_ms: number;
  }>(
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
      ctx.tenantId,
      agentId,
      enabled,
      JSON.stringify(mergedConfig),
      nowMs,
    ],
  );

  const row = result.rows[0];
  return {
    ok: true,
    agent: {
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      enabled: row.enabled,
      config: asObject(row.config_json) ?? {},
      createdAtMs: toFiniteNumber(row.created_at_ms),
      updatedAtMs: toFiniteNumber(row.updated_at_ms),
    },
  };
}

async function methodHookAgentDelete(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const agentId = asNonEmptyString(p.agentId, "agentId");
  const result = await deps.pg.query(
    `DELETE FROM hook_agents
     WHERE tenant_id = $1 AND agent_id = $2`,
    [ctx.tenantId, agentId],
  );
  return { ok: true, tenantId: ctx.tenantId, agentId, deleted: (result.rowCount ?? 0) > 0 };
}

async function readLease(redis: Redis, tenantId: string, sessionId: string): Promise<LeaseRecord | null> {
  const raw = await redis.get(redisKeys.turnLease(tenantId, sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LeaseRecord;
  } catch {
    return null;
  }
}

async function writeLease(redis: Redis, tenantId: string, sessionId: string, lease: LeaseRecord): Promise<void> {
  const ttlMs = Math.max(1, lease.expiresAtMs - Date.now());
  await redis.set(redisKeys.turnLease(tenantId, sessionId), JSON.stringify(lease), "PX", ttlMs);
}

async function methodTurnAcquire(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const deviceId = optionalString(p.deviceId) ?? ctx.deviceId ?? "unknown-device";
  const ttlMsRaw = typeof p.ttlMs === "number" && Number.isFinite(p.ttlMs) ? p.ttlMs : 300_000;
  const ttlMs = Math.min(300_000, Math.max(30_000, Math.floor(ttlMsRaw)));

  const now = Date.now();
  const current = await readLease(deps.redis, ctx.tenantId, sessionId);
  if (current && current.expiresAtMs > now && current.deviceId !== deviceId) {
    return {
      ok: false,
      acquired: false,
      code: "TURN_BUSY",
      heldBy: current.deviceId,
      retryAfterMs: Math.max(0, current.expiresAtMs - now),
    };
  }

  const lease: LeaseRecord = {
    deviceId,
    userId: ctx.userId,
    expiresAtMs: now + ttlMs,
    updatedAtMs: now,
  };
  await writeLease(deps.redis, ctx.tenantId, sessionId, lease);
  return { ok: true, acquired: true, sessionId, deviceId, expiresAtMs: lease.expiresAtMs };
}

async function methodTurnHeartbeat(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const deviceId = optionalString(p.deviceId) ?? ctx.deviceId ?? "unknown-device";

  const now = Date.now();
  const current = await readLease(deps.redis, ctx.tenantId, sessionId);
  if (!current || current.deviceId !== deviceId || current.expiresAtMs <= now) {
    return { ok: false, renewed: false, code: "TURN_NOT_HELD" };
  }

  current.expiresAtMs = now + 300_000;
  current.updatedAtMs = now;
  await writeLease(deps.redis, ctx.tenantId, sessionId, current);
  return { ok: true, renewed: true, sessionId, deviceId, expiresAtMs: current.expiresAtMs };
}

async function methodTurnRelease(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const deviceId = optionalString(p.deviceId) ?? ctx.deviceId ?? "unknown-device";

  const current = await readLease(deps.redis, ctx.tenantId, sessionId);
  if (!current || current.deviceId !== deviceId) {
    return { ok: false, released: false, code: "TURN_NOT_HELD" };
  }

  await deps.redis.del(redisKeys.turnLease(ctx.tenantId, sessionId));
  return { ok: true, released: true, sessionId, deviceId };
}

async function methodTokenSyncPush(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const opId = opIdFrom(p);
  const source = sourceFrom(p);

  const provider = normalizeProvider(asNonEmptyString(p.provider, "provider"));
  const token = asNonEmptyString(p.token, "token");
  const kind = tokenKind(p.tokenKind);

  const record: TokenRecord = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
    token,
    tokenKind: kind,
    updatedAtMs: Date.now(),
    ...(optionalString(p.email) ? { email: optionalString(p.email)! } : {}),
    ...(optionalString(p.piProviderId) ? { piProviderId: optionalString(p.piProviderId)! } : {}),
    ...(optionalString(p.oauthProviderId) ? { oauthProviderId: optionalString(p.oauthProviderId)! } : {}),
    ...(optionalString(p.refreshToken) ? { refreshToken: optionalString(p.refreshToken)! } : {}),
    ...(typeof p.expiresAtMs === "number" && Number.isFinite(p.expiresAtMs) ? { expiresAtMs: Math.floor(p.expiresAtMs) } : {}),
    ...(optionalString(p.accountId) ? { accountId: optionalString(p.accountId)! } : {}),
    ...(optionalString(p.projectId) ? { projectId: optionalString(p.projectId)! } : {}),
    ...(asObject(p.metadata) ? { metadata: asObject(p.metadata)! } : {}),
  };

  logEvent("gateway-realtime", "token.sync.push.start", {
    opId,
    source,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
    tokenKind: kind,
  });

  const result = await deps.tokenVault.put(record);

  logEvent("gateway-realtime", "token.sync.push.verified", {
    opId,
    source,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
    tokenKind: kind,
    verified: result.verified,
    fingerprint: result.fingerprint,
    updatedAtMs: result.updatedAtMs,
  });

  return {
    ok: true,
    opId,
    verified: result.verified,
    hasToken: true,
    tokenKind: kind,
    fingerprint: result.fingerprint,
    updatedAtMs: result.updatedAtMs,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

async function methodTokenSyncPull(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const provider = normalizeProvider(asNonEmptyString(p.provider, "provider"));
  const opId = opIdFrom(p);
  const source = sourceFrom(p);
  const record = await deps.tokenVault.get(ctx.tenantId, ctx.userId, provider);

  logEvent("gateway-realtime", "token.sync.pull", {
    opId,
    source,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
    hasToken: Boolean(record?.token),
  });

  return {
    ok: true,
    opId,
    provider,
    hasToken: Boolean(record?.token),
    token: record?.token ?? null,
    tokenKind: record?.tokenKind ?? null,
    fingerprint: record?.token ? fingerprintToken(record.token) : null,
    updatedAtMs: record?.updatedAtMs ?? null,
    email: record?.email ?? null,
    piProviderId: record?.piProviderId ?? null,
    oauthProviderId: record?.oauthProviderId ?? null,
    refreshToken: record?.refreshToken ?? null,
    expiresAtMs: record?.expiresAtMs ?? null,
    accountId: record?.accountId ?? null,
    projectId: record?.projectId ?? null,
    metadata: record?.metadata ?? null,
  };
}

async function methodTokenSyncDelete(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const provider = normalizeProvider(asNonEmptyString(p.provider, "provider"));
  const opId = opIdFrom(p);
  const source = sourceFrom(p);

  logEvent("gateway-realtime", "token.sync.delete.start", {
    opId,
    source,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
  });

  const result = await deps.tokenVault.delete(ctx.tenantId, ctx.userId, provider);

  logEvent("gateway-realtime", "token.sync.delete.verified", {
    opId,
    source,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    provider,
    verified: result.verified,
    updatedAtMs: result.updatedAtMs,
  });

  return {
    ok: true,
    opId,
    provider,
    verified: result.verified,
    deleted: result.verified,
    hasToken: !result.verified,
    updatedAtMs: result.updatedAtMs,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

async function methodProviderProbe(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const provider = normalizeProvider(asNonEmptyString(p.provider, "provider"));
  const model = optionalString(p.model) ?? defaultProbeModel(provider);
  const opId = opIdFrom(p);
  const source = sourceFrom(p);
  const startedAt = Date.now();

  const tokenRecord = await deps.tokenVault.get(ctx.tenantId, ctx.userId, provider);
  if (!tokenRecord?.token) {
    logEvent("gateway-realtime", "provider.probe", {
      opId,
      source,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      provider,
      model,
      capable: false,
      code: "MISSING_PROVIDER_TOKEN",
    });
    return {
      ok: true,
      opId,
      provider,
      model,
      capable: false,
      code: "MISSING_PROVIDER_TOKEN",
      error: `no token synced for provider: ${provider}`,
      latencyMs: Date.now() - startedAt,
    };
  }

  if (tokenRecord.tokenKind === "oauth" && tokenRecord.expiresAtMs && tokenRecord.refreshToken) {
    if (tokenRecord.expiresAtMs - Date.now() < 60_000) {
      try {
        const refreshed = await refreshOAuthTokenViaPiAi(tokenRecord.oauthProviderId ?? provider, tokenRecord);
        if (refreshed) {
          await deps.tokenVault.put(refreshed);
          Object.assign(tokenRecord, refreshed);
        }
      } catch (refreshError) {
        logEvent("gateway-realtime", "provider.probe.token_refresh_failed", {
          opId,
          source,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          provider,
          model,
          error: String(refreshError),
        });
      }
    }
  }

  try {
    const stream = await callLlmProviderStream({
      provider,
      model,
      token: tokenRecord.token,
      tokenRecord,
      messages: [{ role: "user", content: PROVIDER_PROBE_USER_MESSAGE }],
      system: PROVIDER_PROBE_SYSTEM_PROMPT,
      maxTokens: PROVIDER_PROBE_MAX_TOKENS,
      sessionId: `probe-${ctx.userId}-${crypto.randomUUID()}`,
    });
    const reader = stream.getReader();
    let streamError: string | null = null;
    let completed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "error") {
        streamError = value.error;
        break;
      }
      if (value.type === "done") {
        completed = true;
        break;
      }
    }
    void reader.cancel().catch(() => {});

    if (streamError) {
      logEvent("gateway-realtime", "provider.probe", {
        opId,
        source,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_ERROR",
        error: streamError,
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        opId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_ERROR",
        error: streamError,
        latencyMs: Date.now() - startedAt,
      };
    }

    if (!completed) {
      const error = "probe stream ended before completion";
      logEvent("gateway-realtime", "provider.probe", {
        opId,
        source,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_INCOMPLETE",
        error,
        latencyMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        opId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_INCOMPLETE",
        error,
        latencyMs: Date.now() - startedAt,
      };
    }

    logEvent("gateway-realtime", "provider.probe", {
      opId,
      source,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      provider,
      model,
      capable: true,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      opId,
      provider,
      model,
      capable: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logEvent("gateway-realtime", "provider.probe", {
      opId,
      source,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      provider,
      model,
      capable: false,
      code: "INFERENCE_ERROR",
      error: detail,
      latencyMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      opId,
      provider,
      model,
      capable: false,
      code: "INFERENCE_ERROR",
      error: detail,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function methodChatSend(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const userMessage = asNonEmptyString(p.message, "message");
  const provider = normalizeProvider(asNonEmptyString(p.provider, "provider"));
  const model = asNonEmptyString(p.model, "model");
  const system = optionalString(p.system) ?? undefined;
  const maxTokens = typeof p.maxTokens === "number" ? p.maxTokens : undefined;
  const temperature = typeof p.temperature === "number" ? p.temperature : undefined;
  const idempotencyKey = optionalString(p.idempotencyKey);
  const deviceId = ctx.deviceId ?? "unknown-device";

  await ensureSession(deps.pg, ctx.tenantId, sessionId);

  if (idempotencyKey) {
    const reservedFast = await reserveFastIdempotency(deps.redis, ctx.tenantId, `send:${sessionId}:${idempotencyKey}`);
    if (!reservedFast) {
      return { ok: true, duplicate: true, sessionId };
    }
    const reservedDurable = await reserveDurableIdempotency(deps.pg, ctx.tenantId, sessionId, idempotencyKey);
    if (!reservedDurable) {
      return { ok: true, duplicate: true, sessionId };
    }
  }

  // Acquire turn
  const now = Date.now();
  const current = await readLease(deps.redis, ctx.tenantId, sessionId);
  if (current && current.expiresAtMs > now && current.deviceId !== deviceId) {
    return {
      ok: false,
      code: "TURN_BUSY",
      message: "another user holds the turn",
      retryAfterMs: Math.max(0, current.expiresAtMs - now),
    };
  }
  await writeLease(deps.redis, ctx.tenantId, sessionId, {
    deviceId,
    userId: ctx.userId,
    expiresAtMs: now + 300_000,
    updatedAtMs: now,
  });

  try {
    const tokenRecord = await deps.tokenVault.get(ctx.tenantId, ctx.userId, provider);
    if (!tokenRecord?.token) {
      return { ok: false, code: "MISSING_PROVIDER_TOKEN", message: `no token synced for provider: ${provider}` };
    }

    if (tokenRecord.tokenKind === "oauth" && tokenRecord.expiresAtMs && tokenRecord.refreshToken) {
      if (tokenRecord.expiresAtMs - Date.now() < 60_000) {
        const refreshed = await refreshOAuthTokenViaPiAi(tokenRecord.oauthProviderId ?? provider, tokenRecord);
        if (refreshed) {
          await deps.tokenVault.put(refreshed);
          Object.assign(tokenRecord, refreshed);
        }
      }
    }

    const userSeq = await nextSessionSeq(deps.redis, ctx.tenantId, sessionId);
    const userSaved = await appendMessage(deps.pg, {
      tenantId: ctx.tenantId,
      sessionId,
      seq: userSeq,
      role: "user",
      content: userMessage,
      idempotencyKey: idempotencyKey ?? undefined,
    });

    await emitChatEvent(deps, ctx.tenantId, {
      sessionKey: sessionId,
      tenantId: ctx.tenantId,
      messageId: userSaved.id,
      seq: userSeq,
      state: "final",
      message: { role: "user", text: userMessage },
      createdAt: userSaved.createdAt,
    });

    const historyResult = await deps.pg.query<{
      role: string;
      content: string;
    }>(
      `SELECT role, content
       FROM messages
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY seq ASC
       LIMIT 80`,
      [ctx.tenantId, sessionId],
    );

    const llmMessages: LlmMessage[] = historyResult.rows
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }));

    const stream = await callLlmProviderStream({
      provider,
      model,
      token: tokenRecord.token,
      tokenRecord,
      messages: llmMessages,
      system,
      maxTokens,
      temperature,
      accountId: tokenRecord.accountId,
      sessionId,
    });

    let fullText = "";
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "delta") {
        fullText += value.text;
        await emitChatEvent(deps, ctx.tenantId, {
          sessionKey: sessionId,
          tenantId: ctx.tenantId,
          state: "delta",
          message: { role: "assistant", text: fullText },
        });
      } else if (value.type === "done") {
        fullText = value.fullText;
        usage = value.usage;
      } else if (value.type === "error") {
        await emitChatEvent(deps, ctx.tenantId, {
          sessionKey: sessionId,
          tenantId: ctx.tenantId,
          state: "error",
          errorMessage: value.error,
        });
        return { ok: false, code: "INFERENCE_ERROR", message: value.error, sessionId };
      }
    }

    const assistantSeq = await nextSessionSeq(deps.redis, ctx.tenantId, sessionId);
    const assistantSaved = await appendMessage(deps.pg, {
      tenantId: ctx.tenantId,
      sessionId,
      seq: assistantSeq,
      role: "assistant",
      content: fullText,
    });

    await emitChatEvent(deps, ctx.tenantId, {
      sessionKey: sessionId,
      tenantId: ctx.tenantId,
      messageId: assistantSaved.id,
      seq: assistantSeq,
      state: "final",
      message: { role: "assistant", text: fullText },
      createdAt: assistantSaved.createdAt,
      ...(usage ? { usage } : {}),
    });

    return {
      ok: true,
      duplicate: false,
      tenantId: ctx.tenantId,
      sessionId,
      userMessageId: userSaved.id,
      userSeq,
      assistantMessageId: assistantSaved.id,
      assistantSeq,
    };
  } finally {
    await deps.redis.del(redisKeys.turnLease(ctx.tenantId, sessionId));
  }
}

async function methodSyncCatchup(ctx: MethodContext, params: unknown, deps: MethodDeps): Promise<unknown> {
  const p = asObject(params) ?? {};
  const sessionId = asNonEmptyString(p.sessionId, "sessionId");
  const lastAckedSeq = typeof p.lastAckedSeq === "number" && Number.isFinite(p.lastAckedSeq)
    ? Math.max(0, Math.floor(p.lastAckedSeq))
    : 0;
  const limit = typeof p.limit === "number" && Number.isFinite(p.limit)
    ? Math.min(Math.max(1, Math.floor(p.limit)), 500)
    : 200;

  const rows = await deps.pg.query<{
    id: string;
    seq: number;
    role: string;
    content: string;
    created_at: number;
    meta: unknown;
  }>(
    `SELECT id, seq, role, content, created_at, meta
     FROM messages
     WHERE tenant_id = $1 AND session_id = $2 AND seq > $3
     ORDER BY seq ASC
     LIMIT $4`,
    [ctx.tenantId, sessionId, lastAckedSeq, limit + 1],
  );

  const hasMore = rows.rows.length > limit;
  const selected = hasMore ? rows.rows.slice(0, limit) : rows.rows;
  const nextAckedSeq = selected.length > 0
    ? toFiniteNumber(selected[selected.length - 1].seq, lastAckedSeq)
    : lastAckedSeq;

  return {
    ok: true,
    tenantId: ctx.tenantId,
    sessionId,
    lastAckedSeq,
    nextAckedSeq,
    hasMore,
    events: selected.map((row) => ({
      type: "event",
      event: "chat.message",
      seq: toFiniteNumber(row.seq),
      payload: {
        id: row.id,
        sessionId,
        role: row.role,
        content: row.content,
        createdAt: toFiniteNumber(row.created_at),
        meta: row.meta ?? null,
      },
    })),
  };
}

export async function dispatchMethod(
  frame: RequestFrame,
  ctx: MethodContext,
  deps: MethodDeps,
): Promise<ResponseFrame> {
  try {
    const method = frame.method;

    let payload: unknown;
    switch (method) {
      case "health.ping":
        payload = await methodHealthPing(ctx);
        break;
      case "health.echo":
        payload = await methodHealthEcho(ctx, frame.params);
        break;
      case "node.ping":
        payload = await methodNodePing(ctx);
        break;
      case "device.register":
        payload = await methodDeviceRegister(ctx, frame.params, deps);
        break;
      case "debug.snapshot":
        payload = await methodDebugSnapshot(ctx, frame.params, deps);
        break;
      case "session.upsert":
        payload = await methodSessionUpsert(ctx, frame.params, deps);
        break;
      case "chat.append":
        payload = await methodChatAppend(ctx, frame.params, deps);
        break;
      case "chat.history":
        payload = await methodChatHistory(ctx, frame.params, deps);
        break;
      case "sync.catchup":
        payload = await methodSyncCatchup(ctx, frame.params, deps);
        break;
      case "chat.send":
        payload = await methodChatSend(ctx, frame.params, deps);
        break;
      case "turn.acquire":
        payload = await methodTurnAcquire(ctx, frame.params, deps);
        break;
      case "turn.heartbeat":
        payload = await methodTurnHeartbeat(ctx, frame.params, deps);
        break;
      case "turn.release":
        payload = await methodTurnRelease(ctx, frame.params, deps);
        break;
      case "token.sync.push":
        payload = await methodTokenSyncPush(ctx, frame.params, deps);
        break;
      case "token.sync.pull":
        payload = await methodTokenSyncPull(ctx, frame.params, deps);
        break;
      case "token.sync.delete":
        payload = await methodTokenSyncDelete(ctx, frame.params, deps);
        break;
      case "provider.probe":
        payload = await methodProviderProbe(ctx, frame.params, deps);
        break;
      case "channel.upsert":
        payload = await methodChannelUpsert(ctx, frame.params, deps);
        break;
      case "channel.list":
        payload = await methodChannelList(ctx, frame.params, deps);
        break;
      case "channel.delete":
        payload = await methodChannelDelete(ctx, frame.params, deps);
        break;
      case "channel.status":
        payload = await methodChannelStatus(ctx, frame.params, deps);
        break;
      case "channel.probe":
        payload = await methodChannelProbe(ctx, frame.params, deps);
        break;
      case "hook.route.list":
        payload = await methodHookRouteList(ctx, frame.params, deps);
        break;
      case "hook.route.upsert":
        payload = await methodHookRouteUpsert(ctx, frame.params, deps);
        break;
      case "hook.route.delete":
        payload = await methodHookRouteDelete(ctx, frame.params, deps);
        break;
      case "hook.event.list":
        payload = await methodHookEventList(ctx, frame.params, deps);
        break;
      case "hook.agent.list":
        payload = await methodHookAgentList(ctx, frame.params, deps);
        break;
      case "hook.agent.upsert":
        payload = await methodHookAgentUpsert(ctx, frame.params, deps);
        break;
      case "hook.agent.delete":
        payload = await methodHookAgentDelete(ctx, frame.params, deps);
        break;
      default:
        return responseError(frame.id, "METHOD_NOT_IMPLEMENTED", `method not implemented: ${method}`);
    }

    return responseOk(frame.id, payload);
  } catch (error) {
    return responseError(frame.id, "METHOD_ERROR", error instanceof Error ? error.message : String(error));
  }
}
