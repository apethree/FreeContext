import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { initPluginRegistry } from "../channels/plugin-registry.js";
import { handleClientRoute } from "./client-routes.js";
import {
  applyClientCors,
  ClientAuthError,
  handleClientCorsPreflight,
  isClientRoutePath,
  requireClientAuth,
} from "./client-auth.js";
import { handleShapeProxyRoute } from "./shapes-proxy.js";
import { loadEnv } from "../shared/config.js";
import { createPgPool } from "../shared/pg.js";
import { createRedis } from "../shared/redis.js";
import { logError, logEvent } from "../shared/logger.js";
import { HooksRepo } from "../shared/hooks-repo.js";
import { HookAgentsRepo } from "../shared/hook-agents-repo.js";
import { parseRedisUrlToBullmqOptions } from "../shared/bullmq.js";
import { HookTransformRuntime } from "../shared/hooks-transform.js";
import { TokenVault } from "../shared/token-vault.js";
import {
  collectExpectedHookTokenHashes,
  extractHookBearerToken,
  fingerprintHookToken,
  hasHookQueryToken,
  hashHookToken,
  verifyHookToken,
} from "../shared/hooks-auth.js";
import {
  buildHookTemplateVars,
  renderHookMessage,
  resolveHookRoute,
} from "../shared/hooks-mapping.js";
import type {
  HookAction,
  HookRouteConfig,
  InboundJob,
  OutboundJob,
} from "../shared/types.js";

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;

function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `http://${host}`);
}

function normalizePath(req: IncomingMessage): string {
  return requestUrl(req).pathname;
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
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

function parseHookAction(value: unknown, fallback: HookAction = "wake"): HookAction {
  const normalized = trimString(value)?.toLowerCase();
  if (normalized === "wake" || normalized === "agent") return normalized;
  return fallback;
}

function parseHookConfig(value: unknown): Partial<HookRouteConfig> {
  const obj = asObject(value);
  return obj ?? {};
}

function isTenantPathSegment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("u:")
    || trimmed.startsWith("org:")
    || trimmed.startsWith("t:")
    || trimmed.startsWith("tenant:");
}

function extractClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.split(",")[0]?.trim() || "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

async function readBodyText(req: IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.byteLength;
    if (total > limitBytes) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `payload exceeds ${limitBytes} bytes`);
    }
    chunks.push(bufferChunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { raw: trimmed };
  }
}

function getBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function readJson(req: IncomingMessage, limitBytes = DEFAULT_BODY_LIMIT_BYTES): Promise<unknown> {
  const body = await readBodyText(req, limitBytes);
  return body.length > 0 ? JSON.parse(body) : {};
}

function json(
  res: ServerResponse,
  code: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

function resolveHookIngressTenantId(
  path: string,
  url: URL,
  bodyObj: Record<string, unknown> | null,
  headers: IncomingMessage["headers"],
): { tenantId: string; routePath: string } {
  const pathParts = path.split("/").filter(Boolean);
  const tail = pathParts[0] === "hooks" ? pathParts.slice(1) : pathParts;
  const queryOrBodyTenant = trimString(url.searchParams.get("tenantId"))
    ?? trimString(url.searchParams.get("tenant"))
    ?? trimString(bodyObj?.tenantId)
    ?? trimString(headers["x-openclaw-tenant-id"]);

  let tenantId = queryOrBodyTenant;
  let routeTail = tail;

  if (tail.length > 0) {
    const first = decodeURIComponent(tail[0] ?? "");
    const looksLikeTenant = isTenantPathSegment(first);
    if (tenantId && first === tenantId) {
      routeTail = tail.slice(1);
    } else if (!tenantId && looksLikeTenant) {
      tenantId = first;
      routeTail = tail.slice(1);
    }
  }

  if (!tenantId) {
    throw new HttpError(400, "TENANT_REQUIRED", "tenantId is required for hook ingress");
  }

  const routePath = routeTail.length > 0 ? `/${routeTail.join("/")}` : "/";
  return { tenantId, routePath };
}

function resolveHookSource(url: URL, bodyObj: Record<string, unknown> | null, headers: IncomingMessage["headers"]): string {
  return trimString(url.searchParams.get("source"))
    ?? trimString(headers["x-openclaw-source"])
    ?? trimString(bodyObj?.source)
    ?? "webhook";
}

function resolveHookName(url: URL, bodyObj: Record<string, unknown> | null, headers: IncomingMessage["headers"]): string | null {
  return trimString(url.searchParams.get("hook"))
    ?? trimString(url.searchParams.get("name"))
    ?? trimString(headers["x-openclaw-hook"])
    ?? trimString(bodyObj?.hookName)
    ?? trimString(bodyObj?.route)
    ?? trimString(bodyObj?.name);
}

function resolveHookSessionKey(config: HookRouteConfig, requested: string | null): string {
  const defaultSession = trimString(config.defaultSessionKey) ?? `hooks:${config.name}`;
  const allowRequest = config.allowRequestSessionKey === true;
  const candidate = allowRequest ? (requested ?? defaultSession) : defaultSession;
  return validateHookSessionKeyPrefixes(config, candidate);
}

function validateHookSessionKeyPrefixes(config: HookRouteConfig, candidate: string): string {
  const value = candidate.trim();
  if (!value) {
    throw new HttpError(400, "SESSION_KEY_REQUIRED", "sessionKey must be a non-empty string");
  }
  const allowedPrefixes = (config.allowedSessionKeyPrefixes ?? [])
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
  if (allowedPrefixes.length > 0) {
    const valid = allowedPrefixes.some((prefix) => value.startsWith(prefix));
    if (!valid) {
      throw new HttpError(400, "SESSION_KEY_NOT_ALLOWED", `sessionKey must start with one of: ${allowedPrefixes.join(", ")}`);
    }
  }
  return value;
}

function parseWakeMode(value: unknown): "now" | "next-heartbeat" {
  const normalized = trimString(value)?.toLowerCase();
  return normalized === "next-heartbeat" ? "next-heartbeat" : "now";
}

function defaultRouteForBuiltinHook(
  tenantId: string,
  name: "wake" | "agent",
  nowMs: number,
): {
  tenantId: string;
  name: string;
  action: HookAction;
  enabled: boolean;
  tokenHash: string | null;
  config: HookRouteConfig;
  createdAtMs: number;
  updatedAtMs: number;
} {
  const action: HookAction = name === "agent" ? "agent" : "wake";
  return {
    tenantId,
    name,
    action,
    enabled: true,
    tokenHash: null,
    config: {
      name,
      action,
      enabled: true,
      allowRequestSessionKey: false,
      defaultSessionKey: name === "agent" ? "main" : "main",
      wakeMode: "now",
    },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

async function main() {
  const env = loadEnv();
  const service = "gateway-api";
  initPluginRegistry();
  const pg = createPgPool(env);
  const redis = createRedis(env);
  const hooksRepo = new HooksRepo(pg);
  const hookAgentsRepo = new HookAgentsRepo(pg);
  const tokenVault = new TokenVault(pg, redis, env.TENANT_TOKEN_ENCRYPTION_KEY_BASE64);
  const bullConnection = parseRedisUrlToBullmqOptions(env.REDIS_URL);

  const inboundQueue = new Queue<InboundJob, unknown, string>(env.BULLMQ_INBOUND_QUEUE, {
    connection: bullConnection,
    prefix: env.BULLMQ_PREFIX,
  });
  const outboundQueue = new Queue<OutboundJob, unknown, string>(env.BULLMQ_OUTBOUND_QUEUE, {
    connection: bullConnection,
    prefix: env.BULLMQ_PREFIX,
  });
  const transformRuntime = new HookTransformRuntime({
    transformsDir: env.OPENCLAW_HOOKS_TRANSFORMS_DIR,
    devMode: env.NODE_ENV !== "production",
    timeoutMs: 2_000,
  });
  let transformRuntimeEnabled = transformRuntime.isEnabled();
  if (transformRuntimeEnabled) {
    const transformRootCheck = await transformRuntime.validateRootReadable();
    if (!transformRootCheck.ok) {
      transformRuntimeEnabled = false;
      logEvent(service, "hooks.transform.disabled", {
        reason: transformRootCheck.reason,
        transformsDir: env.OPENCLAW_HOOKS_TRANSFORMS_DIR,
      });
    } else {
      logEvent(service, "hooks.transform.enabled", {
        transformsDir: env.OPENCLAW_HOOKS_TRANSFORMS_DIR,
      });
    }
  }

  const requireOpsAuth = (req: IncomingMessage): boolean => {
    const expected = env.INTERNAL_WORKER_BEARER_TOKEN.trim();
    if (!expected) return true;
    const provided = getBearer(req);
    return Boolean(provided && provided === expected);
  };

  const markHookAuthFailure = async (tenantId: string, clientIp: string): Promise<number> => {
    const key = `hook:authfail:${tenantId}:${clientIp}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, env.OPENCLAW_HOOKS_AUTH_FAIL_WINDOW_MS);
    }
    return count;
  };

  const resetHookAuthFailures = async (tenantId: string, clientIp: string): Promise<void> => {
    const key = `hook:authfail:${tenantId}:${clientIp}`;
    await redis.del(key);
  };

  const enqueueInbound = async (message: InboundJob): Promise<void> => {
    await inboundQueue.add("inbound" as const, message, {
      attempts: 5,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  };

  const handleHookIngress = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const url = requestUrl(req);
    if (hasHookQueryToken(url)) {
      throw new HttpError(400, "TOKEN_IN_QUERY_NOT_ALLOWED", "Do not pass tokens in query params. Use Authorization or x-openclaw-token header.");
    }

    const rawBody = await readBodyText(req, env.OPENCLAW_HOOKS_MAX_PAYLOAD_BYTES);
    const parsedBody = parseMaybeJson(rawBody);
    const bodyObj = asObject(parsedBody);

    const { tenantId, routePath } = resolveHookIngressTenantId(path, url, bodyObj, req.headers);
    const source = resolveHookSource(url, bodyObj, req.headers);
    const routeSegments = routePath.split("/").filter(Boolean);
    const implicitName = routeSegments.length === 1 ? routeSegments[0] : null;
    const explicitName = resolveHookName(url, bodyObj, req.headers) ?? implicitName;
    const opId = trimString(url.searchParams.get("opId")) ?? trimString(bodyObj?.opId) ?? `hook-${randomUUID()}`;
    const eventId = trimString(url.searchParams.get("eventId")) ?? trimString(bodyObj?.eventId) ?? randomUUID();
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);

    const routes = await hooksRepo.listRoutes(tenantId);
    let route = resolveHookRoute({
      path: routePath,
      source,
      explicitName,
      routes,
    });

    if (!route) {
      const builtinName = explicitName?.toLowerCase();
      if (builtinName === "wake" || builtinName === "agent") {
        route = defaultRouteForBuiltinHook(tenantId, builtinName, nowMs);
      }
    }

    if (!route) {
      const available = routes.map((item) => item.name).sort();
      logEvent(service, "hooks.route.not_found", {
        opId,
        tenantId,
        source,
        routePath,
        explicitName,
        routeCount: routes.length,
      });
      json(res, 404, {
        ok: false,
        error: "hook route not found",
        tenantId,
        source,
        routePath,
        availableRoutes: available,
      });
      return;
    }

    const incomingToken = extractHookBearerToken(req.headers);
    const expectedHashes = collectExpectedHookTokenHashes(env.OPENCLAW_HOOKS_TOKEN, route.tokenHash);
    if (expectedHashes.length > 0 && !verifyHookToken(incomingToken, expectedHashes)) {
      const failCount = await markHookAuthFailure(tenantId, clientIp);
      const blocked = failCount >= env.OPENCLAW_HOOKS_AUTH_FAIL_LIMIT;
      logEvent(service, "hooks.auth.failed", {
        opId,
        tenantId,
        hookName: route.name,
        source,
        routePath,
        clientIp,
        failCount,
        blocked,
        fingerprint: incomingToken ? fingerprintHookToken(incomingToken) : null,
      });
      if (blocked) {
        throw new HttpError(429, "HOOK_AUTH_RATE_LIMIT", "Too many failed hook auth attempts");
      }
      throw new HttpError(401, "HOOK_AUTH_FAILED", "invalid hook token");
    }
    await resetHookAuthFailures(tenantId, clientIp);

    const requestedSessionKey = trimString(url.searchParams.get("sessionKey"))
      ?? trimString(req.headers["x-openclaw-session-key"])
      ?? trimString(bodyObj?.sessionKey);
    let sessionKey = resolveHookSessionKey(route.config, requestedSessionKey);
    let wakeMode = parseWakeMode(bodyObj?.mode ?? bodyObj?.wakeMode ?? route.config.wakeMode);
    const requestedAgentId = trimString(bodyObj?.agentId) ?? trimString(bodyObj?.agent);
    const allowedAgentIds = (route.config.allowedAgentIds ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (requestedAgentId && allowedAgentIds.length > 0) {
      const wildcard = allowedAgentIds.includes("*");
      if (!wildcard && !allowedAgentIds.includes(requestedAgentId)) {
        throw new HttpError(400, "AGENT_ID_NOT_ALLOWED", `agentId '${requestedAgentId}' is not allowed`);
      }
    }
    let agentId = requestedAgentId ?? trimString(route.config.agentId) ?? "main";
    let deliver = bodyObj?.deliver === false ? false : route.config.deliver !== false;
    let provider = trimString(bodyObj?.provider) ?? null;
    let model = trimString(bodyObj?.model) ?? trimString(route.config.model);
    let thinking = trimString(bodyObj?.thinking) ?? trimString(route.config.thinking);
    let timeoutSeconds = typeof bodyObj?.timeoutSeconds === "number" && Number.isFinite(bodyObj.timeoutSeconds)
      ? Math.floor(bodyObj.timeoutSeconds)
      : (typeof route.config.timeoutSeconds === "number" && Number.isFinite(route.config.timeoutSeconds)
          ? Math.floor(route.config.timeoutSeconds)
          : null);
    let channel = trimString(bodyObj?.channel) ?? trimString(route.config.channel);
    let to = trimString(bodyObj?.to) ?? trimString(route.config.to);
    let hookMetadata = asObject(bodyObj?.metadata) ?? null;

    const payload = bodyObj?.payload ?? parsedBody;
    const templateVars = buildHookTemplateVars({
      tenantId,
      hookName: route.name,
      path: routePath,
      source,
      payload,
      nowMs,
      nowIso: new Date(nowMs).toISOString(),
      opId,
    });
    let renderedMessage = renderHookMessage(route.config, templateVars)
      || trimString(bodyObj?.message)
      || trimString(bodyObj?.text)
      || "";

    const transformModule = trimString(route.config.transformModule);
    if (transformRuntimeEnabled && transformModule) {
      logEvent(service, "hooks.transform.start", {
        opId,
        tenantId,
        hookName: route.name,
        action: route.action,
        transformModule,
      });
      try {
        const overrides = await transformRuntime.run(transformModule, {
          tenantId,
          hookName: route.name,
          action: route.action,
          source,
          routePath,
          opId,
          nowMs,
          payload,
          routeConfig: route.config as unknown as Record<string, unknown>,
          message: renderedMessage,
          sessionKey,
          agentId,
          wakeMode,
          deliver,
          channel,
          to,
          model,
          thinking,
          timeoutSeconds,
          metadata: hookMetadata,
        });

        if (overrides.message) renderedMessage = overrides.message;
        if (overrides.sessionKey) {
          sessionKey = validateHookSessionKeyPrefixes(route.config, overrides.sessionKey);
        }
        if (overrides.agentId) agentId = overrides.agentId;
        if (typeof overrides.deliver === "boolean") deliver = overrides.deliver;
        if (overrides.wakeMode) wakeMode = overrides.wakeMode;
        if (overrides.provider) provider = overrides.provider;
        if (overrides.model) model = overrides.model;
        if (overrides.channel) channel = overrides.channel;
        if (overrides.to) to = overrides.to;
        if (overrides.thinking) thinking = overrides.thinking;
        if (typeof overrides.timeoutSeconds === "number") timeoutSeconds = overrides.timeoutSeconds;
        if (overrides.metadata) {
          hookMetadata = {
            ...(hookMetadata ?? {}),
            ...overrides.metadata,
          };
        }

        logEvent(service, "hooks.transform.ok", {
          opId,
          tenantId,
          hookName: route.name,
          action: route.action,
          transformModule,
          overrideKeys: Object.keys(overrides),
        });
      } catch (error) {
        logError(service, "hooks.transform.failed", error, {
          opId,
          tenantId,
          hookName: route.name,
          action: route.action,
          transformModule,
        });
        throw new HttpError(422, "HOOK_TRANSFORM_ERROR", "hook transform failed");
      }
    }

    if (!renderedMessage) {
      if (route.action === "wake") {
        throw new HttpError(400, "HOOK_TEXT_REQUIRED", "wake hook requires non-empty text");
      }
      throw new HttpError(400, "HOOK_MESSAGE_REQUIRED", "agent hook requires non-empty message");
    }

    const event = await hooksRepo.insertEvent({
      eventId,
      tenantId,
      hookName: route.name,
      action: route.action,
      source,
      path: routePath,
      status: "processing",
      payloadJson: {
        source,
        path: routePath,
        sessionKey,
        agentId,
        deliver,
        message: renderedMessage,
        wakeMode,
        payload,
        metadata: hookMetadata,
        routeConfig: route.config,
        opId,
      },
      createdAtMs: nowMs,
    });

    const eventType = route.action === "agent" ? "hook.agent" : "hook.wake";
    const jobPayload = {
      opId,
      eventId: event.eventId,
      hookName: route.name,
      action: route.action,
      source,
      path: routePath,
      sessionKey,
      agentId,
      message: renderedMessage,
      wakeMode,
      payload,
      metadata: hookMetadata,
      route: {
        name: route.name,
        action: route.action,
      },
      deliver,
      provider,
      channel,
      to,
      model,
      thinking,
      timeoutSeconds,
      ts: nowMs,
    };

    try {
      const queueMessage: InboundJob = {
        queueType: "inbound",
        id: event.eventId,
        tenantId,
        eventType,
        source: `hook:${route.name}`,
        sourceEventId: event.eventId,
        payload: jobPayload,
      };
      await enqueueInbound(queueMessage);

      await hooksRepo.updateEventStatus(event.eventId, "processed", null, Date.now());

      logEvent(service, "hooks.ingress.accepted", {
        opId,
        tenantId,
        hookName: route.name,
        action: route.action,
        eventId: event.eventId,
        source,
        routePath,
        sessionKey,
        agentId,
        deliver,
      });

      const httpCode = 200;
      json(res, httpCode, {
        ok: true,
        accepted: true,
        opId,
        tenantId,
        hookName: route.name,
        action: route.action,
        eventId: event.eventId,
        eventType,
        sessionKey,
        agentId,
        deliver,
        wakeMode,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await hooksRepo.updateEventStatus(event.eventId, "failed", message.slice(0, 512), Date.now());
      logError(service, "hooks.ingress.failed", error, {
        opId,
        tenantId,
        hookName: route.name,
        action: route.action,
        eventId: event.eventId,
      });
      throw new HttpError(502, "HOOK_DELIVERY_FAILED", message);
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const path = normalizePath(req);

      if (handleClientCorsPreflight(req, res, env, path)) {
        return;
      }

      if (isClientRoutePath(path)) {
        applyClientCors(req, res, env);
        const auth = await requireClientAuth(req, env);

        if (await handleShapeProxyRoute(req, res, path, { env, auth })) {
          return;
        }

        if (await handleClientRoute(req, res, path, auth, {
          pg,
          tokenVault,
          hooksRepo,
          hookAgentsRepo,
        })) {
          return;
        }

        return json(res, 404, { ok: false, error: "not found" });
      }

      if (path === "/health") {
        return json(res, 200, {
          ok: true,
          service,
          env: env.NODE_ENV,
          machineId: env.MACHINE_ID,
        });
      }

      if ((path === "/hooks" || path.startsWith("/hooks/")) && req.method === "POST") {
        await handleHookIngress(req, res, path);
        return;
      }

      if (path === "/webhooks/inbound" && req.method === "POST") {
        const body = (await readJson(req)) as {
          tenantId?: unknown;
          channelType?: unknown;
          eventType?: unknown;
          source?: unknown;
          sourceEventId?: unknown;
          id?: unknown;
          payload?: unknown;
          payloadRef?: unknown;
        };

        const tenantId = typeof body.tenantId === "string" && body.tenantId.trim().length > 0
          ? body.tenantId.trim()
          : "unknown";
        const source = typeof body.source === "string" && body.source.trim().length > 0
          ? body.source.trim()
          : typeof body.channelType === "string" && body.channelType.trim().length > 0
            ? body.channelType.trim()
            : "webhook";
        const sourceEventId = typeof body.sourceEventId === "string" && body.sourceEventId.trim().length > 0
          ? body.sourceEventId.trim()
          : randomUUID();

        const dedupe = await pg.query(
          `INSERT INTO webhook_events (id, tenant_id, source, source_event_id, payload_ref, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, source, source_event_id) DO NOTHING`,
          [randomUUID(), tenantId, source, sourceEventId, typeof body.payloadRef === "string" ? body.payloadRef : null, Date.now()],
        );
        if ((dedupe.rowCount ?? 0) === 0) {
          return json(res, 200, { ok: true, queued: false, duplicate: true, sourceEventId });
        }

        const message: InboundJob = {
          queueType: "inbound",
          id: typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : randomUUID(),
          tenantId,
          eventType: typeof body.eventType === "string" && body.eventType.trim().length > 0
            ? body.eventType.trim()
            : "channel.inbound",
          source,
          sourceEventId,
          ...(typeof body.payloadRef === "string" ? { payloadRef: body.payloadRef } : {}),
          ...(typeof body.payload !== "undefined" ? { payload: body.payload } : {}),
        };

        await enqueueInbound(message);

        logEvent(service, "webhook.inbound.queued", {
          tenantId,
          source,
          sourceEventId,
          messageId: message.id,
        });

        return json(res, 200, { ok: true, queued: true, id: message.id });
      }

      if (path === "/ops/hooks/routes" && req.method === "GET") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const url = requestUrl(req);
        const tenantId = trimString(url.searchParams.get("tenantId"));
        if (!tenantId) {
          return json(res, 400, { ok: false, error: "tenantId required" });
        }
        const routes = await hooksRepo.listRoutes(tenantId);
        return json(res, 200, { ok: true, tenantId, routes });
      }

      if (path === "/ops/hooks/routes/upsert" && req.method === "POST") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const body = asObject(await readJson(req)) ?? {};
        const tenantId = trimString(body.tenantId);
        const name = trimString(body.name);
        if (!tenantId || !name) {
          return json(res, 400, { ok: false, error: "tenantId and name are required" });
        }

        const tokenHash = trimString(body.tokenHash)
          ?? (trimString(body.token) ? hashHookToken(trimString(body.token)!) : null);
        const route = await hooksRepo.upsertRoute({
          tenantId,
          name,
          action: parseHookAction(body.action),
          enabled: asBoolean(body.enabled, true),
          tokenHash,
          config: parseHookConfig(body.config),
        });
        return json(res, 200, { ok: true, route });
      }

      if (path === "/ops/hooks/routes" && req.method === "DELETE") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const url = requestUrl(req);
        const tenantId = trimString(url.searchParams.get("tenantId"));
        const name = trimString(url.searchParams.get("name"));
        if (!tenantId || !name) {
          return json(res, 400, { ok: false, error: "tenantId and name are required" });
        }
        const deleted = await hooksRepo.deleteRoute(tenantId, name);
        return json(res, 200, { ok: true, tenantId, name, deleted });
      }

      if (path === "/ops/hooks/events" && req.method === "GET") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const url = requestUrl(req);
        const tenantId = trimString(url.searchParams.get("tenantId"));
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
        if (!tenantId) {
          return json(res, 400, { ok: false, error: "tenantId required" });
        }
        const rows = await pg.query(
          `SELECT event_id, hook_name, action, source, path, status, error, created_at_ms, processed_at_ms
           FROM hook_events
           WHERE tenant_id = $1
           ORDER BY created_at_ms DESC
           LIMIT $2`,
          [tenantId, limit],
        );
        return json(res, 200, { ok: true, tenantId, events: rows.rows });
      }

      if (path === "/ops/hooks/agents" && req.method === "GET") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const url = requestUrl(req);
        const tenantId = trimString(url.searchParams.get("tenantId"));
        if (!tenantId) {
          return json(res, 400, { ok: false, error: "tenantId required" });
        }
        const agents = await hookAgentsRepo.listAgents(tenantId);
        return json(res, 200, { ok: true, tenantId, agents });
      }

      if (path === "/ops/hooks/agents/upsert" && req.method === "POST") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const body = asObject(await readJson(req)) ?? {};
        const tenantId = trimString(body.tenantId);
        const agentId = trimString(body.agentId);
        if (!tenantId || !agentId) {
          return json(res, 400, { ok: false, error: "tenantId and agentId are required" });
        }
        const enabled = asBoolean(body.enabled, true);
        const config = asObject(body.config) ?? {};
        const agent = await hookAgentsRepo.upsertAgent({
          tenantId,
          agentId,
          enabled,
          config,
        });
        return json(res, 200, { ok: true, agent });
      }

      if (path === "/ops/hooks/agents" && req.method === "DELETE") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const url = requestUrl(req);
        const tenantId = trimString(url.searchParams.get("tenantId"));
        const agentId = trimString(url.searchParams.get("agentId"));
        if (!tenantId || !agentId) {
          return json(res, 400, { ok: false, error: "tenantId and agentId are required" });
        }
        const deleted = await hookAgentsRepo.deleteAgent(tenantId, agentId);
        return json(res, 200, { ok: true, tenantId, agentId, deleted });
      }

      if (path === "/ops/jobs/failed" && req.method === "GET") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }
        const host = req.headers.host ?? "localhost";
        const url = new URL(req.url ?? "/ops/jobs/failed", `http://${host}`);
        const tenantId = url.searchParams.get("tenantId") ?? "";
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
        if (!tenantId) {
          return json(res, 400, { ok: false, error: "tenantId required" });
        }

        const rows = await pg.query(
          `SELECT id, tenant_id, status, attempt, last_error, updated_at
           FROM jobs
           WHERE tenant_id = $1 AND type = 'channel.outbound' AND status = 'failed'
           ORDER BY updated_at DESC
           LIMIT $2`,
          [tenantId, limit],
        );
        return json(res, 200, { ok: true, jobs: rows.rows });
      }

      if (path === "/ops/jobs/requeue" && req.method === "POST") {
        if (!requireOpsAuth(req)) {
          return json(res, 401, { ok: false, error: "unauthorized" });
        }

        const body = (await readJson(req)) as { jobId?: unknown };
        const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
        if (!jobId) {
          return json(res, 400, { ok: false, error: "jobId required" });
        }

        const row = await pg.query<{
          id: string;
          tenant_id: string;
          type: string;
          status: string;
          idempotency_key: string | null;
          payload_ref: string | null;
          channel_id: string | null;
        }>(
          `SELECT id, tenant_id, type, status, idempotency_key, payload_ref, channel_id
           FROM jobs
           WHERE id = $1
           LIMIT 1`,
          [jobId],
        );

        if (row.rows.length === 0 || row.rows[0].type !== "channel.outbound") {
          return json(res, 404, { ok: false, error: "job not found" });
        }

        const job = row.rows[0];

        await outboundQueue.add("outbound" as const, {
          queueType: "outbound",
          id: job.id,
          tenantId: job.tenant_id,
          channelId: job.channel_id ?? "",
          channelType: "unknown",
          targetId: "unknown",
          ...(job.idempotency_key ? { idempotencyKey: job.idempotency_key } : {}),
          ...(job.payload_ref ? { payloadRef: job.payload_ref } : {}),
        }, {
          attempts: 4,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });

        await pg.query(
          `UPDATE jobs
           SET status = 'queued', attempt = 0, updated_at = $2, last_error = NULL
           WHERE id = $1`,
          [jobId, Date.now()],
        );

        return json(res, 200, { ok: true, requeued: true, jobId });
      }

      return json(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      if (error instanceof ClientAuthError) {
        return json(res, error.status, { ok: false, error: error.message, code: error.code });
      }
      if (error instanceof HttpError) {
        const headers: Record<string, string> = {};
        if (error.code === "HOOK_AUTH_RATE_LIMIT") {
          headers["retry-after"] = String(Math.max(1, Math.ceil(env.OPENCLAW_HOOKS_AUTH_FAIL_WINDOW_MS / 1000)));
        }
        return json(res, error.status, { ok: false, error: error.message, code: error.code }, headers);
      }
      logError(service, "request.error", error);
      return json(res, 500, { ok: false, error: "internal error" });
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
  logError("gateway-api", "server.crash", error);
  process.exit(1);
});
