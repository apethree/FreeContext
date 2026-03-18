import os from 'node:os';
import path from 'node:path';
import { createPrivateKey, generateKeyPairSync, sign as nodeSign, randomUUID } from 'node:crypto';
import NodeWebSocket from 'ws';
import type { MainObsEvent } from '@/main/observability';
import type {
  GatewayAbortChatRequest,
  GatewayAbortChatResponse,
  GatewayActivitySnapshot,
  GatewayChatHistoryRequest,
  GatewayChatHistoryResponse,
  GatewayConnectionMode,
  GatewayNodeListResponse,
  GatewayPushEvent,
  GatewayRemoteSettings,
  GatewayResponsePayload,
  GatewaySendChatRequest,
  GatewaySendChatResponse,
  GatewayStateSnapshot,
} from '@/gateway/demoTypes';
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
} from '@/gateway/tokenSyncTypes';
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
} from '@/gateway/hookOpsTypes';

type ChatEntry = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  seq?: number;
};

type ActiveRun = {
  sessionKey: string;
  timer: ReturnType<typeof setTimeout>;
};

type LocalAssistantParams = {
  provider: string;
  model: string;
  prompt: string;
  thinking?: string;
};

type GatewayServiceDeps = {
  appVersion: string;
  onState: (snapshot: GatewayStateSnapshot) => void;
  onEvent: (event: GatewayPushEvent) => void;
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
  startLocalRuntime: () => Promise<boolean>;
  stopLocalRuntime: () => Promise<boolean>;
  isLocalRuntimeRunning: () => boolean;
  generateLocalAssistant?: (params: LocalAssistantParams) => Promise<{ text: string }>;
  /** Return the local openclaw gateway auth credentials from the active profile's config. */
  getLocalGatewayAuth?: () => { mode: 'token'; token: string } | { mode: 'password'; password: string } | null;
  /** Return the gateway's own device identity (keypair + id) from the profile's state dir. */
  getLocalDeviceIdentity?: () => { deviceId: string; privateKeyPem: string; publicKeyBase64url: string } | null;
  /** Return the stored device auth token from a previous successful connect. */
  getLocalDeviceAuthToken?: () => { token: string; role: string; scopes: string[] } | null;
  /** Persist the device auth token returned by the gateway after connect. */
  storeLocalDeviceAuthToken?: (deviceId: string, role: string, token: string, scopes: string[]) => void;
  observe?: (event: MainObsEvent) => void;
  /** Called once after the WS challenge handshake succeeds and the socket is authenticated. */
  onAuthenticated?: () => void;
  /** Refresh the Clerk JWT token for cloud reconnection. */
  refreshClerkToken?: () => Promise<string | null>;
};

type RequestResolver = {
  resolve: (frame: GatewayResponsePayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const GATEWAY_PROTOCOL_VERSION = 3;
const REMOTE_SETTINGS_KEY = 'gateway.remoteSettings';
const ONESHOT_LOCAL_GATEWAY_PORT = 18890;

const DEFAULT_REMOTE_SETTINGS: GatewayRemoteSettings = {
  transport: 'ssh',
  sshTarget: '',
  sshPort: 22,
  identityFile: '',
  remoteGatewayPort: 18789,
  remoteUrl: '',
  token: '',
  password: '',
};

function now() {
  return Date.now();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toConnectionMode(settings: GatewayRemoteSettings): GatewayConnectionMode {
  return settings.transport === 'direct' ? 'remote-direct' : 'remote-ssh';
}

function isGatewayWsReady(state: GatewayStateSnapshot, wsAuthenticated: boolean): boolean {
  return state.connectionStatus === 'connected' && wsAuthenticated;
}

function safeRemoteSettings(raw: unknown): GatewayRemoteSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_REMOTE_SETTINGS };
  }
  const next = raw as Record<string, unknown>;
  return {
    transport: next.transport === 'direct' ? 'direct' : 'ssh',
    sshTarget: typeof next.sshTarget === 'string' ? next.sshTarget : '',
    sshPort: typeof next.sshPort === 'number' ? next.sshPort : 22,
    identityFile: typeof next.identityFile === 'string' ? next.identityFile : '',
    remoteGatewayPort: typeof next.remoteGatewayPort === 'number' ? next.remoteGatewayPort : 18789,
    remoteUrl: typeof next.remoteUrl === 'string' ? next.remoteUrl : '',
    token: typeof next.token === 'string' ? next.token : '',
    password: typeof next.password === 'string' ? next.password : '',
  };
}

function resolveWsUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    throw new Error('remoteUrl is required for direct Cloudflare gateway mode');
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  } else if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Unsupported remoteUrl protocol: ${parsed.protocol}`);
  }

  if (parsed.pathname === '/' || parsed.pathname === '') {
    parsed.pathname = '/ws';
  }

  return parsed.toString();
}

export class PipelineGatewayService {
  private readonly deps: GatewayServiceDeps;

  private state: GatewayStateSnapshot;

  private remoteSettings: GatewayRemoteSettings;

  private readonly sessions = new Map<string, ChatEntry[]>();

  private readonly activeRuns = new Map<string, ActiveRun>();

  private ws: WebSocket | null = null;

  private wsUrl: string | null = null;

  private wsAuthenticated = false;

  private wsConnectRequestId: string | null = null;

  private readonly _deviceKey = generateKeyPairSync('ed25519');

  private readonly _devicePublicKey: string = (
    (this._deviceKey.publicKey.export({ type: 'spki', format: 'der' }) as Buffer)
      .slice(-32)
      .toString('base64url')
  );

  private readonly _deviceId = `oneshot-${process.platform}-${this._devicePublicKey.slice(0, 16)}`;

  private readonly pending = new Map<string, RequestResolver>();

  private authWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  private cloudToken: string | null = null;

  private cloudReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private cloudReconnectAttempt = 0;

  private cloudAutoReconnect = false;

  private cloudWsDomain: string | null = null;

  /** Resolves when the current cloud connect attempt finishes (success or failure). */
  private cloudConnectPromise: Promise<boolean> | null = null;

  constructor(deps: GatewayServiceDeps) {
    this.deps = deps;
    this.remoteSettings = safeRemoteSettings(this.deps.getSetting(REMOTE_SETTINGS_KEY));
    this.state = this.buildInitialState();
  }

  private observe(event: MainObsEvent) {
    this.deps.observe?.(event);
  }

  private buildInitialState(): GatewayStateSnapshot {
    return {
      processStatus: 'stopped',
      processDetail: 'OpenClaw local runtime is not started.',
      connectionStatus: 'disconnected',
      connectionDetail: 'Disconnected.',
      connectionMode: 'local',
      connectionScope: 'local-openclaw',
      cloudTarget: 'none',
      tunnelStatus: 'stopped',
      tunnelDetail: 'No tunnel.',
      lastCloudConnectAttemptAtMs: null,
      lastCloudConnectError: null,
      config: {
        configPath: path.join(os.homedir(), '.openclaw', 'openclaw.json'),
        stateDir: path.join(os.homedir(), '.openclaw'),
        port: ONESHOT_LOCAL_GATEWAY_PORT,
        wsUrl: `ws://127.0.0.1:${ONESHOT_LOCAL_GATEWAY_PORT}/ws`,
        hasToken: false,
        hasPassword: false,
        parseError: null,
      },
      health: {
        ok: null,
        summary: 'Not connected.',
        checkedAtMs: null,
      },
      activity: null,
      lastUpdatedAtMs: now(),
    };
  }

  private inferCloudTarget(wsDomain: string): GatewayStateSnapshot['cloudTarget'] {
    const normalized = wsDomain.trim().toLowerCase();
    if (!normalized) return 'none';
    if (normalized.includes('ws.capzero.ai') || normalized.includes('ws.capzero.com') || normalized.startsWith('wss://')) {
      return 'prod';
    }
    return 'dev-local';
  }

  private emitState() {
    this.state = { ...this.state, lastUpdatedAtMs: now() };
    this.deps.onState(this.state);
  }

  private setActivity(activity: GatewayActivitySnapshot | null) {
    this.state = { ...this.state, activity };
    this.emitState();
  }

  private ensureSessionCache(sessionKey: string) {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, []);
    }
  }

  /** Extract plain text from a chat event message (handles content-block arrays and plain strings). */
  private extractChatEventText(message: unknown): string {
    if (!message || typeof message !== 'object') return '';
    const msg = message as Record<string, unknown>;
    // Plain text field (legacy)
    if (typeof msg.text === 'string') return msg.text;
    // Content blocks: [{type:"text", text:"..."}]
    if (Array.isArray(msg.content)) {
      return (msg.content as unknown[])
        .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n');
    }
    if (typeof msg.content === 'string') return msg.content;
    return '';
  }

  private appendMessage(sessionKey: string, role: 'user' | 'assistant', text: string, seq?: number) {
    const list = this.sessions.get(sessionKey) ?? [];
    list.push({
      id: randomUUID(),
      role,
      text,
      timestamp: now(),
      ...(typeof seq === 'number' ? { seq } : {}),
    });
    this.sessions.set(sessionKey, list);
  }

  private emitChatEvent(
    sessionKey: string,
    runId: string,
    state: string,
    text: string,
    role: 'user' | 'assistant' = 'assistant',
    meta?: {
      seq?: number;
      messageId?: string;
      createdAt?: number;
    },
  ) {
    this.deps.onEvent({
      type: 'chat',
      event: 'chat',
      payload: {
        sessionKey,
        runId,
        state,
        ...(typeof meta?.seq === 'number' ? { seq: meta.seq } : {}),
        ...(typeof meta?.messageId === 'string' && meta.messageId.length > 0 ? { messageId: meta.messageId } : {}),
        ...(typeof meta?.createdAt === 'number' ? { createdAt: meta.createdAt } : {}),
        message: {
          role,
          text,
        },
      },
      ts: now(),
    });
  }

  private clearPending(error: Error) {
    for (const resolver of this.pending.values()) {
      clearTimeout(resolver.timeout);
      resolver.reject(error);
    }
    this.pending.clear();
  }

  private resolveAuthWaiters() {
    if (this.authWaiters.length === 0) return;
    const waiters = this.authWaiters;
    this.authWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private rejectAuthWaiters(error: Error) {
    if (this.authWaiters.length === 0) return;
    const waiters = this.authWaiters;
    this.authWaiters = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private waitForAuthenticated(timeoutMs: number): Promise<void> {
    if (this.wsAuthenticated) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authWaiters = this.authWaiters.filter((waiter) => waiter.resolve !== wrappedResolve);
        reject(new Error('timeout waiting for websocket authentication'));
      }, timeoutMs);

      const wrappedResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      const wrappedReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };

      this.authWaiters.push({ resolve: wrappedResolve, reject: wrappedReject });
    });
  }

  private closeWs(reason: string) {
    this.observe({
      domain: 'gateway.remote',
      action: 'ws.close',
      status: 'close',
      data: { reason },
    });
    this.wsAuthenticated = false;
    this.wsConnectRequestId = null;
    this.rejectAuthWaiters(new Error(reason));
    if (this.ws) {
      try {
        this.ws.close(1000, reason);
      } catch {
        // no-op
      }
      this.ws = null;
    }
    this.wsUrl = null;
    this.clearPending(new Error(reason));
  }

  private onWsMessage(event: MessageEvent<string>) {
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    if (!raw) {
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = asString(frame.type);
    if (type === 'event') {
      const eventName = asString(frame.event);
      const payload = asObject(frame.payload) ?? {};

      // Log all incoming events for debugging.
      if (eventName !== 'connect.challenge') {
        const logData: Record<string, unknown> = { hasPayload: Boolean(payload), payloadKeys: Object.keys(payload) };
        if (eventName === 'chat') {
          logData.state = asString(payload.state);
          logData.errorMessage = asString(payload.errorMessage);
          logData.hasMessage = Boolean(payload.message);
        }
        if (eventName === 'agent') {
          logData.stream = asString(payload.stream);
          const agentData = asObject(payload.data);
          if (agentData) logData.dataType = asString(agentData.type) || Object.keys(agentData).join(',');
        }
        this.observe({
          domain: 'gateway.remote',
          action: `event.${eventName}`,
          status: 'success',
          data: logData,
        });
      }

      if (eventName === 'connect.challenge') {
        const nonce = asString(payload.nonce);
        if (!nonce || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const connectId = `connect-${randomUUID()}`;
        this.wsConnectRequestId = connectId;

        const isLocal = this.state.connectionMode === 'local';
        const localAuth = isLocal ? this.deps.getLocalGatewayAuth?.() : null;
        const localDevice = isLocal ? this.deps.getLocalDeviceIdentity?.() : null;
        const localDeviceAuth = isLocal ? this.deps.getLocalDeviceAuthToken?.() : null;

        this.observe({
          domain: 'gateway.remote',
          action: 'connect.challenge',
          status: 'success',
          data: {
            isLocal,
            hasLocalDevice: Boolean(localDevice),
            hasDeviceToken: Boolean(localDeviceAuth),
            authMode: localAuth?.mode ?? 'none',
            remoteDeviceId: isLocal ? undefined : this._deviceId,
          },
        });

        // Build connect params matching the openclaw v2 device auth protocol.
        // The signed payload format is: "v2|deviceId|clientId|mode|role|scopes|signedAtMs|token|nonce"
        const role = 'operator';
        const scopes = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

        const connectParams: Record<string, unknown> = {
          minProtocol: GATEWAY_PROTOCOL_VERSION,
          maxProtocol: GATEWAY_PROTOCOL_VERSION,
          caps: [],
          role,
          scopes,
        };

        if (isLocal && localDevice) {
          const clientId = 'openclaw-control-ui';
          const clientMode = 'ui';
          connectParams.client = {
            id: clientId,
            version: this.deps.appVersion,
            platform: process.platform,
            mode: clientMode,
          };

          // Prefer stored device token over config token.
          const authToken = localDeviceAuth?.token
            ?? (localAuth?.mode === 'token' ? localAuth.token : undefined);
          if (authToken) {
            connectParams.auth = { token: authToken };
          } else if (localAuth?.mode === 'password') {
            connectParams.auth = { password: localAuth.password };
          }

          // Sign the v2 device auth payload.
          const signedAt = now();
          const scopesStr = scopes.join(',');
          const v2Payload = [
            'v2',
            localDevice.deviceId,
            clientId,
            clientMode,
            role,
            scopesStr,
            String(signedAt),
            authToken ?? '',
            nonce,
          ].join('|');
          const privKey = createPrivateKey(localDevice.privateKeyPem);
          const sig = nodeSign(null, Buffer.from(v2Payload), privKey).toString('base64url');
          connectParams.device = {
            id: localDevice.deviceId,
            publicKey: localDevice.publicKeyBase64url,
            signature: sig,
            signedAt,
            nonce,
          };
        } else if (isLocal) {
          // No device identity — fall back to CLI-style token auth.
          connectParams.client = {
            id: 'cli',
            version: this.deps.appVersion,
            platform: process.platform,
            mode: 'cli',
          };
          if (localAuth?.mode === 'token') {
            connectParams.auth = { token: localAuth.token };
          } else if (localAuth?.mode === 'password') {
            connectParams.auth = { password: localAuth.password };
          }
        } else {
          const clientId = 'openclaw-control-ui';
          const clientMode = 'ui';
          connectParams.client = {
            id: clientId,
            version: this.deps.appVersion,
            platform: process.platform,
            mode: clientMode,
          };
          // Remote gateway — ephemeral device keypair with v2 payload.
          const signedAt = now();
          const scopesStr = scopes.join(',');
          const v2Payload = [
            'v2',
            this._deviceId,
            clientId,
            clientMode,
            role,
            scopesStr,
            String(signedAt),
            '',
            nonce,
          ].join('|');
          const sig = nodeSign(null, Buffer.from(v2Payload), this._deviceKey.privateKey).toString('base64url');
          connectParams.device = {
            id: this._deviceId,
            publicKey: this._devicePublicKey,
            signature: sig,
            signedAt,
            nonce,
          };
        }

        this.ws.send(
          JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: connectParams,
          }),
        );
        return;
      }

      // Agent lifecycle events — surface errors from the agent run as chat errors.
      if (eventName === 'agent') {
        const stream = asString(payload.stream);
        const sessionKey = asString(payload.sessionKey).replace(/^agent:[^:]+:/, '');
        const runId = asString(payload.runId);
        const agentData = asObject(payload.data);
        if (stream === 'lifecycle' && agentData && sessionKey) {
          const phase = asString(agentData.phase);
          if (phase === 'error') {
            const errorMessage = asString(agentData.error) || asString(agentData.message) || 'agent error';
            this.emitChatEvent(sessionKey, runId || randomUUID(), 'error', errorMessage);
          }
        }
        if (stream === 'error' && sessionKey) {
          const errorText = asString(agentData?.message) || asString(agentData?.error) || 'agent stream error';
          this.emitChatEvent(sessionKey, runId || randomUUID(), 'error', errorText);
        }
      }

      // The gateway emits "chat" events with payload.state = "delta" | "final" | "aborted" | "error".
      // "delta" carries streaming text, "final" carries the complete assistant message.
      if (eventName === 'chat') {
        // The gateway prefixes sessionKey with "agent:<agentId>:" (e.g. "agent:main:chat-xxx").
        // Strip the prefix so the renderer can match against its own session ID.
        const rawSessionKey = asString(payload.sessionKey);
        const sessionKey = rawSessionKey.replace(/^agent:[^:]+:/, '');
        const state = asString(payload.state);
        const runId = asString(payload.runId);
        const eventSeq = typeof payload.seq === 'number' && Number.isFinite(payload.seq)
          ? payload.seq
          : undefined;
        const messageId = asString(payload.messageId) || undefined;
        const createdAt = typeof payload.createdAt === 'number' && Number.isFinite(payload.createdAt)
          ? payload.createdAt
          : undefined;
        if (!sessionKey) return;

        // Diagnostic: log message extraction details for chat events.
        const rawMessage = payload.message;
        const msgType = rawMessage === null ? 'null' : typeof rawMessage;
        const msgKeys = (rawMessage && typeof rawMessage === 'object') ? Object.keys(rawMessage as Record<string, unknown>) : [];
        const text = this.extractChatEventText(rawMessage);
        const roleFromPayload = (
          rawMessage &&
          typeof rawMessage === 'object' &&
          asString((rawMessage as Record<string, unknown>).role) === 'user'
        )
          ? 'user'
          : 'assistant';
        this.observe({
          domain: 'gateway.remote',
          action: 'chat.extract',
          status: text ? 'success' : 'skip',
          data: {
            state,
            sessionKey,
            msgType,
            msgKeys,
            textLength: text.length,
            textPreview: text.slice(0, 80),
          },
        });

        if (state === 'delta') {
          if (text) {
            this.emitChatEvent(sessionKey, runId || randomUUID(), 'delta', text, 'assistant', {
              seq: eventSeq,
              messageId,
              createdAt,
            });
          }
        } else if (state === 'final') {
          if (text) {
            if (roleFromPayload === 'assistant') {
              this.appendMessage(sessionKey, 'assistant', text);
            }
            this.emitChatEvent(sessionKey, runId || randomUUID(), 'final', text, roleFromPayload, {
              seq: eventSeq,
              messageId,
              createdAt,
            });
          }
        } else if (state === 'aborted') {
          if (text) {
            this.appendMessage(sessionKey, 'assistant', text);
          }
          this.emitChatEvent(sessionKey, runId || randomUUID(), 'aborted', text || 'Run aborted.', 'assistant', {
            seq: eventSeq,
            messageId,
            createdAt,
          });
        } else if (state === 'error') {
          const errorMessage = asString(payload.errorMessage) || 'chat error';
          // Emit with errorMessage at the payload root so useChatSession can read it.
          // emitChatEvent wraps text in message.text, which is not where useChatSession looks.
          this.deps.onEvent({
            type: 'chat',
            event: 'chat',
            payload: {
              sessionKey,
              runId: runId || randomUUID(),
              state: 'error',
              errorMessage,
              ...(typeof eventSeq === 'number' ? { seq: eventSeq } : {}),
              ...(typeof messageId === 'string' ? { messageId } : {}),
              ...(typeof createdAt === 'number' ? { createdAt } : {}),
            },
            ts: now(),
          });
        }
      }
      return;
    }

    if (type !== 'res') {
      return;
    }

    const response = frame as unknown as GatewayResponsePayload;
    const responseId = asString(response.id);

    if (this.wsConnectRequestId && responseId === this.wsConnectRequestId) {
      if (response.ok) {
        this.wsAuthenticated = true;
        this.resolveAuthWaiters();

        // Store the device token returned by the gateway for future connects.
        const helloPayload = asObject(response.payload) ?? {};
        const helloAuth = asObject(helloPayload.auth);
        if (helloAuth) {
          const deviceToken = asString(helloAuth.deviceToken);
          const helloRole = asString(helloAuth.role) || 'operator';
          const helloScopes = Array.isArray(helloAuth.scopes)
            ? (helloAuth.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
            : [];
          const localDevice = this.deps.getLocalDeviceIdentity?.();
          if (deviceToken && localDevice) {
            this.deps.storeLocalDeviceAuthToken?.(localDevice.deviceId, helloRole, deviceToken, helloScopes);
          }
        }

        this.observe({
          domain: 'gateway.remote',
          action: 'connect.handshake',
          status: 'success',
          data: { wsUrl: this.wsUrl },
        });
        const isLocal = this.state.connectionMode === 'local';
        this.state = {
          ...this.state,
          connectionStatus: 'connected',
          connectionDetail: isLocal
            ? `Connected to local OpenClaw gateway (${this.wsUrl ?? 'local'}).`
            : `Connected to Cloudflare gateway (${this.wsUrl ?? 'remote'}).`,
          health: {
            ok: true,
            summary: isLocal ? 'Connected (local OpenClaw).' : 'Connected (remote direct).',
            checkedAtMs: now(),
          },
        };
        this.emitState();
        // Notify after state is emitted so any state listeners see connected status first.
        this.deps.onAuthenticated?.();
      } else {
        this.wsAuthenticated = false;
        const handshakeErr = response.error?.message || 'websocket authentication failed';
        const debugSuffix = ` [sent deviceId="${this._deviceId}" pubKey="${this._devicePublicKey}"]`;
        this.rejectAuthWaiters(new Error(handshakeErr + debugSuffix));
        this.observe({
          level: 'warn',
          domain: 'gateway.remote',
          action: 'connect.handshake',
          status: 'error',
          data: {
            error: handshakeErr,
            sentDeviceId: this._deviceId,
            sentPublicKey: this._devicePublicKey,
          },
        });
        this.state = {
          ...this.state,
          connectionStatus: 'disconnected',
          connectionDetail: handshakeErr + debugSuffix,
          ...(this.state.connectionScope === 'cloud'
            ? { lastCloudConnectError: handshakeErr + debugSuffix }
            : {}),
          health: {
            ok: false,
            summary: 'Remote connect failed.',
            checkedAtMs: now(),
          },
        };
        this.emitState();
      }
      this.wsConnectRequestId = null;
      return;
    }

    const resolver = this.pending.get(responseId);
    if (!resolver) {
      return;
    }

    this.pending.delete(responseId);
    clearTimeout(resolver.timeout);
    resolver.resolve(response);
  }

  private async connectRemoteDirect(settings: GatewayRemoteSettings): Promise<void> {
    const startedAt = now();
    const wsUrl = resolveWsUrl(settings.remoteUrl);
    this.wsUrl = wsUrl;
    this.observe({
      domain: 'gateway.remote',
      action: 'connect.open',
      status: 'start',
      data: { wsUrl },
    });

    const withToken = new URL(wsUrl);
    const token = settings.token.trim();
    if (token) {
      withToken.searchParams.set('token', token);
    }

    // Use ws (Node.js) instead of the browser global so we can set an explicit
    // Origin header. Electron's built-in WebSocket sends no Origin header,
    // which the openclaw binary rejects. Setting Origin to the gateway host
    // satisfies the "open from the gateway host" check without any config change.
    const wsOrigin = `${withToken.protocol === 'wss:' ? 'https' : 'http'}://${withToken.host}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new NodeWebSocket(withToken.toString(), { origin: wsOrigin }) as unknown as WebSocket;
      this.ws = ws;
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        finish(new Error('timeout waiting for remote websocket connect'));
      }, 10000);

      ws.addEventListener('open', () => {
        this.observe({
          domain: 'gateway.remote',
          action: 'connect.open',
          status: 'success',
          durationMs: now() - startedAt,
        });
        clearTimeout(timer);
        finish();
      });

      ws.addEventListener('error', () => {
        this.observe({
          level: 'warn',
          domain: 'gateway.remote',
          action: 'connect.open',
          status: 'error',
          durationMs: now() - startedAt,
        });
        clearTimeout(timer);
        finish(new Error('remote websocket connection error'));
      });

      ws.addEventListener('close', () => {
        this.wsAuthenticated = false;
        this.rejectAuthWaiters(new Error('websocket closed before authentication'));
        if (this.state.connectionMode === 'local') {
          this.state = {
            ...this.state,
            connectionStatus: 'disconnected',
            connectionDetail: 'Local OpenClaw websocket closed.',
            health: {
              ok: false,
              summary: 'Local OpenClaw websocket disconnected.',
              checkedAtMs: now(),
            },
          };
          this.emitState();
        } else {
          this.state = {
            ...this.state,
            connectionStatus: 'disconnected',
            connectionDetail: 'Cloud websocket closed.',
            ...(this.state.connectionScope === 'cloud'
              ? { lastCloudConnectError: 'Cloud websocket closed.' }
              : {}),
            health: {
              ok: false,
              summary: 'Remote websocket disconnected.',
              checkedAtMs: now(),
            },
          };
          this.emitState();
        }
        // Trigger cloud auto-reconnect if enabled
        if (this.cloudAutoReconnect) {
          this.scheduleCloudReconnect();
        }
        this.observe({
          level: 'warn',
          domain: 'gateway.remote',
          action: 'connect.socket_closed',
          status: 'close',
        });
      });

      ws.addEventListener('message', (event) => {
        this.onWsMessage(event as MessageEvent<string>);
      });
    });

    this.state = {
      ...this.state,
      connectionStatus: 'connecting',
      connectionDetail: 'Remote websocket open. Waiting for challenge handshake.',
      health: {
        ok: null,
        summary: 'Authenticating…',
        checkedAtMs: now(),
      },
    };
    this.emitState();
  }

  private async requestRemote(method: string, params?: unknown, timeoutMs = 12000): Promise<GatewayResponsePayload> {
    const startedAt = now();
    this.observe({
      domain: 'gateway.remote',
      action: `request.${method}`,
      status: 'start',
      data: { timeoutMs },
    });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.observe({
        level: 'warn',
        domain: 'gateway.remote',
        action: `request.${method}`,
        status: 'error',
        data: { reason: 'socket_not_open' },
      });
      throw new Error('remote websocket is not open');
    }
    if (!this.wsAuthenticated) {
      this.observe({
        level: 'warn',
        domain: 'gateway.remote',
        action: `request.${method}`,
        status: 'error',
        data: { reason: 'socket_not_authenticated' },
      });
      throw new Error('remote websocket is not authenticated yet');
    }

    const id = `${method}-${randomUUID()}`;
    const response = await new Promise<GatewayResponsePayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });

    if (!response.ok) {
      this.observe({
        level: 'warn',
        domain: 'gateway.remote',
        action: `request.${method}`,
        status: 'error',
        durationMs: now() - startedAt,
        data: { error: response.error?.message ?? `${method} failed` },
      });
      throw new Error(response.error?.message || `${method} failed`);
    }

    this.observe({
      domain: 'gateway.remote',
      action: `request.${method}`,
      status: 'success',
      durationMs: now() - startedAt,
    });

    return response;
  }

  private async sendRemoteChat(sessionKey: string, message: string, request: GatewaySendChatRequest) {
    const response = await this.requestRemote('chat.send', {
      sessionId: sessionKey,
      message,
      provider: request.provider || 'openai',
      model: request.model || 'gpt-4o',
      system: request.system,
      thinking: request.thinking,
      deliver: false,
      idempotencyKey: request.idempotencyKey || randomUUID(),
      attachments: request.attachments,
    }, 120_000); // Extended timeout for LLM inference

    const payload = asObject(response.payload) ?? {};
    const text = asString(payload.text) || asString(payload.content);
    if (text) {
      this.appendMessage(sessionKey, 'assistant', text);
    }
    return payload;
  }

  private queueLocalAssistant(runId: string, sessionKey: string, request: GatewaySendChatRequest) {
    this.emitChatEvent(sessionKey, runId, 'delta', 'Local OpenClaw fallback running...');
    const timer = setTimeout(() => {
      void (async () => {
        const active = this.activeRuns.get(runId);
        if (!active) return;
        try {
          if (this.deps.generateLocalAssistant) {
            const provider = request.provider?.trim() || 'openai';
            const model = request.model?.trim() || 'o3';
            const generated = await this.deps.generateLocalAssistant({
              provider,
              model,
              prompt: request.message,
              thinking: request.thinking,
            });
            const text = generated.text.trim();
            const responseText = text || `Local fallback response: ${request.message}`;
            this.appendMessage(sessionKey, 'assistant', responseText);
            this.emitChatEvent(sessionKey, runId, 'final', responseText);
          } else {
            const responseText = `Local fallback response: ${request.message}`;
            this.appendMessage(sessionKey, 'assistant', responseText);
            this.emitChatEvent(sessionKey, runId, 'final', responseText);
          }
        } catch (error) {
          const responseText = `Local fallback error: ${String(error)}`;
          this.appendMessage(sessionKey, 'assistant', responseText);
          this.emitChatEvent(sessionKey, runId, 'final', responseText);
        } finally {
          this.activeRuns.delete(runId);
          this.setActivity(null);
        }
      })();
    }, 50);

    this.activeRuns.set(runId, { sessionKey, timer });
  }

  isAuthenticated(): boolean {
    return this.wsAuthenticated;
  }

  async getState() {
    return this.state;
  }

  async enableOpenclaw() {
    const started = await this.deps.startLocalRuntime();
    this.state = {
      ...this.state,
      processStatus: started ? 'running-child' : 'failed',
      processDetail: started ? 'Local OpenClaw fallback enabled.' : 'Failed to start local OpenClaw runtime.',
      health: {
        ok: started
          ? (this.state.connectionStatus === 'connected' ? true : null)
          : false,
        summary: started
          ? (this.state.connectionStatus === 'connected' ? this.state.health.summary : 'Local fallback ready.')
          : 'Local runtime start failed.',
        checkedAtMs: now(),
      },
    };
    this.emitState();
    return this.state;
  }

  async disableOpenclaw() {
    await this.deps.stopLocalRuntime();
    this.state = {
      ...this.state,
      processStatus: 'stopped',
      processDetail: 'Local fallback disabled.',
    };
    this.emitState();
    return this.state;
  }

  async connect() {
    this.closeWs('switching to local mode');
    const running = this.deps.isLocalRuntimeRunning() || await this.deps.startLocalRuntime();
    if (!running) {
      this.state = {
        ...this.state,
        connectionMode: 'local',
        connectionScope: 'local-openclaw',
        cloudTarget: 'none',
        connectionStatus: 'disconnected',
        connectionDetail: 'Local OpenClaw runtime is not running.',
        tunnelStatus: 'stopped',
        tunnelDetail: 'No tunnel required.',
        health: {
          ok: false,
          summary: 'Local runtime unavailable.',
          checkedAtMs: now(),
        },
      };
      this.emitState();
      return this.state;
    }
    this.state = {
      ...this.state,
      connectionMode: 'local',
      connectionScope: 'local-openclaw',
      cloudTarget: 'none',
      connectionStatus: 'connecting',
      connectionDetail: 'Connecting to local OpenClaw gateway...',
      tunnelStatus: 'stopped',
      tunnelDetail: 'No tunnel required.',
      health: {
        ok: null,
        summary: 'Connecting...',
        checkedAtMs: now(),
      },
    };
    this.emitState();
    try {
      await this.connectRemoteDirect({
        ...this.remoteSettings,
        transport: 'direct',
        remoteUrl: `ws://127.0.0.1:${ONESHOT_LOCAL_GATEWAY_PORT}/ws`,
        token: '',
      });
      await this.waitForAuthenticated(8_000);
    } catch (error) {
      this.closeWs('local connect failure');
      this.state = {
        ...this.state,
        connectionMode: 'local',
        connectionScope: 'local-openclaw',
        cloudTarget: 'none',
        connectionStatus: 'disconnected',
        connectionDetail: `Local connect failed: ${String(error)}`,
        health: {
          ok: false,
          summary: 'Local OpenClaw connection failed.',
          checkedAtMs: now(),
        },
      };
      this.emitState();
    }
    return this.state;
  }

  async disconnect() {
    this.closeWs('manual disconnect');
    this.state = {
      ...this.state,
      connectionStatus: 'disconnected',
      connectionDetail: 'Disconnected.',
      tunnelStatus: 'stopped',
      tunnelDetail: 'No tunnel.',
      health: {
        ok: null,
        summary: 'Not connected.',
        checkedAtMs: now(),
      },
      activity: null,
    };
    this.emitState();
    return this.state;
  }

  async connectRemote(settings: GatewayRemoteSettings) {
    this.observe({
      domain: 'gateway.remote',
      action: 'connect.mode_selected',
      status: 'start',
      data: { transport: settings.transport },
    });
    this.remoteSettings = { ...settings };
    this.deps.setSetting(REMOTE_SETTINGS_KEY, this.remoteSettings);

    this.state = {
      ...this.state,
      connectionMode: toConnectionMode(this.remoteSettings),
      connectionScope: 'cloud',
      cloudTarget: this.remoteSettings.transport === 'direct'
        ? this.inferCloudTarget(this.remoteSettings.remoteUrl)
        : this.state.cloudTarget,
      lastCloudConnectAttemptAtMs: now(),
      lastCloudConnectError: null,
      connectionStatus: 'connecting',
      connectionDetail:
        this.remoteSettings.transport === 'direct'
          ? 'Connecting to Cloudflare gateway...'
          : 'SSH transport selected. Runtime bridge not yet implemented in fresh pipeline.',
      tunnelStatus: this.remoteSettings.transport === 'ssh' ? 'starting' : 'stopped',
      tunnelDetail:
        this.remoteSettings.transport === 'ssh'
          ? 'Preparing SSH tunnel...'
          : 'Direct websocket mode.',
      health: {
        ok: null,
        summary: 'Connecting...',
        checkedAtMs: now(),
      },
    };
    this.emitState();

    if (this.remoteSettings.transport === 'direct') {
      try {
        await this.connectRemoteDirect(this.remoteSettings);
      } catch (error) {
        this.observe({
          level: 'warn',
          domain: 'gateway.remote',
          action: 'connect.remote_direct',
          status: 'error',
          data: { error: String(error) },
        });
        this.closeWs('remote direct connect failure');
        this.state = {
          ...this.state,
          connectionStatus: 'disconnected',
          connectionDetail: `Remote connect failed: ${String(error)}`,
          lastCloudConnectError: `Remote connect failed: ${String(error)}`,
          tunnelStatus: 'stopped',
          tunnelDetail: 'No tunnel.',
          health: {
            ok: false,
            summary: 'Remote connection failed.',
            checkedAtMs: now(),
          },
        };
        this.emitState();
      }
      return this.state;
    }

    this.state = {
      ...this.state,
      connectionStatus: 'disconnected',
      connectionDetail: 'SSH transport pending implementation. Use direct mode for Cloudflare WS.',
      lastCloudConnectError: 'SSH transport pending implementation. Use direct mode for Cloudflare WS.',
      tunnelStatus: 'failed',
      tunnelDetail: 'SSH bridge not implemented in fresh pipeline yet.',
      health: {
        ok: false,
        summary: 'SSH mode unavailable in fresh pipeline.',
        checkedAtMs: now(),
      },
    };
    this.emitState();
    this.observe({
      level: 'warn',
      domain: 'gateway.remote',
      action: 'connect.remote_ssh',
      status: 'skip',
      data: { reason: 'not_implemented' },
    });
    return this.state;
  }

  getRemoteSettings() {
    return { ...this.remoteSettings };
  }

  async getDevices(): Promise<GatewayNodeListResponse> {
    return {
      ts: now(),
      nodes: [
        {
          nodeId: 'oneshot-local-node',
          displayName: 'One Shot Local Node',
          platform: process.platform,
          version: this.deps.appVersion,
          paired: true,
          connected: this.state.connectionStatus === 'connected' || this.state.connectionStatus === 'degraded',
          deviceFamily: 'desktop',
          modelIdentifier: this.state.connectionMode === 'local' ? 'local-openclaw' : 'cloudflare-gateway',
        },
      ],
    };
  }

  async getChatHistory(request: GatewayChatHistoryRequest): Promise<GatewayChatHistoryResponse> {
    if (isGatewayWsReady(this.state, this.wsAuthenticated)) {
      const response = await this.requestRemote('chat.history', {
        sessionId: request.sessionKey,
        limit: request.limit ?? 200,
      });
      const payload = asObject(response.payload) ?? {};
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const normalized: ChatEntry[] = messages
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
          id: asString(entry.id) || randomUUID(),
          role: asString(entry.role) === 'assistant' ? 'assistant' : 'user',
          text: asString(entry.content),
          timestamp: typeof entry.createdAt === 'number' ? entry.createdAt : now(),
          ...(typeof entry.seq === 'number' ? { seq: entry.seq } : {}),
        }));
      this.sessions.set(request.sessionKey, normalized);
    }

    const messages = (this.sessions.get(request.sessionKey) ?? []).slice(-(request.limit ?? 80));
    return {
      sessionKey: request.sessionKey,
      messages: messages.map((entry) => ({
        id: entry.id,
        role: entry.role,
        text: entry.text,
        timestamp: entry.timestamp,
        ...(typeof entry.seq === 'number' ? { seq: entry.seq } : {}),
      })),
    };
  }

  async sendChat(request: GatewaySendChatRequest): Promise<GatewaySendChatResponse> {
    this.observe({
      domain: 'chat.pipeline',
      action: 'send',
      status: 'start',
      data: {
        sessionKey: request.sessionKey,
        mode: this.state.connectionMode,
        remoteConnected: this.wsAuthenticated,
        localRuntimeRunning: this.deps.isLocalRuntimeRunning(),
      },
    });
    const runId = `run-${randomUUID()}`;
    const sessionKey = request.sessionKey;

    this.ensureSessionCache(sessionKey);
    this.appendMessage(sessionKey, 'user', request.message);
    this.setActivity({
      kind: 'job',
      sessionKey,
      label: `Running ${runId}`,
      updatedAtMs: now(),
    });

    // Local-first: if local runtime is available and we have a local assistant, use local inference
    if (this.deps.isLocalRuntimeRunning() && this.deps.generateLocalAssistant && this.state.connectionMode === 'local') {
      try {
        const provider = request.provider?.trim() || 'openai';
        const model = request.model?.trim() || 'o3';
        const generated = await this.deps.generateLocalAssistant({
          provider,
          model,
          prompt: request.message,
          thinking: request.thinking,
        });
        const text = generated.text.trim() || `Local response: ${request.message}`;
        this.appendMessage(sessionKey, 'assistant', text);
        this.emitChatEvent(sessionKey, runId, 'final', text);

        // Sync to cloud for persistence (non-blocking, only when WS is actually ready)
        if (isGatewayWsReady(this.state, this.wsAuthenticated)) {
          void this.requestRemote('chat.append', { sessionId: sessionKey, role: 'user', content: request.message }).catch((err) => {
            this.observe({ level: 'warn', domain: 'chat.cloud-sync', action: 'append-user', status: 'error', data: { sessionKey, error: String(err) } });
          });
          void this.requestRemote('chat.append', { sessionId: sessionKey, role: 'assistant', content: text }).catch((err) => {
            this.observe({ level: 'warn', domain: 'chat.cloud-sync', action: 'append-assistant', status: 'error', data: { sessionKey, error: String(err) } });
          });
        } else {
          this.observe({ level: 'warn', domain: 'chat.cloud-sync', action: 'skip', status: 'skip', data: { sessionKey, reason: 'ws-not-ready' } });
        }

        this.observe({
          domain: 'chat.pipeline',
          action: 'send',
          status: 'success',
          data: { runId, status: 'completed-local' },
        });
        return { runId, status: 'completed-local' };
      } catch (error) {
        this.observe({
          level: 'warn',
          domain: 'chat.pipeline',
          action: 'send.local',
          status: 'error',
          data: { error: String(error) },
        });
        // Fall through to cloud or queued local
      } finally {
        this.setActivity(null);
      }
    }

    // Cloud path: send to cloud chat.send (handles both cloud-connected modes)
    if (isGatewayWsReady(this.state, this.wsAuthenticated)) {
      try {
        await this.sendRemoteChat(sessionKey, request.message, request);
      } finally {
        this.setActivity(null);
      }
      const status = this.state.connectionMode === 'local' ? 'submitted-local-ws' : 'submitted-cloud';
      this.observe({
        domain: 'chat.pipeline',
        action: 'send',
        status: 'success',
        data: { runId, status },
      });
      return { runId, status };
    }

    // Last resort: queue local without cloud
    this.queueLocalAssistant(runId, sessionKey, request);
    this.observe({
      domain: 'chat.pipeline',
      action: 'send',
      status: 'success',
      data: { runId, status: 'queued-local' },
    });
    return {
      runId,
      status: 'queued-local',
    };
  }

  async abortChat(request: GatewayAbortChatRequest): Promise<GatewayAbortChatResponse> {
    const runId = request.runId;
    if (!runId) {
      return { ok: true, aborted: false };
    }

    const active = this.activeRuns.get(runId);
    if (!active) {
      return { ok: true, aborted: false };
    }

    clearTimeout(active.timer);
    this.activeRuns.delete(runId);
    this.emitChatEvent(active.sessionKey, runId, 'aborted', 'Run aborted.');
    this.setActivity(null);
    return { ok: true, aborted: true };
  }

  async syncTokenToCloud(payload: GatewayTokenSyncPayload): Promise<GatewayTokenSyncPushResult> {
    const providerNormalized = payload.provider.trim().toLowerCase();
    const tokenTrimmed = payload.token.trim();
    const opId = payload.opId?.trim() || createTokenSyncOpId('push');
    const source = payload.source?.trim() || 'pipeline-service';
    if (!providerNormalized || !tokenTrimmed || (payload.tokenKind !== 'oauth' && payload.tokenKind !== 'api-key')) {
      this.observe({ level: 'warn', domain: 'token.sync', action: 'push.validation', status: 'error', data: { provider: providerNormalized, reason: 'provider/token/tokenKind required' } });
      return { pushed: false, reason: 'provider/token/tokenKind required', opId };
    }
    if (
      this.state.connectionMode === 'local'
      || this.state.connectionStatus !== 'connected'
      || !this.wsAuthenticated
    ) {
      this.observe({ level: 'warn', domain: 'token.sync', action: 'push.connection', status: 'error', data: { provider: providerNormalized, reason: 'remote websocket not connected', connectionMode: this.state.connectionMode, connectionStatus: this.state.connectionStatus } });
      return { pushed: false, reason: 'remote websocket not connected', opId };
    }

    this.observe({ level: 'info', domain: 'token.sync', action: 'push.start', status: 'start', data: { opId, source, provider: providerNormalized, tokenKind: payload.tokenKind, oauthProviderId: payload.oauthProviderId ?? null, hasRefresh: !!payload.refreshToken } });
    try {
      const response = await this.requestRemote('token.sync.push', {
        provider: providerNormalized,
        token: tokenTrimmed,
        tokenKind: payload.tokenKind,
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.piProviderId ? { piProviderId: payload.piProviderId } : {}),
        ...(payload.oauthProviderId ? { oauthProviderId: payload.oauthProviderId } : {}),
        ...(payload.refreshToken ? { refreshToken: payload.refreshToken } : {}),
        ...(typeof payload.expiresAtMs === 'number' ? { expiresAtMs: payload.expiresAtMs } : {}),
        ...(payload.accountId ? { accountId: payload.accountId } : {}),
        ...(payload.projectId ? { projectId: payload.projectId } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
        opId,
        source,
      }, 10_000);
      const responsePayload = asObject(response.payload);
      const tokenKind: GatewayTokenKind | null = responsePayload?.tokenKind === 'oauth' || responsePayload?.tokenKind === 'api-key'
        ? responsePayload.tokenKind
        : null;
      const verified = responsePayload?.verified === true;
      const resolvedOpId = asString(responsePayload?.opId) || opId;
      const reason = !verified
        ? (asString(responsePayload?.reason) || 'push failed verification')
        : undefined;
      const fingerprint = asString(responsePayload?.fingerprint) || null;
      this.observe({
        level: verified ? 'info' : 'warn',
        domain: 'token.sync',
        action: verified ? 'push.verified' : 'push.unverified',
        status: verified ? 'success' : 'error',
        data: {
          opId: resolvedOpId,
          source,
          provider: providerNormalized,
          verified,
          hasToken: responsePayload?.hasToken === true,
          fingerprint,
          updatedAtMs: responsePayload?.updatedAtMs,
          reason: reason ?? null,
        },
      });
      return {
        pushed: true as const,
        opId: resolvedOpId,
        verified,
        hasToken: responsePayload?.hasToken === true,
        tokenKind,
        fingerprint,
        updatedAtMs: typeof responsePayload?.updatedAtMs === 'number' ? responsePayload.updatedAtMs : null,
        ...(reason ? { reason } : {}),
      };
    } catch (error) {
      this.observe({ level: 'error', domain: 'token.sync', action: 'push.failed', status: 'error', data: { opId, source, provider: providerNormalized, error: String(error) } });
      return { pushed: false as const, reason: String(error), opId };
    }
  }

  async pullTokenFromCloud(request: string | GatewayTokenSyncPullRequest): Promise<GatewayTokenSyncPullResult> {
    const providerInput = typeof request === 'string' ? request : request.provider;
    const providerNormalized = providerInput.trim().toLowerCase();
    const opId = typeof request === 'string'
      ? createTokenSyncOpId('pull')
      : (request.opId?.trim() || createTokenSyncOpId('pull'));
    const source = typeof request === 'string'
      ? 'pipeline-service'
      : (request.source?.trim() || 'pipeline-service');
    if (!providerNormalized) {
      return { ok: false as const, reason: 'provider required', opId, hasToken: false as const, token: null as string | null };
    }
    if (
      this.state.connectionMode === 'local'
      || this.state.connectionStatus !== 'connected'
      || !this.wsAuthenticated
    ) {
      return { ok: false as const, reason: 'remote websocket not connected', opId, hasToken: false as const, token: null as string | null };
    }

    try {
      const response = await this.requestRemote('token.sync.pull', { provider: providerNormalized, opId, source }, 10_000);
      const payload = asObject(response.payload);
      const token = asString(payload?.token);
      const tokenKind = payload?.tokenKind === 'oauth' || payload?.tokenKind === 'api-key'
        ? payload.tokenKind
        : null;
      const fingerprint = asString(payload?.fingerprint) || null;
      return {
        ok: true as const,
        provider: providerNormalized,
        opId: asString(payload?.opId) || opId,
        hasToken: Boolean(token),
        token: token || null,
        email: asString(payload?.email) || null,
        piProviderId: asString(payload?.piProviderId) || null,
        oauthProviderId: asString(payload?.oauthProviderId) || null,
        refreshToken: asString(payload?.refreshToken) || null,
        expiresAtMs: typeof payload?.expiresAtMs === 'number' ? payload.expiresAtMs : null,
        accountId: asString(payload?.accountId) || null,
        projectId: asString(payload?.projectId) || null,
        metadata: payload?.metadata && typeof payload.metadata === 'object'
          ? payload.metadata as Record<string, unknown>
          : null,
        updatedAtMs: typeof payload?.updatedAtMs === 'number' ? payload.updatedAtMs : null,
        tokenKind,
        fingerprint,
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: String(error),
        opId,
        hasToken: false as const,
        token: null as string | null,
        email: null as string | null,
        piProviderId: null as string | null,
        oauthProviderId: null as string | null,
        refreshToken: null as string | null,
        expiresAtMs: null as number | null,
        accountId: null as string | null,
        projectId: null as string | null,
        metadata: null as Record<string, unknown> | null,
        updatedAtMs: null as number | null,
        tokenKind: null as 'oauth' | 'api-key' | null,
        fingerprint: null as string | null,
      };
    }
  }

  async probeProviderFromCloud(
    request: string | GatewayProviderProbeRequest,
  ): Promise<GatewayProviderProbeResult> {
    const providerInput = typeof request === 'string' ? request : request.provider;
    const providerNormalized = providerInput.trim().toLowerCase();
    const model = typeof request === 'string' ? '' : (request.model?.trim() || '');
    const opId = typeof request === 'string'
      ? createTokenSyncOpId('probe')
      : (request.opId?.trim() || createTokenSyncOpId('probe'));
    const source = typeof request === 'string'
      ? 'pipeline-service'
      : (request.source?.trim() || 'pipeline-service');
    if (!providerNormalized) {
      return { ok: false, capable: false, reason: 'provider required', opId };
    }
    if (
      this.state.connectionMode === 'local'
      || this.state.connectionStatus !== 'connected'
      || !this.wsAuthenticated
    ) {
      return { ok: false, capable: false, reason: 'remote websocket not connected', opId };
    }

    try {
      const response = await this.requestRemote(
        'provider.probe',
        {
          provider: providerNormalized,
          ...(model ? { model } : {}),
          opId,
          source,
        },
        30_000,
      );
      const payload = asObject(response.payload);
      const capable = payload?.capable === true;
      return {
        ok: true,
        capable,
        ...(capable ? {} : { reason: asString(payload?.error) || asString(payload?.reason) || 'provider capability probe failed' }),
        errorCode: asString(payload?.code) || null,
        opId: asString(payload?.opId) || opId,
        provider: asString(payload?.provider) || providerNormalized,
        model: asString(payload?.model) || model || undefined,
        latencyMs: typeof payload?.latencyMs === 'number' ? payload.latencyMs : null,
      };
    } catch (error) {
      return { ok: false, capable: false, reason: String(error), opId, provider: providerNormalized };
    }
  }

  async deleteTokenFromCloud(request: string | GatewayTokenSyncDeleteRequest): Promise<GatewayTokenSyncDeleteResult> {
    const providerInput = typeof request === 'string' ? request : request.provider;
    const providerNormalized = providerInput.trim().toLowerCase();
    const opId = typeof request === 'string'
      ? createTokenSyncOpId('delete')
      : (request.opId?.trim() || createTokenSyncOpId('delete'));
    const source = typeof request === 'string'
      ? 'pipeline-service'
      : (request.source?.trim() || 'pipeline-service');
    if (!providerNormalized) {
      return { deleted: false as const, reason: 'provider required', opId };
    }
    if (
      this.state.connectionMode === 'local'
      || this.state.connectionStatus !== 'connected'
      || !this.wsAuthenticated
    ) {
      return { deleted: false as const, reason: 'remote websocket not connected', opId };
    }

    try {
      const response = await this.requestRemote('token.sync.delete', { provider: providerNormalized, opId, source }, 10_000);
      const payload = asObject(response.payload);
      const verified = payload?.verified === true;
      const hasToken = payload?.hasToken === true;
      const reason = !verified
        ? (asString(payload?.reason) || 'delete failed verification')
        : undefined;
      return {
        deleted: verified,
        opId: asString(payload?.opId) || opId,
        verified,
        hasToken,
        provider: providerNormalized,
        updatedAtMs: typeof payload?.updatedAtMs === 'number' ? payload.updatedAtMs : null,
        ...(reason ? { reason } : {}),
      };
    } catch (error) {
      return { deleted: false as const, reason: String(error), opId };
    }
  }

  async syncChannelToCloud(
    channelId: string,
    type: string,
    config: Record<string, unknown>,
    isActive: boolean,
    linkedSessionId?: string | null,
  ) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { pushed: false, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('channel.upsert', {
        channelId,
        type,
        config,
        isActive,
        ...(typeof linkedSessionId === 'string' ? { linkedSessionId } : {}),
      }, 10_000);
      return { pushed: true, payload: asObject(response.payload) };
    } catch (error) {
      return { pushed: false, reason: String(error) };
    }
  }

  async deleteChannelFromCloud(channelId: string) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { deleted: false as const, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('channel.delete', { channelId }, 10_000);
      const payload = asObject(response.payload);
      return {
        deleted: Boolean(payload?.deleted),
      };
    } catch (error) {
      return { deleted: false as const, reason: String(error) };
    }
  }

  async pullChannelsFromCloud() {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return null;
    }
    try {
      const response = await this.requestRemote('channel.list', {}, 10_000);
      const payload = asObject(response.payload) ?? {};
      return Array.isArray(payload.channels) ? payload.channels : [];
    } catch {
      return null;
    }
  }

  async probeChannelFromCloud(channelId: string) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false as const, channelId, probe: null, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('channel.probe', { channelId }, 15_000);
      const payload = asObject(response.payload) ?? {};
      return {
        ok: true as const,
        channelId,
        probe: (payload.probe as Record<string, unknown>) ?? null,
      };
    } catch (error) {
      return { ok: false as const, channelId, probe: null, reason: String(error) };
    }
  }

  async getChannelStatusFromCloud(channelId: string) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false as const, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('channel.status', { channelId }, 10_000);
      const payload = asObject(response.payload) ?? {};
      return {
        ok: true as const,
        found: Boolean(payload.found),
        channel: payload.channel ?? null,
        runtime: payload.runtime ?? null,
        health: payload.health ?? null,
      };
    } catch (error) {
      return { ok: false as const, reason: String(error) };
    }
  }

  async listHookRoutesFromCloud(): Promise<HookRouteListResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected', routes: [] };
    }
    try {
      const response = await this.requestRemote('hook.route.list', {}, 10_000);
      const payload = asObject(response.payload) ?? {};
      const routesRaw = Array.isArray(payload.routes) ? payload.routes : [];
      const routes: HookRouteRecord[] = routesRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          tenantId: asString(row.tenantId),
          name: asString(row.name),
          action: asString(row.action) === 'agent' ? 'agent' : 'wake',
          enabled: row.enabled !== false,
          tokenHash: asString(row.tokenHash) || null,
          config: (asObject(row.config) ?? {}) as HookRouteRecord['config'],
          createdAtMs: typeof row.createdAtMs === 'number' ? row.createdAtMs : 0,
          updatedAtMs: typeof row.updatedAtMs === 'number' ? row.updatedAtMs : 0,
        };
      });
      return { ok: true, routes };
    } catch (error) {
      return { ok: false, reason: String(error), routes: [] };
    }
  }

  async upsertHookRouteInCloud(payload: HookRouteUpsertPayload): Promise<HookRouteUpsertResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('hook.route.upsert', payload, 10_000);
      const body = asObject(response.payload) ?? {};
      const routeRaw = asObject(body.route);
      if (!routeRaw) return { ok: false, reason: 'invalid response payload' };
      const route: HookRouteRecord = {
        tenantId: asString(routeRaw.tenantId),
        name: asString(routeRaw.name),
        action: asString(routeRaw.action) === 'agent' ? 'agent' : 'wake',
        enabled: routeRaw.enabled !== false,
        tokenHash: asString(routeRaw.tokenHash) || null,
        config: (asObject(routeRaw.config) ?? {}) as HookRouteRecord['config'],
        createdAtMs: typeof routeRaw.createdAtMs === 'number' ? routeRaw.createdAtMs : 0,
        updatedAtMs: typeof routeRaw.updatedAtMs === 'number' ? routeRaw.updatedAtMs : 0,
      };
      return { ok: true, route };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  async deleteHookRouteFromCloud(name: string): Promise<HookRouteDeleteResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected', deleted: false };
    }
    try {
      const response = await this.requestRemote('hook.route.delete', { name }, 10_000);
      const payload = asObject(response.payload) ?? {};
      return {
        ok: true,
        deleted: payload.deleted === true,
      };
    } catch (error) {
      return { ok: false, reason: String(error), deleted: false };
    }
  }

  async listHookEventsFromCloud(limit = 50): Promise<HookEventListResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected', events: [] };
    }
    try {
      const response = await this.requestRemote('hook.event.list', { limit }, 10_000);
      const payload = asObject(response.payload) ?? {};
      const eventsRaw = Array.isArray(payload.events) ? payload.events : [];
      const events: HookEventRecord[] = eventsRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          eventId: asString(row.eventId),
          hookName: asString(row.hookName),
          action: asString(row.action) === 'agent' ? 'agent' : 'wake',
          source: asString(row.source),
          path: asString(row.path),
          status: asString(row.status),
          error: asString(row.error) || null,
          payloadRef: asString(row.payloadRef) || null,
          payloadJson: row.payloadJson ?? null,
          createdAtMs: typeof row.createdAtMs === 'number' ? row.createdAtMs : 0,
          processedAtMs: typeof row.processedAtMs === 'number' ? row.processedAtMs : null,
        };
      });
      return { ok: true, events };
    } catch (error) {
      return { ok: false, reason: String(error), events: [] };
    }
  }

  async listHookAgentsFromCloud(): Promise<HookAgentListResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected', agents: [] };
    }
    try {
      const response = await this.requestRemote('hook.agent.list', {}, 10_000);
      const payload = asObject(response.payload) ?? {};
      const agentsRaw = Array.isArray(payload.agents) ? payload.agents : [];
      const agents: HookAgentRecord[] = agentsRaw.map((entry) => {
        const row = asObject(entry) ?? {};
        return {
          tenantId: asString(row.tenantId),
          agentId: asString(row.agentId),
          enabled: row.enabled !== false,
          config: asObject(row.config) ?? {},
          createdAtMs: typeof row.createdAtMs === 'number' ? row.createdAtMs : 0,
          updatedAtMs: typeof row.updatedAtMs === 'number' ? row.updatedAtMs : 0,
        };
      });
      return { ok: true, agents };
    } catch (error) {
      return { ok: false, reason: String(error), agents: [] };
    }
  }

  async upsertHookAgentInCloud(payload: HookAgentUpsertPayload): Promise<HookAgentUpsertResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('hook.agent.upsert', payload, 10_000);
      const body = asObject(response.payload) ?? {};
      const agentRaw = asObject(body.agent);
      if (!agentRaw) return { ok: false, reason: 'invalid response payload' };
      const agent: HookAgentRecord = {
        tenantId: asString(agentRaw.tenantId),
        agentId: asString(agentRaw.agentId),
        enabled: agentRaw.enabled !== false,
        config: asObject(agentRaw.config) ?? {},
        createdAtMs: typeof agentRaw.createdAtMs === 'number' ? agentRaw.createdAtMs : 0,
        updatedAtMs: typeof agentRaw.updatedAtMs === 'number' ? agentRaw.updatedAtMs : 0,
      };
      return { ok: true, agent };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  async deleteHookAgentFromCloud(agentId: string): Promise<HookAgentDeleteResult> {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false, reason: 'remote websocket not connected', deleted: false };
    }
    try {
      const response = await this.requestRemote('hook.agent.delete', { agentId }, 10_000);
      const payload = asObject(response.payload) ?? {};
      return {
        ok: true,
        deleted: payload.deleted === true,
      };
    } catch (error) {
      return { ok: false, reason: String(error), deleted: false };
    }
  }

  async getCloudDebugSnapshot(payload?: { limit?: number; sessionId?: string; includeR2?: boolean }) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false as const, reason: 'remote websocket not connected' };
    }
    try {
      const response = await this.requestRemote('debug.snapshot', payload ?? {}, 15_000);
      return {
        ok: true as const,
        payload: response.payload ?? null,
      };
    } catch (error) {
      return { ok: false as const, reason: String(error) };
    }
  }

  async requestCloudMethod(method: string, params?: unknown, timeoutMs = 12_000) {
    if (!isGatewayWsReady(this.state, this.wsAuthenticated)) {
      return { ok: false as const, reason: 'remote websocket not connected', payload: null as unknown };
    }
    try {
      const response = await this.requestRemote(method, params ?? {}, timeoutMs);
      return {
        ok: true as const,
        payload: response.payload ?? null,
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: String(error),
        payload: null as unknown,
      };
    }
  }

  /** Called from main process to refresh the stored Clerk token between reconnects. */
  updateCloudToken(token: string) {
    this.cloudToken = token;
  }

  async connectCloud(
    clerkToken: string,
    wsDomain = 'wss://ws.capzero.ai',
    cloudTarget: GatewayStateSnapshot['cloudTarget'] = this.inferCloudTarget(wsDomain),
  ) {
    this.cloudToken = clerkToken;
    this.cloudWsDomain = wsDomain;
    this.cloudAutoReconnect = true;
    this.cloudReconnectAttempt = 0;

    this.closeWs('switching to cloud mode');

    this.state = {
      ...this.state,
      connectionMode: 'remote-direct',
      connectionScope: 'cloud',
      cloudTarget,
      lastCloudConnectAttemptAtMs: now(),
      lastCloudConnectError: null,
      connectionStatus: 'connecting',
      connectionDetail: 'Connecting to cloud gateway...',
      tunnelStatus: 'stopped',
      tunnelDetail: 'Direct websocket mode.',
      health: {
        ok: null,
        summary: 'Connecting to cloud...',
        checkedAtMs: now(),
      },
    };
    this.emitState();

    const doConnect = async (): Promise<boolean> => {
      try {
        await this.connectRemoteDirect({
          ...this.remoteSettings,
          transport: 'direct',
          remoteUrl: `${wsDomain}/ws`,
          token: clerkToken,
        });
        await this.waitForAuthenticated(10_000);
        this.cloudReconnectAttempt = 0;
        return true;
      } catch (error) {
        const reason = String(error);
        this.observe({
          level: 'warn',
          domain: 'gateway.cloud',
          action: 'connect',
          status: 'error',
          data: { error: reason },
        });
        this.state = {
          ...this.state,
          lastCloudConnectError: reason,
        };
        this.emitState();
        this.scheduleCloudReconnect();
        return false;
      }
    };

    this.cloudConnectPromise = doConnect();
    const ok = await this.cloudConnectPromise;
    this.cloudConnectPromise = null;
    if (!ok) return this.state;
    return this.state;
  }

  /**
   * Wait for an in-progress cloud connection attempt to finish.
   * Returns true if the cloud WS is authenticated, false otherwise.
   */
  async waitForCloudReady(timeoutMs = 12_000): Promise<boolean> {
    if (this.wsAuthenticated && this.state.connectionMode !== 'local') return true;
    if (this.cloudConnectPromise) {
      const result = await Promise.race([
        this.cloudConnectPromise,
        new Promise<false>((r) => setTimeout(() => r(false), timeoutMs)),
      ]);
      return result && this.wsAuthenticated && this.state.connectionMode !== 'local';
    }
    return false;
  }

  private scheduleCloudReconnect() {
    if (!this.cloudAutoReconnect || !this.cloudWsDomain) return;

    if (this.cloudReconnectTimer) {
      clearTimeout(this.cloudReconnectTimer);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap + jitter
    const baseDelay = Math.min(30_000, 1000 * Math.pow(2, this.cloudReconnectAttempt));
    const jitter = Math.random() * 1000;
    const delay = baseDelay + jitter;
    this.cloudReconnectAttempt += 1;

    this.observe({
      domain: 'gateway.cloud',
      action: 'reconnect.scheduled',
      status: 'start',
      data: { attempt: this.cloudReconnectAttempt, delayMs: Math.round(delay) },
    });

    this.state = {
      ...this.state,
      connectionStatus: 'disconnected',
      connectionDetail: `Cloud disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`,
      lastCloudConnectAttemptAtMs: now(),
      health: {
        ok: false,
        summary: `Reconnecting (attempt ${this.cloudReconnectAttempt})...`,
        checkedAtMs: now(),
      },
    };
    this.emitState();

    this.cloudReconnectTimer = setTimeout(() => {
      void (async () => {
        try {
          // Refresh Clerk token before reconnecting
          let token = this.cloudToken;
          if (this.deps.refreshClerkToken) {
            const refreshed = await this.deps.refreshClerkToken();
            if (refreshed) {
              token = refreshed;
              this.cloudToken = refreshed;
            }
          }
          if (!token) {
            const reason = 'no_token';
            this.observe({
              level: 'warn',
              domain: 'gateway.cloud',
              action: 'reconnect',
              status: 'error',
              data: { reason },
            });
            this.state = {
              ...this.state,
              lastCloudConnectError: reason,
            };
            this.emitState();
            this.scheduleCloudReconnect();
            return;
          }

          this.state = {
            ...this.state,
            lastCloudConnectAttemptAtMs: now(),
            lastCloudConnectError: null,
          };
          this.emitState();
          await this.connectRemoteDirect({
            ...this.remoteSettings,
            transport: 'direct',
            remoteUrl: `${this.cloudWsDomain}/ws`,
            token,
          });
          await this.waitForAuthenticated(10_000);
          this.cloudReconnectAttempt = 0;
        } catch (error) {
          const reason = String(error);
          this.observe({
            level: 'warn',
            domain: 'gateway.cloud',
            action: 'reconnect',
            status: 'error',
            data: { attempt: this.cloudReconnectAttempt, error: reason },
          });
          this.state = {
            ...this.state,
            lastCloudConnectError: reason,
          };
          this.emitState();
          this.scheduleCloudReconnect();
        }
      })();
    }, delay);
  }

  markCloudConnectBlocked(
    message: string,
    cloudTarget: GatewayStateSnapshot['cloudTarget'] = 'dev-local',
  ) {
    this.state = {
      ...this.state,
      connectionMode: 'remote-direct',
      connectionScope: 'cloud',
      cloudTarget,
      connectionStatus: 'disconnected',
      connectionDetail: message,
      lastCloudConnectAttemptAtMs: now(),
      lastCloudConnectError: message,
      health: {
        ok: false,
        summary: message,
        checkedAtMs: now(),
      },
    };
    this.emitState();
  }

  disconnectCloud() {
    this.cloudAutoReconnect = false;
    this.cloudToken = null;
    this.cloudWsDomain = null;
    if (this.cloudReconnectTimer) {
      clearTimeout(this.cloudReconnectTimer);
      this.cloudReconnectTimer = null;
    }
    this.closeWs('cloud disconnect');
  }

  async shutdown() {
    this.cloudAutoReconnect = false;
    if (this.cloudReconnectTimer) {
      clearTimeout(this.cloudReconnectTimer);
      this.cloudReconnectTimer = null;
    }
    for (const active of this.activeRuns.values()) {
      clearTimeout(active.timer);
    }
    this.activeRuns.clear();
    this.closeWs('shutdown');
  }
}
