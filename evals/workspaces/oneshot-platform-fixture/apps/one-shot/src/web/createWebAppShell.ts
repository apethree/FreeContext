import type {
  GatewayAbortChatRequest,
  GatewayChatHistoryRequest,
  GatewayRemoteSettings,
  GatewaySendChatRequest,
} from "@/gateway/demoTypes";
import type {
  HookAgentDeleteResult,
  HookAgentUpsertPayload,
  HookAgentUpsertResult,
  HookEventListResult,
  HookRouteDeleteResult,
  HookRouteUpsertPayload,
  HookRouteUpsertResult,
} from "@/gateway/hookOpsTypes";
import {
  buildApiKeyTokenSyncPayload,
  createTokenSyncOpId,
  normalizeCloudProvider,
} from "@/gateway/tokenSyncTypes";
import type { AppCapabilities } from "@/lib/appCapabilities";
import { WebGatewayClient } from "@/web/webGatewayClient";

const APP_STATE_KEY = "oneshot.web.app-state";
const SETTINGS_PREFIX = "oneshot.web.setting.";
const DEFAULT_WS_URL = import.meta.env.DEV ? "ws://127.0.0.1:8789/ws" : "wss://ws.capzero.ai/ws";
const DEFAULT_API_URL = import.meta.env.DEV ? "http://127.0.0.1:8790" : "https://api.capzero.ai";
const WS_URL_ENV = import.meta.env.VITE_ONESHOT_WS_URL || DEFAULT_WS_URL;
const API_URL_ENV = import.meta.env.VITE_ONESHOT_API_URL || DEFAULT_API_URL;

function normalizeProvider(provider: string) {
  return normalizeCloudProvider(provider);
}

function tryParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readSetting(key: string): unknown {
  return tryParseJson(window.localStorage.getItem(`${SETTINGS_PREFIX}${key}`));
}

function writeSetting(key: string, value: unknown) {
  window.localStorage.setItem(`${SETTINGS_PREFIX}${key}`, JSON.stringify(value));
}

function localRuntimeUnavailableSnapshot() {
  return {
    activeUserId: null,
    profileRoot: null,
    stateDir: null,
    configPath: null,
    status: "stopped" as const,
    detail: "Local OpenClaw runtime is available only in the desktop app.",
    launcherLabel: null,
    pid: null,
    startedAtMs: null,
    gatewayProbe: {
      checkedAtMs: Date.now(),
      port: 0,
      reachable: false,
      detail: "Not available in web runtime.",
    },
    gatewayStatus: {
      checkedAtMs: Date.now(),
      ok: false,
      detail: "Not available in web runtime.",
      output: "",
    },
    logTail: [] as string[],
  };
}

export function createWebAppShell(): Window["appShell"] {
  const gateway = new WebGatewayClient();
  let clerkToken = "";

  const capabilities: AppCapabilities = {
    platform: "web",
    localRuntime: false,
    terminal: false,
    projectShell: false,
    autoUpdate: false,
    speechToText: false,
  };

  const runProviderReadyCheck = async (payload: {
    provider: string;
    runtime: 'local' | 'cloud' | 'auto';
    capabilityProbe?: boolean;
    model?: string;
  }) => {
    if (payload.runtime === "local") {
      return {
        ready: false,
        local: false,
        cloud: false,
        healed: false,
        reason: "local runtime is not available in web mode",
      };
    }
    const connected = await ensureCloudConnected();
    if (!connected) {
      return {
        ready: false,
        local: false,
        cloud: false,
        healed: false,
        reason: "cloud not connected",
      };
    }
    const provider = normalizeProvider(payload.provider);
    const params = new URLSearchParams();
    if (payload.model?.trim()) {
      params.set("model", payload.model.trim());
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const response = await fetch(`${API_URL_ENV}/api/credentials/${encodeURIComponent(provider)}/probe${suffix}`, {
      headers: clerkToken.trim().length > 0
        ? { authorization: `Bearer ${clerkToken.trim()}` }
        : undefined,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => response.statusText)).trim();
      return {
        ready: false,
        local: false,
        cloud: false,
        healed: false,
        reason: detail || `${response.status} ${response.statusText}`,
      };
    }
    const probe = await response.json() as { ok?: boolean; ready?: boolean; capable?: boolean; reason?: string };
    return {
      ready: Boolean(probe.ok && probe.ready && probe.capable !== false),
      local: false,
      cloud: Boolean(probe.ok && probe.ready && probe.capable !== false),
      healed: false,
      ...(probe.ok && probe.ready && probe.capable !== false ? {} : { reason: probe.reason ?? `no cloud token for ${provider}` }),
    };
  };

  const connectWithToken = async (token: string, wsDomain?: string) => {
    const trimmed = token.trim();
    if (!trimmed) return false;
    clerkToken = trimmed;
    gateway.enableAutoReconnect();
    gateway.setToken(trimmed);
    await gateway.setWsUrl(wsDomain || WS_URL_ENV);
    return await gateway.connect();
  };

  const cacheCloudToken = async (token: string, wsDomain?: string) => {
    const trimmed = token.trim();
    if (!trimmed) return false;
    clerkToken = trimmed;
    gateway.setToken(trimmed);
    await gateway.setWsUrl(wsDomain || WS_URL_ENV);
    return true;
  };

  const ensureCloudConnected = async () => {
    if (!clerkToken) return false;
    return await gateway.connect();
  };

  const isCloudUsable = () => {
    const state = gateway.getState();
    return state.connectionStatus === "connected";
  };

  const webDisconnectedReason = "Cloud gateway is not connected in web runtime.";

  const ifCloudConnected = async <T,>(run: () => Promise<T>, fallback: T): Promise<T> => {
    if (!isCloudUsable()) {
      return fallback;
    }
    return await run();
  };

  const appShell: Window["appShell"] = {
    getCapabilities: () => capabilities,

    getSetting: async (key: string) => readSetting(key),
    setSetting: async (key: string, value: unknown) => {
      writeSetting(key, value);
    },
    getAppState: async () => {
      const raw = tryParseJson(window.localStorage.getItem(APP_STATE_KEY));
      return (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
    },
    setAppState: async (state: Record<string, unknown>) => {
      window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    },

    debugLog: async (payload) => {
      console.debug("[app.debugLog]", payload.message, payload.details ?? null);
      return true;
    },
    logEvent: async (payload) => {
      console.info("[app.logEvent]", payload.domain, payload.action, payload.status ?? "info", payload.data ?? null);
      return true;
    },
    getObservabilityEvents: async () => [],
    clearObservabilityEvents: async () => true,
    onObservabilityEvent: () => () => undefined,

    openExternalUrl: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openProjectDialog: async () => null,
    openFileDialog: async () => null,
    openDocumentDialog: async () => null,
    openDocumentTarget: async () => ({ ok: false, error: "Desktop document bridge is unavailable in web runtime." }),
    documentCreateSession: async () => ({ ok: false, error: "Desktop document sessions are unavailable in web runtime." }),
    documentSaveSession: async () => ({ ok: false, error: "Desktop document sessions are unavailable in web runtime." }),
    documentCloseSession: async () => ({ ok: true, closed: false }),
    documentGetCapabilities: async () => ({
      officeEditing: {
        enabled: true,
        available: false,
        serverUrl: null,
        supportedExtensions: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'],
        reason: 'Desktop runtime required for local Office editing.',
      },
      previewFallback: {
        enabled: true,
        converterAvailable: false,
        converterCommand: null,
      },
    }),
    openProjectTarget: async () => false,

    checkProxyHealth: async (payload: { baseUrl: string; authToken?: string }) => {
      const startedAt = Date.now();
      const baseUrl = (payload.baseUrl || API_URL_ENV).trim();
      const target = `${baseUrl.replace(/\/+$/, "")}/health`;
      try {
        const response = await fetch(target, {
          headers: payload.authToken ? { authorization: `Bearer ${payload.authToken}` } : undefined,
        });
        return {
          healthy: response.ok,
          latency_ms: Date.now() - startedAt,
          status_code: response.status,
          error: response.ok ? "" : `health endpoint returned ${response.status}`,
        };
      } catch (error) {
        return {
          healthy: false,
          latency_ms: Date.now() - startedAt,
          status_code: null,
          error: String(error),
        };
      }
    },
    getProxyOauthUrl: async () => ({ url: "", state: "" }),
    pollProxyOauthStatus: async () => false,
    refreshProxyAuthStatus: async () => ({ claude: 0, openai: 0, gemini: 0 }),

    startTerminal: async () => ({ sessionId: "web-unsupported", cwd: "/" }),
    writeTerminal: async () => false,
    resizeTerminal: async () => false,
    stopTerminal: async () => false,
    onTerminalOutput: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onMenuCommand: () => () => undefined,

    gatewayGetState: async () => gateway.getState(),
    gatewayEnableOpenclaw: async () => gateway.getState(),
    gatewayDisableOpenclaw: async () => gateway.getState(),
    gatewayConnect: async () => {
      await ensureCloudConnected();
      return gateway.getState();
    },
    gatewayDisconnect: async () => {
      gateway.disconnect();
      return gateway.getState();
    },
    gatewayConnectRemote: async (settings: GatewayRemoteSettings) => {
      const token = settings.token.trim() || clerkToken;
      await connectWithToken(token, settings.remoteUrl || WS_URL_ENV);
      return gateway.getState();
    },
    gatewayGetRemoteSettings: async () => gateway.getRemoteSettings(),
    gatewayGetDevices: async () => await gateway.getDevices(),
    gatewayGetChatHistory: async (payload: GatewayChatHistoryRequest) => {
      if (!isCloudUsable()) {
        return {
          sessionKey: payload.sessionKey,
          messages: [],
        };
      }
      return await gateway.getChatHistory(payload);
    },
    gatewaySendChat: async (payload: GatewaySendChatRequest) => await gateway.sendChat(payload),
    gatewayAbortChat: async (payload: GatewayAbortChatRequest) => await gateway.abortChat(payload),
    gatewayDebugCloudSnapshot: async (payload?: { limit?: number; sessionId?: string; includeR2?: boolean }) =>
      await gateway.debugCloudSnapshot(payload),
    gatewayConnectCloud: async (payload: { token: string; wsDomain?: string }) => {
      await connectWithToken(payload.token, payload.wsDomain);
      return true;
    },
    onGatewayState: (listener) => gateway.onGatewayState(listener),
    onGatewayEvent: (listener) => gateway.onGatewayEvent(listener),

    pipelinePushClerkToken: async (payload: { token: string }) => {
      await cacheCloudToken(payload.token, WS_URL_ENV);
      return { ok: true };
    },
    pipelineSetActiveUser: async (payload: { userId: string; tenantId?: string; clerkToken?: string }) => {
      if (payload.clerkToken) {
        await cacheCloudToken(payload.clerkToken, WS_URL_ENV);
      }
      return localRuntimeUnavailableSnapshot();
    },
    pipelineGetLocalOpenclawStatus: async () => localRuntimeUnavailableSnapshot(),
    pipelineCheckOpenclawRuntime: async () => ({
      checkedAtMs: Date.now(),
      packagedOnly: false,
      expectedBinaryName: "openclaw",
      expectedPaths: [],
      foundPaths: [],
      candidates: [],
      hasRuntime: false,
      detail: "OpenClaw local runtime is available only in the desktop app.",
    }),
    pipelineStartLocalOpenclaw: async () => ({
      status: "failed" as const,
      detail: "Not available in web runtime.",
      pid: null,
    }),
    pipelineStopLocalOpenclaw: async () => ({
      status: "stopped" as const,
      detail: "Not available in web runtime.",
    }),
    pipelineLaunchProviderOAuth: async () => ({
      sessionId: "",
      status: "failed" as const,
      authUrl: null,
      instructions: null,
      promptMessage: null,
      promptPlaceholder: null,
      promptAllowEmpty: false,
      detail: "Desktop-only OAuth flow.",
    }),
    pipelineOAuthSubmitInput: async () => ({ ok: false }),
    pipelineOAuthStatus: async () => ({ found: false }),
    pipelineOAuthCancel: async () => ({ ok: false, found: false }),
    pipelineSaveProviderToken: async (payload: { provider: string; token: string }) => {
      const provider = normalizeProvider(payload.provider);
      const token = payload.token.trim();
      if (!token) return { ok: false, profileId: "" };
      await gateway.syncTokenToCloud(
        buildApiKeyTokenSyncPayload(provider, token, {
          opId: createTokenSyncOpId("web-save"),
          source: "web-shell",
        }),
      );
      return { ok: true, profileId: provider };
    },
    pipelineRefreshLocalCredentialCache: async (payload: { provider: string }) => {
      void payload;
      return {
        ok: false,
        provider: '',
        profileId: '',
        type: 'token' as const,
      };
    },
    pipelineRemoveLocalCredentialCache: async (payload: { provider: string }) => {
      void payload;
      return {
        ok: false,
        provider: '',
        aliases: [],
        removedProfiles: [],
        removedCount: 0,
      };
    },
    pipelineCheckLocalProviderReady: async (_payload: {
      provider: string;
      capabilityProbe?: boolean;
      model?: string;
    }) => ({
      ready: false,
      local: false,
      capabilityChecked: Boolean(_payload.capabilityProbe),
      reason: 'local runtime is not available in web mode',
    }),
    pipelineDeleteProviderToken: async (payload: { provider: string }) => {
      const provider = normalizeProvider(payload.provider);
      await gateway.deleteTokenFromCloud({
        provider,
        opId: createTokenSyncOpId("web-delete"),
        source: "web-shell",
      });
      return {
        ok: true,
        provider,
        removedProfiles: [provider],
        removedCount: 1,
      };
    },
    pipelineRecheckProviderStatus: async (payload: {
      provider: string;
      runtime: "local" | "cloud" | "auto";
      capabilityProbe?: boolean;
      model?: string;
    }) => await runProviderReadyCheck(payload),
    pipelineEnsureProviderReady: async (payload: {
      provider: string;
      runtime: "local" | "cloud" | "auto";
      capabilityProbe?: boolean;
      model?: string;
    }) => await runProviderReadyCheck(payload),
    pipelineChatSend: async (payload: {
      provider: string;
      runtime: "local" | "cloud" | "auto";
      model: string;
      sessionId: string;
      message: string;
      attachments?: Array<{ type: "image"; mimeType: string; content: string; fileName?: string }>;
      idempotencyKey: string;
    }) => {
      if (payload.runtime === "local") {
        return {
          ok: false as const,
          error: "local runtime is not available in web mode",
          blockedBy: "not-connected" as const,
        };
      }
      const providerReady = await appShell.pipelineEnsureProviderReady({
        provider: payload.provider,
        runtime: payload.runtime,
        capabilityProbe: false,
      });
      if (!providerReady.ready) {
        return {
          ok: false as const,
          error: providerReady.reason ?? "provider not ready",
          blockedBy: providerReady.cloud ? "no-token" as const : "not-connected" as const,
        };
      }

      const result = await gateway.sendChat({
        sessionKey: payload.sessionId,
        message: payload.message,
        attachments: payload.attachments,
        provider: normalizeProvider(payload.provider),
        model: payload.model,
        idempotencyKey: payload.idempotencyKey,
      });
      return {
        ok: true as const,
        runId: result.runId,
        status: result.status,
        healed: false,
      };
    },
    pipelineListProviderModels: async (payload: { provider: string }) => {
      const provider = normalizeProvider(payload.provider);
      const byProvider: Record<string, Array<{ id: string; label: string }>> = {
        openai: [
          { id: "gpt-5.2", label: "GPT-5.2" },
          { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
          { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
        ],
        anthropic: [
          { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
          { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        ],
        gemini: [
          { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
          { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
        ],
      };
      return { provider, models: byProvider[provider] ?? [] };
    },
    pipelineListAuthProfiles: async () => [],
    pipelineGetAuthStoreDiagnostics: async () => ({
      authStorePath: null,
      exists: false,
      profileCount: 0,
      profiles: [],
    }),
    pipelineGetAuthProfileSecret: async () => ({
      profileId: "",
      provider: "",
      token: "",
      tokenPreview: "",
      tokenLength: 0,
      type: "web",
    }),
    pipelineProbeChannel: async (payload: { channelId: string }) => {
      return gateway.probeChannelFromCloud(payload.channelId);
    },
    pipelineGetChannelStatus: async (payload: { channelId: string }) => {
      const result = await gateway.getChannelStatusFromCloud(payload.channelId);
      if (!result.ok) {
        return { ok: false, reason: "remote websocket not connected" };
      }
      if (!result.found) {
        return { ok: true, found: false };
      }

      const channel = asObject(result.channel) ?? {};
      const health = asObject(result.health) ?? {};
      return {
        ok: true,
        found: true,
        channel: {
          id: String(channel.id ?? payload.channelId),
          type: String(channel.type ?? "unknown"),
          isActive: channel.isActive === true,
          createdAt: typeof channel.createdAt === "number" ? channel.createdAt : Date.now(),
        },
        health: {
          recentJobCount: typeof health.recentJobCount === "number" ? health.recentJobCount : 0,
          completed: typeof health.completed === "number" ? health.completed : 0,
          failed: typeof health.failed === "number" ? health.failed : 0,
          queued: typeof health.queued === "number" ? health.queued : 0,
          lastActivity: typeof health.lastActivity === "number" ? health.lastActivity : null,
          lastError: typeof health.lastError === "string" ? health.lastError : null,
        },
      };
    },
    pipelineUpsertHookRoute: async (payload: HookRouteUpsertPayload): Promise<HookRouteUpsertResult> => {
      return await ifCloudConnected(
        async () => await gateway.upsertHookRouteInCloud(payload),
        { ok: false, reason: webDisconnectedReason },
      );
    },
    pipelineDeleteHookRoute: async (payload: { name: string }): Promise<HookRouteDeleteResult> => {
      return await ifCloudConnected(
        async () => await gateway.deleteHookRouteFromCloud(payload.name),
        { ok: false, reason: webDisconnectedReason, deleted: false },
      );
    },
    pipelineListHookEvents: async (payload?: { limit?: number }): Promise<HookEventListResult> => {
      return await ifCloudConnected(
        async () => await gateway.listHookEventsFromCloud(payload?.limit ?? 50),
        { ok: false, reason: webDisconnectedReason, events: [] },
      );
    },
    pipelineUpsertHookAgent: async (payload: HookAgentUpsertPayload): Promise<HookAgentUpsertResult> => {
      return await ifCloudConnected(
        async () => await gateway.upsertHookAgentInCloud(payload),
        { ok: false, reason: webDisconnectedReason },
      );
    },
    pipelineDeleteHookAgent: async (payload: { agentId: string }): Promise<HookAgentDeleteResult> => {
      return await ifCloudConnected(
        async () => await gateway.deleteHookAgentFromCloud(payload.agentId),
        { ok: false, reason: webDisconnectedReason, deleted: false },
      );
    },
    pipelineListMailboxes: async () => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.account.list", {}, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineConnectMailbox: async (payload: {
      action: "start" | "complete" | "disconnect";
      provider?: string;
      mailboxId?: string;
      accountId?: string;
      sessionId?: string;
      externalAccountId?: string;
      tokenRef?: string;
      scopes?: string[];
      redirectUri?: string;
    }) => {
      if (payload.action === "start") {
        return await ifCloudConnected(
          async () => await gateway.callCloudMethod("mail.account.connect.start", {
            provider: payload.provider,
            mailboxId: payload.mailboxId,
            redirectUri: payload.redirectUri,
          }, 12_000),
          { ok: false, reason: webDisconnectedReason, payload: null },
        );
      }
      if (payload.action === "complete") {
        return await ifCloudConnected(
          async () => await gateway.callCloudMethod("mail.account.connect.complete", {
            provider: payload.provider,
            mailboxId: payload.mailboxId,
            sessionId: payload.sessionId,
            externalAccountId: payload.externalAccountId,
            tokenRef: payload.tokenRef,
            scopes: payload.scopes,
          }, 12_000),
          { ok: false, reason: webDisconnectedReason, payload: null },
        );
      }
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.account.disconnect", {
          accountId: payload.accountId,
        }, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineProvisionCapzeroMailbox: async (payload: {
      mailboxId?: string;
      displayName?: string;
      primaryAddress?: string;
      domain?: string;
    }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.account.provision.capzero", payload ?? {}, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineListMailThreads: async (payload?: {
      mailboxId?: string;
      limit?: number;
      beforeTs?: number;
    }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.inbox.list", payload ?? {}, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineGetMailThread: async (payload: { threadId: string; limit?: number }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.thread.get", payload, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineCreateMailAlias: async (payload: {
      mailboxId: string;
      address?: string;
      label?: string;
      purpose?: string;
      routingPolicy?: Record<string, unknown>;
      spamScore?: number;
    }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.alias.create", payload, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineBurnMailAlias: async (payload: { aliasId: string; restore?: boolean }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod(
          payload.restore ? "mail.alias.restore" : "mail.alias.burn",
          { aliasId: payload.aliasId },
          12_000,
        ),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineUploadMailAttachment: async (payload: {
      action: "init" | "complete" | "downloadUrl";
      mailboxId?: string;
      messageId?: string;
      fileName?: string;
      contentType?: string;
      sizeBytes?: number;
      sha256?: string;
      attachmentId?: string;
      scanStatus?: string;
    }) => {
      if (payload.action === "init") {
        return await ifCloudConnected(
          async () => await gateway.callCloudMethod("mail.attachment.upload.init", payload, 12_000),
          { ok: false, reason: webDisconnectedReason, payload: null },
        );
      }
      if (payload.action === "complete") {
        return await ifCloudConnected(
          async () => await gateway.callCloudMethod("mail.attachment.upload.complete", payload, 12_000),
          { ok: false, reason: webDisconnectedReason, payload: null },
        );
      }
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.attachment.download.url", payload, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineSendMailDraft: async (payload: { draftId: string; provider?: string; idempotencyKey?: string }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.send", payload, 20_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    pipelineGetMailHealth: async (payload?: { mailboxId?: string }) => {
      return await ifCloudConnected(
        async () => await gateway.callCloudMethod("mail.health.snapshot", payload ?? {}, 12_000),
        { ok: false, reason: webDisconnectedReason, payload: null },
      );
    },
    devOrchestratorList: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorStart: async () => ({
      ok: false,
      supported: false,
      action: "start" as const,
      scope: { type: "all" as const },
      services: ["cloud", "app"] as Array<"cloud" | "app">,
      affected: [] as string[],
      skipped: [] as Array<{ name: string; reason: string }>,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorStop: async () => ({
      ok: false,
      supported: false,
      action: "stop" as const,
      scope: { type: "all" as const },
      services: ["cloud", "app"] as Array<"cloud" | "app">,
      affected: [] as string[],
      skipped: [] as Array<{ name: string; reason: string }>,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorRestart: async () => ({
      ok: false,
      supported: false,
      action: "restart" as const,
      scope: { type: "all" as const },
      services: ["cloud", "app"] as Array<"cloud" | "app">,
      affected: [] as string[],
      skipped: [] as Array<{ name: string; reason: string }>,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorDelete: async () => ({
      ok: false,
      supported: false,
      action: "delete" as const,
      scope: { type: "all" as const },
      services: ["cloud", "app"] as Array<"cloud" | "app">,
      affected: [] as string[],
      skipped: [] as Array<{ name: string; reason: string }>,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorLogs: async (payload: { processName: string; lines?: number }) => ({
      ok: false,
      supported: false,
      processName: payload.processName,
      lines: payload.lines ?? 200,
      stdout: [] as string[],
      stderr: [] as string[],
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorLiveLogs: async (payload: {
      processName: string;
      fromNow?: boolean;
      maxBytes?: number;
      cursor?: { stdoutOffset: number; stderrOffset: number };
    }) => ({
      ok: false,
      supported: false,
      processName: payload.processName,
      stdout: [] as string[],
      stderr: [] as string[],
      cursor: payload.cursor ?? { stdoutOffset: 0, stderrOffset: 0 },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorWranglerLogs: async (payload?: { cloudPort?: number; lines?: number }) => ({
      ok: false,
      supported: false,
      sourcePath: null as string | null,
      lines: payload?.lines ?? 200,
      entries: [] as string[],
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorHealth: async () => ({
      ok: false,
      supported: false,
      pm2Connected: false,
      hasLocalConfig: false,
      hasExampleConfig: false,
      hasGeneratedEcosystem: false,
      configPath: "",
      ecosystemPath: "",
      worktreeCount: 0,
      enabledCount: 0,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorRescan: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorSetWorktreeEnabled: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorSetWorktreeProfile: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorSetWorktreeLabel: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorCleanupStale: async () => ({
      ok: false,
      supported: false,
      updatedAtMs: Date.now(),
      configPath: "",
      ecosystemPath: "",
      discoveredWorktrees: [] as Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: "override" | "rule" | "default" | "invalid";
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      }>,
      processes: [] as Array<{
        name: string;
        worktreeKey: string;
        kind: "cloud" | "app";
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>,
      profiles: [] as string[],
      portPolicy: {
        cloudRange: { start: 0, end: 0 },
        appRange: { start: 0, end: 0 },
        stable: true,
      },
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorStartCurrentWorktreeCloud: async () => ({
      ok: false,
      supported: false,
      action: "start" as const,
      scope: { type: "all" as const },
      services: ["cloud"] as Array<"cloud" | "app">,
      affected: [] as string[],
      skipped: [] as Array<{ name: string; reason: string }>,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorStatusCurrentWorktree: async () => ({
      ok: false,
      supported: false,
      worktreeKey: null,
      appOwnership: "none" as const,
      cloudOwnership: "none" as const,
      row: null,
      reason: "Dev orchestrator controls are available only in the desktop app.",
    }),
    devOrchestratorCloudHealthProbe: async () => ({
      ok: false,
      status: null,
      body: null,
      error: "Health probe is available only in the desktop app.",
    }),

    checkForUpdate: async () => ({ available: false, version: null }),
    installUpdate: async () => undefined,
    onUpdateAvailable: () => () => undefined,
    onUpdateDownloaded: () => () => undefined,

    sttGetStatus: async () => ({
      state: "idle",
      modelDownloaded: false,
      detail: "Speech-to-text is desktop-only.",
    }),
    sttEnsureReady: async () => ({ ready: false, error: "Speech-to-text is desktop-only." }),
    sttStartListening: async () => ({ sessionId: "" }),
    sttStopListening: async () => ({ finalTranscript: "" }),
    sttCancelListening: async () => undefined,
    sttSendAudio: (payload: { sessionId: string; pcm: ArrayBuffer }) => {
      void payload;
      return undefined;
    },
    onSttStatus: () => () => undefined,
    onSttDownloadProgress: () => () => undefined,
    onSttTranscript: () => () => undefined,
  };

  // Start from env-configured websocket endpoint for web.
  void gateway.setWsUrl(WS_URL_ENV);
  return appShell;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}
