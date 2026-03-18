import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { dispatchPlugin, hasPlugin } from "../channels/plugin-registry.js";
import { callLlmProviderStream, refreshOAuthTokenViaPiAi } from "../shared/pi-ai-adapter.js";
import { buildLocalAuthProfile } from "../shared/auth-profile.js";
import { hashHookToken } from "../shared/hooks-auth.js";
import { logEvent } from "../shared/logger.js";
import { HookAgentsRepo } from "../shared/hook-agents-repo.js";
import { HooksRepo } from "../shared/hooks-repo.js";
import type { TokenVault } from "../shared/token-vault.js";
import type { ClientRequestAuth } from "./client-auth.js";
import { requestUrl } from "./client-auth.js";

const PROVIDER_PROBE_SYSTEM_PROMPT = "You are a provider capability check. Reply with OK only.";
const PROVIDER_PROBE_USER_MESSAGE = "Reply with OK.";
const PROVIDER_PROBE_MAX_TOKENS = 16;
const DEFAULT_PROVIDER_PROBE_MODELS: Record<string, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4.5",
  gemini: "gemini-2.5-flash",
};

type ClientRouteDeps = {
  pg: Pool;
  tokenVault: TokenVault;
  hooksRepo: HooksRepo;
  hookAgentsRepo: HookAgentsRepo;
};

type ChannelRow = {
  id: string;
  type: string;
  config: unknown;
  is_active: boolean;
  created_at: number | string;
};

class RouteError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readString(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = trimString(body[key]);
    if (value) return value;
  }
  return null;
}

function readNumber(body: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
  }
  return null;
}

function readObject(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = asObject(body[key]);
    if (value) return value;
  }
  return null;
}

function readRequiredString(body: Record<string, unknown>, keys: string[], field: string): string {
  const value = readString(body, ...keys);
  if (!value) {
    throw new RouteError(400, "BAD_REQUEST", `${field} is required`);
  }
  return value;
}

function parseHookAction(value: unknown): "wake" | "agent" {
  const normalized = trimString(value)?.toLowerCase();
  if (normalized === "wake" || normalized === "agent") return normalized;
  throw new RouteError(400, "BAD_REQUEST", "action must be 'wake' or 'agent'");
}

function normalizeProvider(provider: string): string {
  const value = provider.trim().toLowerCase();
  if (value === "openai-codex") return "openai";
  if (value === "claude") return "anthropic";
  if (value === "gemini-cli" || value === "google-gemini-cli") return "gemini";
  return value;
}

function parseTokenKind(value: unknown): "oauth" | "api-key" {
  if (value === "oauth" || value === "api-key") return value;
  throw new RouteError(400, "BAD_REQUEST", "tokenKind must be 'oauth' or 'api-key'");
}

function defaultProbeModel(provider: string): string {
  return DEFAULT_PROVIDER_PROBE_MODELS[provider] ?? "gpt-5-mini";
}

function toChannel(row: ChannelRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    config: asObject(row.config) ?? {},
    isActive: row.is_active,
    createdAt: toNumber(row.created_at),
  };
}

async function readJson(req: IncomingMessage, limitBytes = 1_048_576): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.byteLength;
    if (total > limitBytes) {
      throw new RouteError(413, "PAYLOAD_TOO_LARGE", `payload exceeds ${limitBytes} bytes`);
    }
    chunks.push(bufferChunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};

  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    throw new RouteError(400, "BAD_JSON", "invalid JSON body");
  }
}

async function maybeRefreshExpiringOauthToken(
  auth: ClientRequestAuth,
  provider: string,
  model: string,
  tokenVault: TokenVault,
): Promise<Awaited<ReturnType<TokenVault["get"]>>> {
  const tokenRecord = await tokenVault.get(auth.auth.tenantId, auth.auth.userId, provider);
  if (!tokenRecord?.token) {
    return null;
  }

  if (tokenRecord.tokenKind === "oauth" && tokenRecord.expiresAtMs && tokenRecord.refreshToken) {
    if (tokenRecord.expiresAtMs - Date.now() < 60_000) {
      try {
        const refreshed = await refreshOAuthTokenViaPiAi(tokenRecord.oauthProviderId ?? provider, tokenRecord);
        if (refreshed) {
          await tokenVault.put(refreshed);
          Object.assign(tokenRecord, refreshed);
          logEvent("gateway-api", "provider.probe.token_refreshed", {
            tenantId: auth.auth.tenantId,
            userId: auth.auth.userId,
            provider,
            model,
          });
        }
      } catch (refreshError) {
        logEvent("gateway-api", "provider.probe.token_refresh_failed", {
          tenantId: auth.auth.tenantId,
          userId: auth.auth.userId,
          provider,
          model,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }
    }
  }

  return tokenRecord;
}

async function handleCredentialPush(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const body = await readJson(req);
  const provider = normalizeProvider(readRequiredString(body, ["provider"], "provider"));
  const token = readRequiredString(body, ["token"], "token");
  const tokenKind = parseTokenKind(readString(body, "tokenKind", "token_kind"));
  const txid = randomUUID();
  const now = Date.now();

  const result = await deps.tokenVault.put({
    tenantId: auth.auth.tenantId,
    userId: auth.auth.userId,
    provider,
    token,
    tokenKind,
    updatedAtMs: now,
    ...(readString(body, "email") ? { email: readString(body, "email")! } : {}),
    ...(readString(body, "piProviderId", "pi_provider_id") ? { piProviderId: readString(body, "piProviderId", "pi_provider_id")! } : {}),
    ...(readString(body, "oauthProviderId", "oauth_provider_id") ? { oauthProviderId: readString(body, "oauthProviderId", "oauth_provider_id")! } : {}),
    ...(readString(body, "refreshToken", "refresh_token") ? { refreshToken: readString(body, "refreshToken", "refresh_token")! } : {}),
    ...(typeof readNumber(body, "expiresAtMs", "expires_at_ms") === "number"
      ? { expiresAtMs: readNumber(body, "expiresAtMs", "expires_at_ms")! }
      : {}),
    ...(readString(body, "accountId", "account_id") ? { accountId: readString(body, "accountId", "account_id")! } : {}),
    ...(readString(body, "projectId", "project_id") ? { projectId: readString(body, "projectId", "project_id")! } : {}),
    ...(readObject(body, "metadata", "metadata_json") ? { metadata: readObject(body, "metadata", "metadata_json")! } : {}),
  });

  json(res, 200, {
    ok: true,
    txid,
    provider,
    tokenKind,
    verified: result.verified,
    fingerprint: result.fingerprint,
    updatedAtMs: result.updatedAtMs,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

async function handleCredentialDelete(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  providerParam: string,
): Promise<void> {
  const provider = normalizeProvider(providerParam);
  const txid = randomUUID();
  const result = await deps.tokenVault.delete(auth.auth.tenantId, auth.auth.userId, provider);
  json(res, 200, {
    ok: true,
    txid,
    provider,
    deleted: result.verified,
    verified: result.verified,
    updatedAtMs: result.updatedAtMs,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

async function handleCredentialSecret(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  providerParam: string,
): Promise<void> {
  const provider = normalizeProvider(providerParam);
  const record = await deps.tokenVault.get(auth.auth.tenantId, auth.auth.userId, provider);

  if (!record?.token) {
    throw new RouteError(404, "NOT_FOUND", "credential not found");
  }

  logEvent("gateway-api", "credential.secret.read", {
    tenantId: auth.auth.tenantId,
    userId: auth.auth.userId,
    provider,
    tokenKind: record.tokenKind,
  });

  json(res, 200, buildLocalAuthProfile(record));
}

async function handleCredentialProbe(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  providerParam: string,
): Promise<void> {
  const provider = normalizeProvider(providerParam);
  const url = requestUrl(req);
  const model = trimString(url.searchParams.get("model")) ?? defaultProbeModel(provider);
  const startedAt = Date.now();
  const opId = `probe-${randomUUID()}`;

  const tokenRecord = await maybeRefreshExpiringOauthToken(auth, provider, model, deps.tokenVault);
  if (!tokenRecord?.token) {
    json(res, 200, {
      ok: true,
      ready: false,
      opId,
      provider,
      model,
      capable: false,
      code: "MISSING_PROVIDER_TOKEN",
      reason: `no token synced for provider: ${provider}`,
      latencyMs: Date.now() - startedAt,
    });
    return;
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
      sessionId: `probe-${auth.auth.userId}-${randomUUID()}`,
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
      json(res, 200, {
        ok: true,
        ready: false,
        opId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_ERROR",
        reason: streamError,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (!completed) {
      json(res, 200, {
        ok: true,
        ready: false,
        opId,
        provider,
        model,
        capable: false,
        code: "INFERENCE_INCOMPLETE",
        reason: "probe stream ended before completion",
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    json(res, 200, {
      ok: true,
      ready: true,
      opId,
      provider,
      model,
      capable: true,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    json(res, 200, {
      ok: true,
      ready: false,
      opId,
      provider,
      model,
      capable: false,
      code: "INFERENCE_ERROR",
      reason: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    });
  }
}

async function handleChannelsList(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const url = requestUrl(req);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1), 200);
  const result = await deps.pg.query<ChannelRow>(
    `SELECT id, type, config, is_active, created_at
     FROM channels
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [auth.auth.tenantId, limit],
  );

  json(res, 200, {
    ok: true,
    tenantId: auth.auth.tenantId,
    channels: result.rows.map(toChannel),
  });
}

async function handleChannelUpsert(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const body = await readJson(req);
  const channelId = readString(body, "channelId", "id") ?? randomUUID();
  const type = readRequiredString(body, ["type"], "type").toLowerCase();
  const config = readObject(body, "config") ?? {};
  const isActive = asBoolean(body.isActive ?? body.is_active, true);
  const now = Date.now();
  const txid = randomUUID();

  const result = await deps.pg.query<ChannelRow>(
    `INSERT INTO channels (tenant_id, id, type, config, is_active, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       type = EXCLUDED.type,
       config = EXCLUDED.config,
       is_active = EXCLUDED.is_active
     RETURNING id, type, config, is_active, created_at`,
    [auth.auth.tenantId, channelId, type, JSON.stringify(config), isActive, now],
  );

  if (hasPlugin(type)) {
    try {
      await dispatchPlugin(type, "apply", {
        tenantId: auth.auth.tenantId,
        channelId,
        channelType: type,
        isActive,
        config,
      });
    } catch (error) {
      logEvent("gateway-api", "channel.upsert.apply_warning", {
        tenantId: auth.auth.tenantId,
        channelId,
        channelType: type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  json(res, 200, {
    ok: true,
    txid,
    channel: toChannel(result.rows[0]),
    updatedAtMs: now,
  });
}

async function handleChannelDelete(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  channelId: string,
): Promise<void> {
  const txid = randomUUID();
  const existing = await deps.pg.query<{
    type: string;
    config: unknown;
  }>(
    `SELECT type, config
     FROM channels
     WHERE tenant_id = $1 AND id = $2
     LIMIT 1`,
    [auth.auth.tenantId, channelId],
  );

  if (existing.rows[0] && hasPlugin(existing.rows[0].type)) {
    try {
      await dispatchPlugin(existing.rows[0].type, "destroy", {
        tenantId: auth.auth.tenantId,
        channelId,
        channelType: existing.rows[0].type,
        config: asObject(existing.rows[0].config) ?? {},
      });
    } catch (error) {
      logEvent("gateway-api", "channel.delete.destroy_warning", {
        tenantId: auth.auth.tenantId,
        channelId,
        channelType: existing.rows[0].type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = await deps.pg.query(
    `DELETE FROM channels
     WHERE tenant_id = $1 AND id = $2`,
    [auth.auth.tenantId, channelId],
  );

  json(res, 200, {
    ok: true,
    txid,
    channelId,
    deleted: (result.rowCount ?? 0) > 0,
  });
}

async function handleHookRoutesList(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const routes = await deps.hooksRepo.listRoutes(auth.auth.tenantId);
  json(res, 200, { ok: true, tenantId: auth.auth.tenantId, routes });
}

async function handleHookRouteUpsert(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const body = await readJson(req);
  const name = readRequiredString(body, ["name"], "name");
  const action = parseHookAction(body.action);
  const enabled = asBoolean(body.enabled, true);
  const config = readObject(body, "config", "config_json") ?? {};
  const tokenHash = readString(body, "tokenHash", "token_hash")
    ?? (readString(body, "token") ? hashHookToken(readString(body, "token")!) : null);
  const txid = randomUUID();
  const route = await deps.hooksRepo.upsertRoute({
    tenantId: auth.auth.tenantId,
    name,
    action,
    enabled,
    tokenHash,
    config,
  });
  json(res, 200, { ok: true, txid, route });
}

async function handleHookRouteDelete(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  name: string,
): Promise<void> {
  const txid = randomUUID();
  const deleted = await deps.hooksRepo.deleteRoute(auth.auth.tenantId, name);
  json(res, 200, { ok: true, txid, name, deleted });
}

async function handleHookEventsList(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const url = requestUrl(req);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
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
    created_at_ms: number | string;
    processed_at_ms: number | string | null;
  }>(
    `SELECT event_id, hook_name, action, source, path, status, error, payload_ref, payload_json, created_at_ms, processed_at_ms
     FROM hook_events
     WHERE tenant_id = $1
     ORDER BY created_at_ms DESC
     LIMIT $2`,
    [auth.auth.tenantId, limit],
  );

  json(res, 200, {
    ok: true,
    tenantId: auth.auth.tenantId,
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
      createdAtMs: toNumber(row.created_at_ms),
      processedAtMs: row.processed_at_ms == null ? null : toNumber(row.processed_at_ms),
    })),
  });
}

async function handleHookAgentsList(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const agents = await deps.hookAgentsRepo.listAgents(auth.auth.tenantId);
  json(res, 200, { ok: true, tenantId: auth.auth.tenantId, agents });
}

async function handleHookAgentUpsert(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<void> {
  const body = await readJson(req);
  const agentId = readRequiredString(body, ["agentId", "agent_id"], "agentId");
  const enabled = asBoolean(body.enabled, true);
  const config = readObject(body, "config", "config_json") ?? {};
  const txid = randomUUID();
  const agent = await deps.hookAgentsRepo.upsertAgent({
    tenantId: auth.auth.tenantId,
    agentId,
    enabled,
    config,
  });
  json(res, 200, { ok: true, txid, agent });
}

async function handleHookAgentDelete(
  res: ServerResponse,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
  agentId: string,
): Promise<void> {
  const txid = randomUUID();
  const deleted = await deps.hookAgentsRepo.deleteAgent(auth.auth.tenantId, agentId);
  json(res, 200, { ok: true, txid, agentId, deleted });
}

export async function handleClientRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  auth: ClientRequestAuth,
  deps: ClientRouteDeps,
): Promise<boolean> {
  try {
    if (path === "/api/credentials/push" && req.method === "POST") {
      await handleCredentialPush(req, res, auth, deps);
      return true;
    }

    const credentialSecretMatch = path.match(/^\/api\/credentials\/([^/]+)\/secret$/);
    if (credentialSecretMatch && req.method === "GET") {
      await handleCredentialSecret(res, auth, deps, decodeURIComponent(credentialSecretMatch[1] ?? ""));
      return true;
    }

    const credentialProbeMatch = path.match(/^\/api\/credentials\/([^/]+)\/probe$/);
    if (credentialProbeMatch && req.method === "GET") {
      await handleCredentialProbe(req, res, auth, deps, decodeURIComponent(credentialProbeMatch[1] ?? ""));
      return true;
    }

    const credentialDeleteMatch = path.match(/^\/api\/credentials\/([^/]+)$/);
    if (credentialDeleteMatch && req.method === "DELETE") {
      await handleCredentialDelete(res, auth, deps, decodeURIComponent(credentialDeleteMatch[1] ?? ""));
      return true;
    }

    if (path === "/api/channels" && req.method === "GET") {
      await handleChannelsList(req, res, auth, deps);
      return true;
    }

    if (path === "/api/channels" && req.method === "POST") {
      await handleChannelUpsert(req, res, auth, deps);
      return true;
    }

    const channelDeleteMatch = path.match(/^\/api\/channels\/([^/]+)$/);
    if (channelDeleteMatch && req.method === "DELETE") {
      await handleChannelDelete(res, auth, deps, decodeURIComponent(channelDeleteMatch[1] ?? ""));
      return true;
    }

    if (path === "/api/hooks/routes" && req.method === "GET") {
      await handleHookRoutesList(res, auth, deps);
      return true;
    }

    if (path === "/api/hooks/routes" && req.method === "POST") {
      await handleHookRouteUpsert(req, res, auth, deps);
      return true;
    }

    const hookRouteDeleteMatch = path.match(/^\/api\/hooks\/routes\/([^/]+)$/);
    if (hookRouteDeleteMatch && req.method === "DELETE") {
      await handleHookRouteDelete(res, auth, deps, decodeURIComponent(hookRouteDeleteMatch[1] ?? ""));
      return true;
    }

    if (path === "/api/hooks/events" && req.method === "GET") {
      await handleHookEventsList(req, res, auth, deps);
      return true;
    }

    if (path === "/api/hooks/agents" && req.method === "GET") {
      await handleHookAgentsList(res, auth, deps);
      return true;
    }

    if (path === "/api/hooks/agents" && req.method === "POST") {
      await handleHookAgentUpsert(req, res, auth, deps);
      return true;
    }

    const hookAgentDeleteMatch = path.match(/^\/api\/hooks\/agents\/([^/]+)$/);
    if (hookAgentDeleteMatch && req.method === "DELETE") {
      await handleHookAgentDelete(res, auth, deps, decodeURIComponent(hookAgentDeleteMatch[1] ?? ""));
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof RouteError) {
      json(res, error.status, { ok: false, error: error.message, code: error.code });
      return true;
    }
    throw error;
  }
}
