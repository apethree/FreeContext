import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Queue } from "bullmq";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { Pool } from "pg";
import { loadEnv } from "../shared/config.js";
import type { AuthContext, OutboundJob, RequestFrame, TenantOwnershipLease } from "../shared/types.js";
import { parseFrame, responseError, responseOk } from "../shared/protocol.js";
import { applyPostgresFixups, createPgPool } from "../shared/pg.js";
import { createRedis } from "../shared/redis.js";
import { parseRedisUrlToBullmqOptions } from "../shared/bullmq.js";
import { OwnershipLeaseManager } from "../shared/ownership.js";
import { verifyClerkJwt } from "../shared/clerk.js";
import { TokenVault } from "../shared/token-vault.js";
import { dispatchMethod } from "./methods.js";
import { logError, logEvent } from "../shared/logger.js";
import { redisKeys } from "../shared/redis-keys.js";
import { claimInboundBacklog, markInboundBacklogDelivered } from "../shared/inbound-backlog.js";
import { HookAgentsRepo } from "../shared/hook-agents-repo.js";
import { initPluginRegistry } from "../channels/plugin-registry.js";

type ConnectionState = {
  connId: string;
  nonce: string;
  challengedAtMs: number;
  connected: boolean;
  auth: AuthContext;
  tenantLeaseId: string;
  tenantEpoch: number;
};

type TenantActor = {
  tenantId: string;
  leaseId: string;
  epoch: number;
  connections: Map<string, WebSocket>;
  heartbeatTimer: NodeJS.Timeout;
  idleReleaseTimer: NodeJS.Timeout | null;
  inflightDeliveries: number;
};

const CHALLENGE_TTL_MS = 120_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function parseBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  if (typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function parseTokenFromRequest(req: IncomingMessage): string | null {
  const bearer = parseBearer(req);
  if (bearer) return bearer;

  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const queryToken = url.searchParams.get("token")?.trim();
  return queryToken && queryToken.length > 0 ? queryToken : null;
}

function parseNodeTenant(req: IncomingMessage): string | null {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const tenantId = url.searchParams.get("tenantId")?.trim();
  return tenantId && tenantId.length > 0 ? tenantId : null;
}

function normalizePath(req: IncomingMessage): string {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return url.pathname;
}

function json(res: ServerResponse, code: number, payload: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

function text(res: ServerResponse, code: number, value: string, headers: Record<string, string> = {}): void {
  res.statusCode = code;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  for (const [key, val] of Object.entries(headers)) {
    res.setHeader(key, val);
  }
  res.end(value);
}

function verifyInternalDeliverySignature(secret: string, tenantId: string, eventId: string, signatureHeader: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(`${tenantId}:${eventId}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signatureHeader, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

function isJwtExpiryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"exp" claim timestamp check failed')
    || message.includes('"nbf" claim timestamp check failed');
}

async function ensureTenantRow(pg: Pool, auth: AuthContext, orgSlug: string | null): Promise<void> {
  await pg.query(
    `INSERT INTO tenants (id, type, external_id, slug, plan, created_at, settings)
     VALUES ($1, $2, $3, $4, 'free', $5, '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      auth.tenantId,
      auth.tenantType,
      auth.tenantType === "org" ? auth.tenantId : auth.userId,
      orgSlug,
      Date.now(),
    ],
  );
}

function buildReplayHeader(lease: TenantOwnershipLease | null): Record<string, string> {
  if (!lease?.ownerId) return {};
  return { "fly-replay": `instance=${lease.ownerId}` };
}

async function main() {
  const env = loadEnv();
  const service = "gateway-realtime";

  initPluginRegistry();

  const pg = createPgPool(env);
  await applyPostgresFixups(pg);
  const redis = createRedis(env);
  const bullConnection = parseRedisUrlToBullmqOptions(env.REDIS_URL);
  const outboundQueue = new Queue<OutboundJob, unknown, string>(env.BULLMQ_OUTBOUND_QUEUE, {
    connection: bullConnection,
    prefix: env.BULLMQ_PREFIX,
  });
  const ownership = new OwnershipLeaseManager(redis, env.MACHINE_ID, env.OWNER_LEASE_TTL_MS);
  const tokenVault = new TokenVault(pg, redis, env.TENANT_TOKEN_ENCRYPTION_KEY_BASE64);
  const hookAgentsRepo = new HookAgentsRepo(pg);

  const actors = new Map<string, TenantActor>();
  const connectionStates = new WeakMap<WebSocket, ConnectionState>();

  const getActor = (tenantId: string): TenantActor | null => actors.get(tenantId) ?? null;

  const createActor = (tenantId: string, lease: TenantOwnershipLease): TenantActor => {
    const actor: TenantActor = {
      tenantId,
      leaseId: lease.leaseId,
      epoch: lease.epoch,
      connections: new Map(),
      idleReleaseTimer: null,
      inflightDeliveries: 0,
      heartbeatTimer: setInterval(async () => {
        try {
          const renewed = await ownership.renew(tenantId, actor.leaseId);
          if (!renewed.renewed || !renewed.lease) {
            logEvent(service, "tenant.owner.renew_failed", {
              tenantId,
              leaseId: actor.leaseId,
              expectedOwner: env.MACHINE_ID,
              ownerNow: renewed.lease?.ownerId ?? null,
            });
            for (const ws of actor.connections.values()) {
              ws.close(1012, "tenant ownership moved");
            }
            clearInterval(actor.heartbeatTimer);
            actors.delete(tenantId);
            return;
          }
          actor.leaseId = renewed.lease.leaseId;
          actor.epoch = renewed.lease.epoch;
        } catch (error) {
          logError(service, "tenant.owner.renew_error", error, { tenantId, leaseId: actor.leaseId });
        }
      }, env.OWNER_HEARTBEAT_MS),
    };

    actors.set(tenantId, actor);
    return actor;
  };

  const maybeScheduleActorRelease = (actor: TenantActor): void => {
    if (actor.connections.size > 0) return;
    if (actor.inflightDeliveries > 0) return;
    if (actor.idleReleaseTimer) return;

    actor.idleReleaseTimer = setTimeout(async () => {
      actor.idleReleaseTimer = null;
      if (actor.connections.size > 0 || actor.inflightDeliveries > 0) {
        return;
      }
      const released = await ownership.release(actor.tenantId, actor.leaseId);
      clearInterval(actor.heartbeatTimer);
      actors.delete(actor.tenantId);
      logEvent(service, "tenant.owner.released", {
        tenantId: actor.tenantId,
        leaseId: actor.leaseId,
        released,
      });
    }, env.OWNER_IDLE_GRACE_MS);
  };

  const broadcast = async (tenantId: string, event: string, payload: unknown): Promise<void> => {
    const actor = actors.get(tenantId);
    if (!actor) {
      await redis.publish(redisKeys.tenantEventsChannel(tenantId), JSON.stringify({ event, payload }));
      return;
    }

    const frame = JSON.stringify({ type: "event", event, payload });
    for (const ws of actor.connections.values()) {
      if (ws.readyState === ws.OPEN) {
        ws.send(frame);
      }
    }

    await redis.publish(redisKeys.tenantEventsChannel(tenantId), JSON.stringify({ event, payload }));
  };

  const parseModelSelector = (
    rawProvider: unknown,
    rawModel: unknown,
    defaults?: { provider?: string; model?: string },
  ): { provider: string; model: string } => {
    const explicitProvider = asString(rawProvider).trim().toLowerCase();
    const explicitModel = asString(rawModel).trim();
    if (explicitProvider && explicitModel) {
      return { provider: explicitProvider, model: explicitModel };
    }
    if (explicitModel.includes("/")) {
      const [providerPart, ...modelParts] = explicitModel.split("/");
      const provider = providerPart.trim().toLowerCase();
      const model = modelParts.join("/").trim();
      if (provider && model) {
        return { provider, model };
      }
    }
    return {
      provider: explicitProvider || asString(defaults?.provider).trim().toLowerCase() || "openai",
      model: explicitModel || asString(defaults?.model).trim() || "gpt-5-mini",
    };
  };

  type HookRuntimeSelection = {
    requestedAgentId: string;
    agentId: string;
    provider: string;
    model: string;
    system?: string;
    thinking?: string;
    timeoutSeconds?: number;
    sessionMode: "isolated" | "shared";
    summaryToMain: boolean;
    profileFound: boolean;
    profileFallbackUsed: boolean;
  };

  type DeliveryTargetResolution = {
    channelId: string;
    channelType: string;
    targetId: string;
    resolvedBy: "id" | "type" | "last";
  };

  const withTimeout = async <T,>(work: Promise<T>, label: string, timeoutMs: number): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        work,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const resolveHookRuntime = async (tenantId: string, input: Record<string, unknown>): Promise<HookRuntimeSelection> => {
    const requestedAgentId = asString(input.agentId).trim() || "main";
    const directProfile = await hookAgentsRepo.getAgent(tenantId, requestedAgentId);
    const directEnabled = Boolean(directProfile?.enabled);

    let fallbackProfile = null;
    if (!directEnabled && requestedAgentId !== "main") {
      fallbackProfile = await hookAgentsRepo.getAgent(tenantId, "main");
    }
    const fallbackEnabled = Boolean(fallbackProfile?.enabled);
    const selectedProfile = directEnabled ? directProfile : (fallbackEnabled ? fallbackProfile : null);
    const profileFallbackUsed = !directEnabled && fallbackEnabled;

    const providerModel = parseModelSelector(
      input.provider,
      input.model,
      {
        provider: selectedProfile?.config.provider,
        model: selectedProfile?.config.model,
      },
    );
    const timeoutSeconds = typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds)
      ? Math.max(1, Math.min(3600, Math.floor(input.timeoutSeconds)))
      : (typeof selectedProfile?.config.timeoutSeconds === "number" && Number.isFinite(selectedProfile.config.timeoutSeconds)
          ? Math.max(1, Math.min(3600, Math.floor(selectedProfile.config.timeoutSeconds)))
          : undefined);

    const sessionMode = selectedProfile?.config.sessionMode === "shared" ? "shared" : "isolated";
    const summaryToMain = selectedProfile?.config.summaryToMain !== false;

    return {
      requestedAgentId,
      agentId: selectedProfile?.agentId ?? requestedAgentId,
      provider: providerModel.provider,
      model: providerModel.model,
      ...(asString(input.system).trim() ? { system: asString(input.system).trim() } : {}),
      ...(asString(input.thinking).trim() ? { thinking: asString(input.thinking).trim() } : {}),
      ...(typeof timeoutSeconds === "number" ? { timeoutSeconds } : {}),
      sessionMode,
      summaryToMain,
      profileFound: Boolean(selectedProfile),
      profileFallbackUsed,
    };
  };

  const resolveDeliveryTarget = async (
    tenantId: string,
    channelHint: string,
    targetHint: string,
  ): Promise<DeliveryTargetResolution | null> => {
    const hint = channelHint.trim();
    if (!hint) return null;

    const resolveTargetForType = (channelType: string, config: Record<string, unknown>): string => {
      const explicitTarget = targetHint.trim();
      if (explicitTarget) return explicitTarget;
      const normalizedType = channelType.trim().toLowerCase();
      if (normalizedType === "telegram") return asString(config.chatId).trim();
      if (normalizedType === "slack") return asString(config.channel).trim();
      if (normalizedType === "discord") return asString(config.channelId).trim();
      if (normalizedType === "webhook") return asString(config.url).trim();
      return "";
    };

    if (hint.toLowerCase() === "last") {
      const latest = await pg.query<{ id: string; type: string; config: unknown }>(
        `SELECT id, type, config
         FROM channels
         WHERE tenant_id = $1 AND is_active = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId],
      );
      const row = latest.rows[0];
      if (!row) return null;
      const config = asObject(row.config) ?? {};
      const targetId = resolveTargetForType(row.type, config);
      if (!targetId) return null;
      return {
        channelId: row.id,
        channelType: row.type,
        targetId,
        resolvedBy: "last",
      };
    }

    const byId = await pg.query<{ id: string; type: string; config: unknown }>(
      `SELECT id, type, config
       FROM channels
       WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE
       LIMIT 1`,
      [tenantId, hint],
    );
    if (byId.rows[0]) {
      const row = byId.rows[0];
      const config = asObject(row.config) ?? {};
      const targetId = resolveTargetForType(row.type, config);
      if (!targetId) return null;
      return {
        channelId: row.id,
        channelType: row.type,
        targetId,
        resolvedBy: "id",
      };
    }

    const byType = await pg.query<{ id: string; type: string; config: unknown }>(
      `SELECT id, type, config
       FROM channels
       WHERE tenant_id = $1 AND LOWER(type) = LOWER($2) AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, hint],
    );
    const row = byType.rows[0];
    if (!row) return null;
    const config = asObject(row.config) ?? {};
    const targetId = resolveTargetForType(row.type, config);
    if (!targetId) return null;
    return {
      channelId: row.id,
      channelType: row.type,
      targetId,
      resolvedBy: "type",
    };
  };

  const runHookAction = async (
    tenantId: string,
    event: string,
    payload: unknown,
  ): Promise<void> => {
    if (event !== "hook.wake" && event !== "hook.agent") return;
    const input = asObject(payload);
    if (!input) return;

    const wakeMode = asString(input.wakeMode).trim().toLowerCase() || "now";
    const requestedSessionKey = asString(input.sessionKey).trim() || "main";
    const message = asString(input.message).trim()
      || asString((asObject(input.payload)?.text)).trim();
    if (!message) {
      logEvent(service, "hook.action.skipped", {
        tenantId,
        event,
        reason: "missing message",
        hookName: asString(input.hookName),
      });
      return;
    }

    const runtime = await resolveHookRuntime(tenantId, input);
    const runtimeSessionKey = (event === "hook.agent"
      && runtime.sessionMode === "isolated"
      && (requestedSessionKey === "main" || requestedSessionKey.length === 0))
      ? `agent:${runtime.agentId}:main`
      : requestedSessionKey;
    const userId = asString(input.userId).trim() || tenantId;
    const hookName = asString(input.hookName).trim() || event;
    const deviceId = `hook:${hookName}`;
    const system = runtime.system;
    const hookAuth: AuthContext = {
      tenantId,
      tenantType: tenantId.startsWith("u:") ? "personal" : "org",
      userId,
      role: "member",
      scopes: ["chat.send", "chat.read", "turn.acquire", "turn.release"],
      deviceId,
    };

    await ensureTenantRow(pg, hookAuth, null);

    if (!runtime.profileFound) {
      logEvent(service, "hook.agent.runtime.missing", {
        tenantId,
        event,
        hookName,
        requestedAgentId: runtime.requestedAgentId,
        selectedAgentId: runtime.agentId,
      });
    }

    logEvent(service, "hook.agent.runtime.selected", {
      tenantId,
      event,
      hookName,
      requestedAgentId: runtime.requestedAgentId,
      selectedAgentId: runtime.agentId,
      profileFound: runtime.profileFound,
      profileFallbackUsed: runtime.profileFallbackUsed,
      sessionMode: runtime.sessionMode,
      sessionKey: runtimeSessionKey,
      provider: runtime.provider,
      model: runtime.model,
    });

    if (wakeMode === "next-heartbeat") {
      const appendResponse = await dispatchMethod(
        {
          type: "req",
          id: `hook-append-${crypto.randomUUID()}`,
          method: "chat.append",
          params: {
            sessionId: runtimeSessionKey,
            role: "user",
            content: message,
            meta: {
              source: "hook",
              hookName,
              wakeMode,
              agentId: runtime.agentId,
              sessionMode: runtime.sessionMode,
            },
          },
        },
        hookAuth,
        {
          pg,
          redis,
          tokenVault,
          emitEvent: async (ev, evPayload) => await broadcast(tenantId, ev, evPayload),
        },
      );
      const appendPayload = asObject(appendResponse.payload);
      const appendOk = typeof appendPayload?.ok === "boolean" ? appendPayload.ok : true;
      if (!appendResponse.ok || !appendOk) {
        const appendMessage = asString(appendPayload?.message) || asString(appendPayload?.errorMessage);
        throw new Error(appendMessage || appendResponse.error?.message || "failed to append deferred hook event");
      }

      logEvent(service, "hook.action.deferred", {
        tenantId,
        event,
        wakeMode,
        hookName,
        sessionKey: runtimeSessionKey,
        agentId: runtime.agentId,
      });
      return;
    }

    const timeoutMs = (runtime.timeoutSeconds ?? 180) * 1_000;
    const response = await withTimeout(dispatchMethod(
      {
        type: "req",
        id: `hook-run-${crypto.randomUUID()}`,
        method: "chat.send",
        params: {
          sessionId: runtimeSessionKey,
          message,
          provider: runtime.provider,
          model: runtime.model,
          ...(system ? { system } : {}),
          ...(runtime.thinking ? { thinking: runtime.thinking } : {}),
        },
      },
      hookAuth,
      {
        pg,
        redis,
        tokenVault,
        emitEvent: async (ev, evPayload) => await broadcast(tenantId, ev, evPayload),
      },
    ), "hook action execution", timeoutMs);

    const payloadObj = asObject(response.payload);
    const payloadOk = typeof payloadObj?.ok === "boolean" ? payloadObj.ok : true;
    if (!response.ok || !payloadOk) {
      const payloadMessage = asString(payloadObj?.message) || asString(payloadObj?.errorMessage);
      const errorMessage = payloadMessage || response.error?.message || "unknown hook execution error";
      throw new Error(errorMessage);
    }

    const deliver = input.deliver !== false;
    const assistantMessageId = asString(payloadObj?.assistantMessageId).trim();
    let assistantText = "";
    if (assistantMessageId) {
      const assistantRow = await pg.query<{ content: string }>(
        `SELECT content
         FROM messages
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1`,
        [tenantId, assistantMessageId],
      );
      assistantText = assistantRow.rows[0]?.content ?? "";
    }

    if (event === "hook.agent" && runtime.summaryToMain && runtimeSessionKey !== "main" && assistantText) {
      const preview = assistantText.length > 280 ? `${assistantText.slice(0, 280)}…` : assistantText;
      const summaryText = `Agent ${runtime.agentId} handled hook '${hookName}' in ${runtimeSessionKey}. Reply: ${preview}`;
      const summaryResponse = await dispatchMethod(
        {
          type: "req",
          id: `hook-summary-${crypto.randomUUID()}`,
          method: "chat.append",
          params: {
            sessionId: "main",
            role: "assistant",
            content: summaryText,
            meta: {
              source: "hook-summary",
              hookName,
              agentId: runtime.agentId,
              sourceSessionKey: runtimeSessionKey,
            },
          },
        },
        hookAuth,
        {
          pg,
          redis,
          tokenVault,
          emitEvent: async (ev, evPayload) => await broadcast(tenantId, ev, evPayload),
        },
      );
      const summaryPayload = asObject(summaryResponse.payload);
      const summaryOk = typeof summaryPayload?.ok === "boolean" ? summaryPayload.ok : true;
      if (summaryResponse.ok && summaryOk) {
        logEvent(service, "hook.agent.summary.appended", {
          tenantId,
          hookName,
          agentId: runtime.agentId,
          sourceSessionKey: runtimeSessionKey,
          targetSessionKey: "main",
        });
      } else {
        logEvent(service, "hook.agent.summary.failed", {
          tenantId,
          hookName,
          agentId: runtime.agentId,
          sourceSessionKey: runtimeSessionKey,
        });
      }
    }

    if (deliver) {
      if (!assistantText) {
        logEvent(service, "hook.delivery.skipped", {
          tenantId,
          event,
          hookName,
          reason: "assistant message missing",
        });
      } else {
        const channelHint = asString(input.channel).trim();
        const targetHint = asString(input.to).trim();
        const deliveryTarget = await resolveDeliveryTarget(tenantId, channelHint, targetHint);
        if (!deliveryTarget) {
          logEvent(service, "hook.delivery.skipped", {
            tenantId,
            event,
            hookName,
            reason: "channel/target not resolvable",
            channelHint,
            targetHint,
          });
        } else {
          const nowMs = Date.now();
          const jobId = crypto.randomUUID();
          await pg.query(
            `INSERT INTO jobs (
               id, tenant_id, type, status, attempt, idempotency_key, payload_ref, channel_id, created_at, updated_at
             ) VALUES (
               $1, $2, 'channel.outbound', 'queued', 0, NULL, NULL, $3, $4, $4
             )`,
            [jobId, tenantId, deliveryTarget.channelId, nowMs],
          );

          await outboundQueue.add("outbound", {
            queueType: "outbound",
            id: jobId,
            tenantId,
            channelId: deliveryTarget.channelId,
            channelType: deliveryTarget.channelType,
            targetId: deliveryTarget.targetId,
            payload: {
              text: assistantText,
              source: "hook",
              hookName,
              sessionKey: runtimeSessionKey,
              agentId: runtime.agentId,
            },
          }, {
            attempts: 4,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          });

          logEvent(service, "hook.delivery.queued", {
            tenantId,
            event,
            hookName,
            channelId: deliveryTarget.channelId,
            targetId: deliveryTarget.targetId,
            channelType: deliveryTarget.channelType,
            resolvedBy: deliveryTarget.resolvedBy,
            jobId,
          });
        }
      }
    }

    logEvent(service, "hook.action.executed", {
      tenantId,
      event,
      hookName,
      sessionKey: runtimeSessionKey,
      provider: runtime.provider,
      model: runtime.model,
      agentId: runtime.agentId,
      sessionMode: runtime.sessionMode,
    });
  };

  const handleMethod = async (ws: WebSocket, frame: RequestFrame) => {
    const state = connectionStates.get(ws);
    if (!state) {
      ws.send(JSON.stringify(responseError(frame.id, "UNAUTHENTICATED", "missing connection state")));
      return;
    }

    if (frame.method === "connect") {
      const params = (frame.params && typeof frame.params === "object") ? frame.params as Record<string, unknown> : {};
      const device = (params.device && typeof params.device === "object") ? params.device as Record<string, unknown> : {};
      const nonce = asString(device.nonce);
      if (!nonce || nonce !== state.nonce || Date.now() - state.challengedAtMs > CHALLENGE_TTL_MS) {
        ws.send(JSON.stringify(responseError(frame.id, "CONNECT_CHALLENGE_INVALID", "invalid challenge nonce")));
        ws.close(1008, "invalid challenge");
        return;
      }

      state.connected = true;
      connectionStates.set(ws, state);
      ws.send(JSON.stringify(responseOk(frame.id, {
        tenantId: state.auth.tenantId,
        userId: state.auth.userId,
        role: state.auth.role,
        scopes: state.auth.scopes,
        auth: {
          role: state.auth.role,
          scopes: state.auth.scopes,
          deviceToken: crypto.randomUUID(),
        },
      })));

      const backlog = await claimInboundBacklog(pg, state.auth.tenantId, 100);
      for (const item of backlog) {
        await broadcast(state.auth.tenantId, item.eventType, item.payloadJson);
        await markInboundBacklogDelivered(pg, state.auth.tenantId, item.eventId);
      }

      return;
    }

    if (!state.connected) {
      ws.send(JSON.stringify(responseError(frame.id, "UNAUTHENTICATED", "connect required")));
      return;
    }

    const actor = actors.get(state.auth.tenantId);
    if (!actor) {
      ws.send(JSON.stringify(responseError(frame.id, "TENANT_OWNER_MISSING", "tenant actor not found")));
      return;
    }

    if (actor.leaseId !== state.tenantLeaseId || actor.epoch !== state.tenantEpoch) {
      ws.send(JSON.stringify(responseError(frame.id, "TENANT_OWNER_STALE", "ownership lease changed")));
      return;
    }

    const response = await dispatchMethod(frame, state.auth, {
      pg,
      redis,
      tokenVault,
      emitEvent: async (event, payload) => await broadcast(state.auth.tenantId, event, payload),
    });

    ws.send(JSON.stringify(response));
  };

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    ws.on("message", async (raw: RawData) => {
      const text = typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString("utf8")
            : Buffer.from(raw).toString("utf8");
      try {
        const parsed = parseFrame(text);
        if (parsed.type !== "req") return;
        await handleMethod(ws, parsed);
      } catch (error) {
        logError(service, "ws.frame.error", error);
      }
    });

    ws.on("close", async () => {
      const state = connectionStates.get(ws);
      if (!state) return;
      const actor = actors.get(state.auth.tenantId);
      if (!actor) return;
      actor.connections.delete(state.connId);
      await redis.del(redisKeys.presence(state.auth.tenantId, state.connId));
      maybeScheduleActorRelease(actor);
    });
  });

  const server = createServer(async (req, res) => {
    const path = normalizePath(req);

    if (path === "/health") {
      return json(res, 200, {
        ok: true,
        service,
        machineId: env.MACHINE_ID,
      });
    }

    if (path === "/internal/deliver" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText) as {
        tenantId: string;
        eventId: string;
        event: string;
        payload: unknown;
      };

      const signature = (req.headers["x-openclaw-delivery"] ?? "") as string;
      const verified = verifyInternalDeliverySignature(
        env.INTERNAL_DELIVERY_SECRET,
        body.tenantId,
        body.eventId,
        signature,
      );
      if (!verified) {
        return json(res, 401, { ok: false, error: "invalid delivery signature" });
      }

      const actor = actors.get(body.tenantId);
      if (actor) {
        actor.inflightDeliveries += 1;
      }
      try {
        await broadcast(body.tenantId, body.event || "channel.inbound", body.payload ?? {});
        await runHookAction(body.tenantId, body.event || "channel.inbound", body.payload ?? {});
      } catch (error) {
        logError(service, "internal.deliver.failed", error, {
          tenantId: body.tenantId,
          eventId: body.eventId,
          event: body.event,
        });
        return json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (actor) {
          actor.inflightDeliveries = Math.max(0, actor.inflightDeliveries - 1);
          maybeScheduleActorRelease(actor);
        }
      }

      return json(res, 200, { ok: true, delivered: true });
    }

    return text(res, 404, "not found");
  });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const path = normalizePath(req);
      if (path !== "/ws" && path !== "/ws-node") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      let auth: AuthContext;
      let orgSlug: string | null = null;

      if (path === "/ws") {
        const token = parseTokenFromRequest(req);
        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        const verified = await verifyClerkJwt({
          token,
          jwksUrl: env.CLERK_JWKS_URL,
          issuer: env.CLERK_ISSUER,
        });
        auth = verified.auth;
        orgSlug = verified.orgSlug;
      } else {
        const tenantId = parseNodeTenant(req);
        if (!tenantId) {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }
        auth = {
          tenantId,
          tenantType: tenantId.startsWith("u:") ? "personal" : "org",
          userId: `node:${tenantId}`,
          role: "node",
          scopes: ["node.execute", "operator.read"],
        };
      }

      await ensureTenantRow(pg, auth, orgSlug);

      const lease = await ownership.acquire(auth.tenantId);
      if (!lease.lease) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      if (!lease.acquired && lease.lease.ownerId !== env.MACHINE_ID) {
        const replayHeaders = buildReplayHeader(lease.lease);
        const headerLines = Object.entries(replayHeaders).map(([k, v]) => `${k}: ${v}`).join("\r\n");
        socket.write(`HTTP/1.1 409 Conflict\r\n${headerLines}\r\n\r\n`);
        socket.destroy();
        return;
      }

      const actor = getActor(auth.tenantId) ?? createActor(auth.tenantId, lease.lease);
      if (actor.idleReleaseTimer) {
        clearTimeout(actor.idleReleaseTimer);
        actor.idleReleaseTimer = null;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const connId = crypto.randomUUID();
        actor.connections.set(connId, ws);

        const nonce = crypto.randomUUID();
        const state: ConnectionState = {
          connId,
          nonce,
          challengedAtMs: Date.now(),
          connected: false,
          auth,
          tenantLeaseId: actor.leaseId,
          tenantEpoch: actor.epoch,
        };
        connectionStates.set(ws, state);

        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: {
            nonce,
            expiresAt: Date.now() + CHALLENGE_TTL_MS,
            ts: Date.now(),
          },
        }));

        void redis.set(redisKeys.presence(auth.tenantId, connId), "1", "PX", env.OWNER_LEASE_TTL_MS);
        wss.emit("connection", ws, req);
      });
    } catch (error) {
      if (isJwtExpiryError(error)) {
        logEvent(service, "ws.upgrade.token_expired", {
          error: error instanceof Error ? error.message : String(error),
        });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      logError(service, "ws.upgrade.error", error);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  server.listen(env.PORT, () => {
    logEvent(service, "server.started", {
      port: env.PORT,
      machineId: env.MACHINE_ID,
    });
  });
}

void main().catch((error) => {
  logError("gateway-realtime", "server.crash", error);
  process.exit(1);
});
