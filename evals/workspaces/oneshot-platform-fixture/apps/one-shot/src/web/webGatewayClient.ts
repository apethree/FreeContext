import type {
  GatewayAbortChatRequest,
  GatewayAbortChatResponse,
  GatewayChatHistoryRequest,
  GatewayChatHistoryResponse,
  GatewayNodeListResponse,
  GatewayPushEvent,
  GatewayRemoteSettings,
  GatewaySendChatRequest,
  GatewaySendChatResponse,
  GatewayStateSnapshot,
} from "@/gateway/demoTypes";
import {
  createTokenSyncOpId,
  type GatewayProviderProbeRequest,
  type GatewayProviderProbeResult,
  type GatewayTokenKind,
  type GatewayTokenSyncDeleteRequest,
  type GatewayTokenSyncDeleteResult,
  type GatewayTokenSyncPayload,
  type GatewayTokenSyncPullRequest,
  type GatewayTokenSyncPullResult,
  type GatewayTokenSyncPushResult,
} from "@/gateway/tokenSyncTypes";
import type {
  HookAgentDeleteResult,
  HookAgentListResult,
  HookAgentRecord,
  HookAgentUpsertPayload,
  HookAgentUpsertResult,
  HookEventListResult,
  HookEventRecord,
  HookRouteDeleteResult,
  HookRouteListResult,
  HookRouteRecord,
  HookRouteUpsertPayload,
  HookRouteUpsertResult,
} from "@/gateway/hookOpsTypes";

type GatewayFrame = Record<string, unknown>;

type PendingResolver = {
  resolve: (frame: GatewayFrame) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const WS_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
];
const DEFAULT_WS_URL = import.meta.env.DEV ? "ws://127.0.0.1:8789/ws" : "wss://ws.capzero.ai/ws";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toWsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_WS_URL;
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/ws";
  }
  return parsed.toString();
}

function now() {
  return Date.now();
}

function inferCloudTargetFromWsUrl(url: string): GatewayStateSnapshot["cloudTarget"] {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return "none";
  if (normalized.includes("ws.capzero.ai") || normalized.includes("ws.capzero.com") || normalized.startsWith("wss://")) return "prod";
  return "dev-local";
}

function initialState(): GatewayStateSnapshot {
  const wsUrl = toWsUrl(import.meta.env.VITE_ONESHOT_WS_URL || DEFAULT_WS_URL);
  return {
    processStatus: "stopped",
    processDetail: "Local runtime is desktop-only.",
    connectionStatus: "disconnected",
    connectionDetail: "Disconnected.",
    connectionMode: "remote-direct",
    connectionScope: "cloud",
    cloudTarget: inferCloudTargetFromWsUrl(wsUrl),
    tunnelStatus: "stopped",
    tunnelDetail: "Direct websocket mode.",
    lastCloudConnectAttemptAtMs: null,
    lastCloudConnectError: null,
    config: {
      configPath: "web://runtime-unavailable",
      stateDir: "web://runtime-unavailable",
      port: 0,
      wsUrl,
      hasToken: false,
      hasPassword: false,
      parseError: null,
    },
    health: {
      ok: null,
      summary: "Not connected.",
      checkedAtMs: null,
    },
    activity: null,
    lastUpdatedAtMs: now(),
  };
}

export class WebGatewayClient {
  private ws: WebSocket | null = null;

  private state: GatewayStateSnapshot = initialState();

  private token: string | null = null;

  private wsUrl = toWsUrl(import.meta.env.VITE_ONESHOT_WS_URL || DEFAULT_WS_URL);

  private authenticated = false;

  private connectRequestId: string | null = null;

  private connectPromise: Promise<boolean> | null = null;

  private pending = new Map<string, PendingResolver>();

  private gatewayStateListeners = new Set<(payload: GatewayStateSnapshot) => void>();

  private gatewayEventListeners = new Set<(payload: GatewayPushEvent) => void>();

  private autoReconnect = false;

  private reconnectAttempt = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private emitState(next: GatewayStateSnapshot) {
    this.state = { ...next, lastUpdatedAtMs: now() };
    for (const listener of this.gatewayStateListeners) {
      listener(this.state);
    }
  }

  private emitGatewayEvent(event: GatewayPushEvent) {
    for (const listener of this.gatewayEventListeners) {
      listener(event);
    }
  }

  private scheduleReconnect() {
    if (!this.autoReconnect || !this.token) return;
    if (this.reconnectAttempt >= 10) {
      this.reconnectAttempt = 0;
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().then((ok) => {
        if (ok) {
          this.reconnectAttempt = 0;
        }
      });
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  enableAutoReconnect() {
    this.autoReconnect = true;
  }

  disableAutoReconnect() {
    this.autoReconnect = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
  }

  private close(reason: string) {
    this.authenticated = false;
    this.connectRequestId = null;
    if (this.ws) {
      try {
        this.ws.close(1000, reason);
      } catch {
        // no-op
      }
      this.ws = null;
    }
    for (const [id, resolver] of this.pending.entries()) {
      window.clearTimeout(resolver.timeout);
      resolver.reject(new Error(`${reason} (${id})`));
    }
    this.pending.clear();
  }

  private onWsMessage(data: string) {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(data) as GatewayFrame;
    } catch {
      return;
    }

    const type = asString(frame.type);
    if (type === "event") {
      const eventName = asString(frame.event);
      const payload = frame.payload;
      const payloadObj = asObject(payload) ?? {};

      if (eventName === "connect.challenge" && this.ws?.readyState === WebSocket.OPEN) {
        const nonce = asString(payloadObj.nonce);
        if (!nonce) return;
        const connectId = `connect-${crypto.randomUUID()}`;
        this.connectRequestId = connectId;
        this.ws.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              role: "operator",
              scopes: WS_SCOPES,
              nonce,
            },
          }),
        );
        return;
      }

      const mappedType: GatewayPushEvent["type"] =
        eventName === "chat"
          ? "chat"
          : eventName === "agent"
            ? "agent"
            : eventName === "health"
              ? "health"
              : eventName === "tick"
                ? "tick"
                : eventName === "shutdown"
                  ? "shutdown"
                  : "other";
      this.emitGatewayEvent({
        type: mappedType,
        event: eventName,
        payload: payload ?? null,
        seq: typeof frame.seq === "number" ? frame.seq : undefined,
        ts: now(),
      });
      return;
    }

    if (type !== "res") {
      return;
    }

    const responseId = asString(frame.id);
    if (this.connectRequestId && responseId === this.connectRequestId) {
      const ok = frame.ok === true;
      this.authenticated = ok;
      this.connectRequestId = null;
      if (ok) {
        this.emitState({
          ...this.state,
          connectionStatus: "connected",
          connectionDetail: `Connected to ${this.wsUrl}.`,
          lastCloudConnectError: null,
          config: { ...this.state.config, wsUrl: this.wsUrl, hasToken: Boolean(this.token) },
          health: {
            ok: true,
            summary: "Connected.",
            checkedAtMs: now(),
          },
        });
      } else {
        this.emitState({
          ...this.state,
          connectionStatus: "disconnected",
          connectionDetail: asString(asObject(frame.error)?.message) || "Websocket authentication failed.",
          lastCloudConnectError: asString(asObject(frame.error)?.message) || "Websocket authentication failed.",
          config: { ...this.state.config, wsUrl: this.wsUrl, hasToken: Boolean(this.token) },
          health: {
            ok: false,
            summary: "Authentication failed.",
            checkedAtMs: now(),
          },
        });
      }
      return;
    }

    const resolver = this.pending.get(responseId);
    if (!resolver) return;
    this.pending.delete(responseId);
    window.clearTimeout(resolver.timeout);
    resolver.resolve(frame);
  }

  async setWsUrl(raw: string) {
    this.wsUrl = toWsUrl(raw);
    this.state = {
      ...this.state,
      cloudTarget: inferCloudTargetFromWsUrl(this.wsUrl),
      config: { ...this.state.config, wsUrl: this.wsUrl },
    };
    if (this.authenticated) {
      await this.connect();
    }
  }

  setToken(token: string) {
    const trimmed = token.trim();
    this.token = trimmed || null;
    this.state = {
      ...this.state,
      config: { ...this.state.config, hasToken: Boolean(this.token) },
    };
  }

  async connect(): Promise<boolean> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (!this.token) {
      this.emitState({
        ...this.state,
        connectionStatus: "disconnected",
        connectionDetail: "Missing Clerk token.",
        lastCloudConnectAttemptAtMs: now(),
        lastCloudConnectError: "Missing Clerk token.",
        config: { ...this.state.config, wsUrl: this.wsUrl, hasToken: false },
        health: {
          ok: false,
          summary: "Missing token.",
          checkedAtMs: now(),
        },
      });
      return false;
    }
    if (!this.wsUrl) {
      this.emitState({
        ...this.state,
        connectionStatus: "disconnected",
        connectionDetail: "Cloud websocket URL is not configured.",
        lastCloudConnectAttemptAtMs: now(),
        lastCloudConnectError: "Cloud websocket URL is not configured.",
        config: { ...this.state.config, wsUrl: "", hasToken: Boolean(this.token) },
        health: {
          ok: false,
          summary: "Cloud endpoint not configured.",
          checkedAtMs: now(),
        },
      });
      return false;
    }

    this.connectPromise = new Promise<boolean>((resolve) => {
      this.clearReconnectTimer();
      this.close("reconnect");
      const url = new URL(this.wsUrl);
      url.searchParams.set("token", this.token as string);
      this.emitState({
        ...this.state,
        connectionStatus: "connecting",
        connectionDetail: `Connecting to ${url.origin}...`,
        cloudTarget: inferCloudTargetFromWsUrl(url.toString()),
        lastCloudConnectAttemptAtMs: now(),
        lastCloudConnectError: null,
        config: { ...this.state.config, wsUrl: url.toString(), hasToken: true },
        health: {
          ok: null,
          summary: "Connecting...",
          checkedAtMs: now(),
        },
      });

      const ws = new WebSocket(url.toString());
      this.ws = ws;

      const timeout = window.setTimeout(() => {
        if (this.ws === ws && !this.authenticated) {
          this.close("connect-timeout");
          this.emitState({
            ...this.state,
            connectionStatus: "disconnected",
            connectionDetail: "Timeout waiting for websocket authentication.",
            lastCloudConnectError: "Timeout waiting for websocket authentication.",
            health: {
              ok: false,
              summary: "Connection timeout.",
              checkedAtMs: now(),
            },
          });
          resolve(false);
        }
      }, 12_000);

      ws.addEventListener("open", () => {
        this.emitState({
          ...this.state,
          connectionStatus: "connecting",
          connectionDetail: "Websocket open. Waiting for challenge handshake.",
          config: { ...this.state.config, wsUrl: url.toString(), hasToken: true },
          health: {
            ok: null,
            summary: "Authenticating...",
            checkedAtMs: now(),
          },
        });
      });

      ws.addEventListener("message", (event) => {
        this.onWsMessage(typeof event.data === "string" ? event.data : String(event.data));
        if (this.authenticated) {
          window.clearTimeout(timeout);
          resolve(true);
        }
      });

      ws.addEventListener("error", () => {
        window.clearTimeout(timeout);
        this.emitState({
          ...this.state,
          connectionStatus: "disconnected",
          connectionDetail: "Websocket connection error.",
          lastCloudConnectError: "Websocket connection error.",
          config: { ...this.state.config, wsUrl: url.toString(), hasToken: Boolean(this.token) },
          health: {
            ok: false,
            summary: "Connection error.",
            checkedAtMs: now(),
          },
        });
        resolve(false);
      });

      ws.addEventListener("close", () => {
        window.clearTimeout(timeout);
        this.authenticated = false;
        if (this.ws === ws) {
          this.ws = null;
        }
        this.emitState({
          ...this.state,
          connectionStatus: "disconnected",
          connectionDetail: "Websocket closed.",
          lastCloudConnectError: "Websocket closed.",
          config: { ...this.state.config, hasToken: Boolean(this.token) },
          health: {
            ok: false,
            summary: "Disconnected.",
            checkedAtMs: now(),
          },
        });
        this.scheduleReconnect();
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  disconnect() {
    this.disableAutoReconnect();
    this.close("manual-disconnect");
    this.emitState({
      ...this.state,
      connectionStatus: "disconnected",
      connectionDetail: "Disconnected.",
      health: {
        ok: null,
        summary: "Disconnected.",
        checkedAtMs: now(),
      },
    });
  }

  private async request(method: string, params?: unknown, timeoutMs = 20_000): Promise<GatewayFrame> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      const ok = await this.connect();
      if (!ok || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
        throw new Error("remote websocket not connected");
      }
    }

    const id = `${method}-${crypto.randomUUID()}`;
    return await new Promise<GatewayFrame>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws?.send(JSON.stringify({ type: "req", id, method, params: params ?? {} }));
    });
  }

  private async requestPayload(method: string, params?: unknown, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const frame = await this.request(method, params, timeoutMs);
    if (frame.ok !== true) {
      throw new Error(asString(asObject(frame.error)?.message) || `${method} failed`);
    }
    return asObject(frame.payload) ?? {};
  }

  getState() {
    return this.state;
  }

  onGatewayState(listener: (payload: GatewayStateSnapshot) => void) {
    this.gatewayStateListeners.add(listener);
    listener(this.state);
    return () => {
      this.gatewayStateListeners.delete(listener);
    };
  }

  onGatewayEvent(listener: (payload: GatewayPushEvent) => void) {
    this.gatewayEventListeners.add(listener);
    return () => {
      this.gatewayEventListeners.delete(listener);
    };
  }

  async getDevices(): Promise<GatewayNodeListResponse> {
    const payload = await this.requestPayload("node.list", {});
    const nodesRaw = Array.isArray(payload.nodes) ? payload.nodes : [];
    return {
      ts: typeof payload.ts === "number" ? payload.ts : now(),
      nodes: nodesRaw.map((entry) => {
        const node = asObject(entry) ?? {};
        return {
          nodeId: asString(node.id) || asString(node.nodeId),
          displayName: asString(node.displayName),
          platform: asString(node.platform),
          paired: true,
          connected: Boolean(node.isActive),
        };
      }),
    };
  }

  async getChatHistory(request: GatewayChatHistoryRequest): Promise<GatewayChatHistoryResponse> {
    const payload = await this.requestPayload("chat.history", {
      sessionId: request.sessionKey,
      limit: request.limit ?? 200,
    });
    const messagesRaw = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = messagesRaw.map((entry) => {
      const msg = asObject(entry) ?? {};
      return {
        id: asString(msg.id) || crypto.randomUUID(),
        role: asString(msg.role) === "assistant" ? "assistant" : "user",
        text: asString(msg.content),
        timestamp: typeof msg.createdAt === "number" ? msg.createdAt : now(),
        ...(typeof msg.seq === "number" ? { seq: msg.seq } : {}),
      };
    });
    return {
      sessionKey: request.sessionKey,
      messages,
    };
  }

  async sendChat(request: GatewaySendChatRequest): Promise<GatewaySendChatResponse> {
    const payload = await this.requestPayload(
      "chat.send",
      {
        sessionId: request.sessionKey,
        message: request.message,
        provider: request.provider || "openai",
        model: request.model,
        system: request.system,
        thinking: request.thinking,
        idempotencyKey: request.idempotencyKey || crypto.randomUUID(),
        attachments: request.attachments,
        deliver: false,
      },
      120_000,
    );
    return {
      runId: asString(payload.runId) || crypto.randomUUID(),
      status: asString(payload.status) || "submitted-cloud",
    };
  }

  async abortChat(request: GatewayAbortChatRequest): Promise<GatewayAbortChatResponse> {
    try {
      const payload = await this.requestPayload("chat.abort", {
        sessionId: request.sessionKey,
        runId: request.runId,
      });
      return {
        ok: payload.ok !== false,
        aborted: payload.aborted !== false,
      };
    } catch {
      return { ok: false, aborted: false };
    }
  }

  async debugCloudSnapshot(payload?: { limit?: number; sessionId?: string; includeR2?: boolean }) {
    const result = await this.requestPayload("debug.snapshot", payload ?? {}, 30_000);
    return {
      ok: true,
      payload: result,
    };
  }

  async syncTokenToCloud(payload: GatewayTokenSyncPayload): Promise<GatewayTokenSyncPushResult> {
    const opId = payload.opId?.trim() || createTokenSyncOpId("push");
    const source = payload.source?.trim() || "web-shell";
    try {
      const result = await this.requestPayload("token.sync.push", {
        ...payload,
        opId,
        source,
      });
      const tokenKind: GatewayTokenKind | null = result.tokenKind === "oauth" || result.tokenKind === "api-key"
        ? result.tokenKind
        : null;
      const verified = result.verified === true;
      return {
        pushed: true,
        opId: asString(result.opId) || opId,
        verified,
        hasToken: result.hasToken === true,
        tokenKind,
        fingerprint: asString(result.fingerprint) || null,
        ...(verified ? {} : { reason: asString(result.reason) || "push failed verification" }),
        updatedAtMs: typeof result.updatedAtMs === "number" ? result.updatedAtMs : null,
      };
    } catch (error) {
      return {
        pushed: false,
        opId,
        reason: String(error),
      };
    }
  }

  async pullTokenFromCloud(request: string | GatewayTokenSyncPullRequest): Promise<GatewayTokenSyncPullResult> {
    const provider = typeof request === "string" ? request : request.provider;
    const opId = typeof request === "string"
      ? createTokenSyncOpId("pull")
      : (request.opId?.trim() || createTokenSyncOpId("pull"));
    const source = typeof request === "string"
      ? "web-shell"
      : (request.source?.trim() || "web-shell");
    try {
      const result = await this.requestPayload("token.sync.pull", { provider, opId, source });
      const token = asString(result.token);
      const tokenKind: GatewayTokenKind | null = result.tokenKind === "oauth" || result.tokenKind === "api-key"
        ? result.tokenKind
        : null;
      return {
        ok: true,
        opId: asString(result.opId) || opId,
        hasToken: Boolean(token),
        token: token || null,
        email: asString(result.email) || null,
        piProviderId: asString(result.piProviderId) || null,
        oauthProviderId: asString(result.oauthProviderId) || null,
        refreshToken: asString(result.refreshToken) || null,
        expiresAtMs: typeof result.expiresAtMs === "number" ? result.expiresAtMs : null,
        accountId: asString(result.accountId) || null,
        projectId: asString(result.projectId) || null,
        metadata: result.metadata && typeof result.metadata === "object"
          ? result.metadata as Record<string, unknown>
          : null,
        updatedAtMs: typeof result.updatedAtMs === "number" ? result.updatedAtMs : null,
        tokenKind,
        fingerprint: asString(result.fingerprint) || null,
      };
    } catch (error) {
      return {
        ok: false,
        reason: String(error),
        opId,
        hasToken: false,
        token: null,
        email: null,
        piProviderId: null,
        oauthProviderId: null,
        refreshToken: null,
        expiresAtMs: null,
        accountId: null,
        projectId: null,
        metadata: null,
        updatedAtMs: null,
        tokenKind: null,
        fingerprint: null,
      };
    }
  }

  async deleteTokenFromCloud(request: string | GatewayTokenSyncDeleteRequest): Promise<GatewayTokenSyncDeleteResult> {
    const provider = typeof request === "string" ? request : request.provider;
    const opId = typeof request === "string"
      ? createTokenSyncOpId("delete")
      : (request.opId?.trim() || createTokenSyncOpId("delete"));
    const source = typeof request === "string"
      ? "web-shell"
      : (request.source?.trim() || "web-shell");
    try {
      const result = await this.requestPayload("token.sync.delete", { provider, opId, source });
      const verified = result.verified === true;
      return {
        deleted: verified,
        verified,
        hasToken: result.hasToken === true,
        opId: asString(result.opId) || opId,
        ...(verified ? {} : { reason: asString(result.reason) || "delete failed verification" }),
        updatedAtMs: typeof result.updatedAtMs === "number" ? result.updatedAtMs : null,
      };
    } catch (error) {
      return {
        deleted: false,
        opId,
        reason: String(error),
      };
    }
  }

  async probeProviderFromCloud(request: string | GatewayProviderProbeRequest): Promise<GatewayProviderProbeResult> {
    const provider = typeof request === "string" ? request : request.provider;
    const model = typeof request === "string" ? "" : (request.model?.trim() || "");
    const opId = typeof request === "string"
      ? createTokenSyncOpId("probe")
      : (request.opId?.trim() || createTokenSyncOpId("probe"));
    const source = typeof request === "string"
      ? "web-shell"
      : (request.source?.trim() || "web-shell");
    try {
      const result = await this.requestPayload("provider.probe", {
        provider,
        ...(model ? { model } : {}),
        opId,
        source,
      }, 30_000);
      const capable = result.capable === true;
      return {
        ok: true,
        capable,
        ...(capable ? {} : { reason: asString(result.error) || asString(result.reason) || "provider capability probe failed" }),
        errorCode: asString(result.code) || null,
        opId: asString(result.opId) || opId,
        provider: asString(result.provider) || provider,
        model: asString(result.model) || model || undefined,
        latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : null,
      };
    } catch (error) {
      return {
        ok: false,
        capable: false,
        reason: String(error),
        opId,
        provider,
      };
    }
  }

  async listHookRoutesFromCloud(): Promise<HookRouteListResult> {
    try {
      const response = await this.requestPayload("hook.route.list", {});
      const routesRaw = Array.isArray(response.routes) ? response.routes : [];
      const routes: HookRouteRecord[] = routesRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          tenantId: asString(row.tenantId),
          name: asString(row.name),
          action: asString(row.action) === "agent" ? "agent" : "wake",
          enabled: row.enabled !== false,
          tokenHash: asString(row.tokenHash) || null,
          config: (asObject(row.config) ?? {}) as HookRouteRecord["config"],
          createdAtMs: typeof row.createdAtMs === "number" ? row.createdAtMs : 0,
          updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
        };
      });
      return { ok: true, routes };
    } catch (error) {
      return { ok: false, reason: String(error), routes: [] };
    }
  }

  async upsertHookRouteInCloud(payload: HookRouteUpsertPayload): Promise<HookRouteUpsertResult> {
    try {
      const response = await this.requestPayload("hook.route.upsert", payload);
      const routeRaw = asObject(response.route);
      if (!routeRaw) return { ok: false, reason: "invalid response payload" };
      const route: HookRouteRecord = {
        tenantId: asString(routeRaw.tenantId),
        name: asString(routeRaw.name),
        action: asString(routeRaw.action) === "agent" ? "agent" : "wake",
        enabled: routeRaw.enabled !== false,
        tokenHash: asString(routeRaw.tokenHash) || null,
        config: (asObject(routeRaw.config) ?? {}) as HookRouteRecord["config"],
        createdAtMs: typeof routeRaw.createdAtMs === "number" ? routeRaw.createdAtMs : 0,
        updatedAtMs: typeof routeRaw.updatedAtMs === "number" ? routeRaw.updatedAtMs : 0,
      };
      return { ok: true, route };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  async deleteHookRouteFromCloud(name: string): Promise<HookRouteDeleteResult> {
    try {
      const response = await this.requestPayload("hook.route.delete", { name });
      return {
        ok: true,
        deleted: response.deleted === true,
      };
    } catch (error) {
      return { ok: false, reason: String(error), deleted: false };
    }
  }

  async listHookEventsFromCloud(limit = 50): Promise<HookEventListResult> {
    try {
      const response = await this.requestPayload("hook.event.list", { limit });
      const eventsRaw = Array.isArray(response.events) ? response.events : [];
      const events: HookEventRecord[] = eventsRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          eventId: asString(row.eventId),
          hookName: asString(row.hookName),
          action: asString(row.action) === "agent" ? "agent" : "wake",
          source: asString(row.source),
          path: asString(row.path),
          status: asString(row.status),
          error: asString(row.error) || null,
          payloadRef: asString(row.payloadRef) || null,
          payloadJson: row.payloadJson ?? null,
          createdAtMs: typeof row.createdAtMs === "number" ? row.createdAtMs : 0,
          processedAtMs: typeof row.processedAtMs === "number" ? row.processedAtMs : null,
        };
      });
      return { ok: true, events };
    } catch (error) {
      return { ok: false, reason: String(error), events: [] };
    }
  }

  async listHookAgentsFromCloud(): Promise<HookAgentListResult> {
    try {
      const response = await this.requestPayload("hook.agent.list", {});
      const agentsRaw = Array.isArray(response.agents) ? response.agents : [];
      const agents: HookAgentRecord[] = agentsRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          tenantId: asString(row.tenantId),
          agentId: asString(row.agentId),
          enabled: row.enabled !== false,
          config: asObject(row.config) ?? {},
          createdAtMs: typeof row.createdAtMs === "number" ? row.createdAtMs : 0,
          updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
        };
      });
      return { ok: true, agents };
    } catch (error) {
      return { ok: false, reason: String(error), agents: [] };
    }
  }

  async upsertHookAgentInCloud(payload: HookAgentUpsertPayload): Promise<HookAgentUpsertResult> {
    try {
      const response = await this.requestPayload("hook.agent.upsert", payload);
      const row = asObject(response.agent);
      if (!row) return { ok: false, reason: "invalid response payload" };
      const agent: HookAgentRecord = {
        tenantId: asString(row.tenantId),
        agentId: asString(row.agentId),
        enabled: row.enabled !== false,
        config: asObject(row.config) ?? {},
        createdAtMs: typeof row.createdAtMs === "number" ? row.createdAtMs : 0,
        updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
      };
      return { ok: true, agent };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  async deleteHookAgentFromCloud(agentId: string): Promise<HookAgentDeleteResult> {
    try {
      const response = await this.requestPayload("hook.agent.delete", { agentId });
      return {
        ok: true,
        deleted: response.deleted === true,
      };
    } catch (error) {
      return { ok: false, reason: String(error), deleted: false };
    }
  }

  async syncChannelToCloud(
    channelId: string,
    type: string,
    config: Record<string, unknown>,
    isActive: boolean,
    linkedSessionId?: string | null,
  ) {
    await this.requestPayload("channel.upsert", {
      channelId,
      type,
      config,
      isActive,
      ...(typeof linkedSessionId === "string" ? { linkedSessionId } : {}),
    });
    return { pushed: true };
  }

  async deleteChannelFromCloud(channelId: string) {
    const result = await this.requestPayload("channel.delete", { channelId });
    return { deleted: result.deleted !== false };
  }

  async pullChannelsFromCloud() {
    const result = await this.requestPayload("channel.list", {});
    return Array.isArray(result.channels) ? result.channels : [];
  }

  async probeChannelFromCloud(channelId: string) {
    const result = await this.requestPayload("channel.probe", { channelId });
    const raw = asObject(result.probe);
    const probe = raw ? {
      ok: raw.ok === true,
      skipped: raw.skipped === true ? true : undefined,
      elapsedMs: typeof raw.elapsedMs === "number" ? raw.elapsedMs : undefined,
      bot: asObject(raw.bot) ? {
        id: asString((asObject(raw.bot) ?? {}).id) || undefined,
        username: asString((asObject(raw.bot) ?? {}).username) || undefined,
      } : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
    } : null;
    return { ok: true, channelId, probe };
  }

  async getChannelStatusFromCloud(channelId: string) {
    const result = await this.requestPayload("channel.status", { channelId });
    return {
      ok: true,
      found: Boolean(result.found),
      channel: result.channel ?? null,
      runtime: result.runtime ?? null,
      health: result.health ?? null,
    };
  }

  async callCloudMethod(method: string, params?: unknown, timeoutMs = 20_000) {
    try {
      const payload = await this.requestPayload(method, params ?? {}, timeoutMs);
      return { ok: true as const, payload };
    } catch (error) {
      return {
        ok: false as const,
        reason: String(error),
        payload: null as Record<string, unknown> | null,
      };
    }
  }

  getRemoteSettings(): GatewayRemoteSettings {
    return {
      transport: "direct",
      sshTarget: "",
      sshPort: 22,
      identityFile: "",
      remoteGatewayPort: 443,
      remoteUrl: this.wsUrl,
      token: "",
      password: "",
    };
  }
}
