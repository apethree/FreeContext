import { useAuth, useClerk } from '@clerk/clerk-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CopyableText } from '@/components/ui/copyable-text';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { buildApiKeyTokenSyncPayload, createTokenSyncOpId } from '@/gateway/tokenSyncTypes';
import { logUiEvent } from '@/lib/observability';
import { fetchSyncJson } from '@/shared/collections/http';
import type { LocalAuthProfilePayload } from '@/shared/collections/types';

type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'degraded';

type PhaseState = {
  challengeSeen: boolean;
  connectOk: boolean;
  methodOk: boolean;
  turnLeaseOk: boolean;
  sessionUpsertOk: boolean;
  appendOk: boolean;
  historyOk: boolean;
  idempotencyOk: boolean;
  deviceRegisterOk: boolean;
  nodeAuthOk: boolean;
  nodeMethodOk: boolean;
  catchupOk: boolean;
};

type PingMetrics = {
  total: number;
  ok: number;
  failed: number;
  lastRttMs: number | null;
};

type ConnectedIdentity = {
  tenantId: string;
  tenantType: string;
  userId: string;
  role: string;
  scopes: string[];
};

type GatewayFrame = {
  type: string;
  id?: string;
  method?: string;
  event?: string;
  ok?: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
};

type GatewayResponseFrame = GatewayFrame & {
  type: 'res';
  id: string;
  ok: boolean;
};

type JwtPayload = {
  iss?: unknown;
  sub?: unknown;
  org_id?: unknown;
  org_role?: unknown;
  exp?: unknown;
};

type LocalOpenclawStatus = {
  activeUserId: string | null;
  profileRoot: string | null;
  stateDir: string | null;
  configPath: string | null;
  status: 'stopped' | 'starting' | 'running' | 'failed';
  detail: string;
  launcherLabel: string | null;
  pid: number | null;
  startedAtMs: number | null;
  gatewayProbe: {
    checkedAtMs: number;
    port: number;
    reachable: boolean;
    detail: string;
  };
  gatewayStatus: {
    checkedAtMs: number;
    ok: boolean;
    detail: string;
    output: string;
  };
  logTail: string[];
};

type LocalOpenclawRuntimeCheck = {
  checkedAtMs: number;
  packagedOnly: boolean;
  expectedBinaryName: string;
  expectedPaths: string[];
  foundPaths: string[];
  candidates: Array<{
    label: string;
    command: string;
    cwd: string | null;
  }>;
  hasRuntime: boolean;
  detail: string;
};

type LocalAuthProfile = {
  profileId: string;
  provider: string;
  type: string;
  hasAccess: boolean;
  hasRefresh: boolean;
  expires: number | null;
};

type CloudSyncCheck = {
  profileId: string;
  provider: string;
  status: 'in-sync' | 'mismatch' | 'missing-cloud' | 'error';
  detail: string;
};

const LOCAL_OAUTH_TO_CLOUD_PROVIDER: Record<string, string> = {
  'openai-codex': 'openai',
  'gemini-cli': 'gemini',
  'google-gemini-cli': 'gemini',
};

function toCloudProvider(provider: string): string {
  return LOCAL_OAUTH_TO_CLOUD_PROVIDER[provider] ?? provider;
}

function localProviderAliases(provider: string): string[] {
  const p = provider.trim().toLowerCase();
  if (!p) return [];
  if (p === 'openai' || p === 'openai-codex') return ['openai', 'openai-codex'];
  if (p === 'gemini' || p === 'gemini-cli' || p === 'google-gemini-cli') {
    return ['gemini', 'gemini-cli', 'google-gemini-cli'];
  }
  return [p];
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function statusVariant(status: WsStatus) {
  if (status === 'connected') return 'success';
  if (status === 'connecting') return 'info';
  if (status === 'degraded') return 'warning';
  return 'muted';
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const raw = atob(padded);
    return JSON.parse(raw) as JwtPayload;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function buildNodeWsUrl(baseWsUrl: string, tenantId: string): string {
  const url = new URL(baseWsUrl);
  if (url.pathname.endsWith('/ws')) {
    url.pathname = `${url.pathname.slice(0, -3)}/ws-node`;
  } else {
    url.pathname = '/ws-node';
  }
  url.searchParams.set('tenantId', tenantId);
  return url.toString();
}

type CredentialPushResponse = {
  ok: boolean;
  txid?: string;
  provider?: string;
  tokenKind?: string;
  verified?: boolean;
  fingerprint?: string;
  updatedAtMs?: number;
  reason?: string;
};

type CredentialDeleteResponse = {
  ok: boolean;
  txid?: string;
  provider?: string;
  deleted?: boolean;
  verified?: boolean;
  updatedAtMs?: number;
  reason?: string;
};

function readAuthProfileToken(profile: LocalAuthProfilePayload): string {
  return profile.type === 'oauth' ? profile.access : profile.token;
}

export function OpenClawHostedPhasePage() {
  const { getToken, orgId, userId } = useAuth();
  const { setActive } = useClerk();
  const [wsUrl, setWsUrl] = useState(import.meta.env.VITE_ONESHOT_WS_URL || 'ws://127.0.0.1:8789/ws');
  const [token, setToken] = useState('');
  const [tokenTemplate, setTokenTemplate] = useState('openclaw');
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const [detail, setDetail] = useState('Ready');
  const [phase, setPhase] = useState<PhaseState>({
    challengeSeen: false,
    connectOk: false,
    methodOk: false,
    turnLeaseOk: false,
    sessionUpsertOk: false,
    appendOk: false,
    historyOk: false,
    idempotencyOk: false,
    deviceRegisterOk: false,
    nodeAuthOk: false,
    nodeMethodOk: false,
    catchupOk: false,
  });
  const [metrics, setMetrics] = useState<PingMetrics>({ total: 0, ok: 0, failed: 0, lastRttMs: null });
  const [logs, setLogs] = useState<string[]>([]);
  const [identity, setIdentity] = useState<ConnectedIdentity | null>(null);
  const [tokenProvider, setTokenProvider] = useState('openai');
  const [tokenValue, setTokenValue] = useState('');
  const [channelId, setChannelId] = useState(`channel-${crypto.randomUUID()}`);
  const [channelType, setChannelType] = useState('webhook');
  const [channelWebhookUrl, setChannelWebhookUrl] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [channelTargetId, setChannelTargetId] = useState('target-1');
  const [channelText, setChannelText] = useState('hello from hosted phase');
  const [channelListText, setChannelListText] = useState('');
  const [localStatus, setLocalStatus] = useState<LocalOpenclawStatus | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<LocalOpenclawRuntimeCheck | null>(null);
  const [openaiOauthSessionId, setOpenaiOauthSessionId] = useState('');
  const [oauthProvider, setOauthProvider] = useState('openai-codex');
  const [oauthInputValue, setOauthInputValue] = useState('');
  const [openaiOauthStatusText, setOpenaiOauthStatusText] = useState('');
  const [authStoreStatusText, setAuthStoreStatusText] = useState('');
  const [localAuthProfiles, setLocalAuthProfiles] = useState<LocalAuthProfile[]>([]);
  const [cloudSyncChecks, setCloudSyncChecks] = useState<CloudSyncCheck[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const challengeNonceRef = useRef<string>('');
  const connectIdRef = useRef<string>('');
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingPingRef = useRef<Map<string, number>>(new Map());
  const pendingRequestsRef = useRef<Map<string, (frame: GatewayResponseFrame) => void>>(new Map());
  const demoSessionIdRef = useRef(`hosted-phase-${crypto.randomUUID()}`);
  const openedOpenAIOAuthUrlRef = useRef<string>('');
  const syncedOAuthProfilesRef = useRef<Set<string>>(new Set());
  const oauthLastStatusRef = useRef<Map<string, string>>(new Map());

  const addLog = useCallback((line: string) => {
    setLogs((previous) => [`${new Date().toISOString()} ${line}`, ...previous].slice(0, 80));
    logUiEvent({
      domain: 'hosted-phase',
      action: 'log',
      level: line.toLowerCase().includes('failed') || line.toLowerCase().includes('error') ? 'warn' : 'debug',
      data: { line },
    });
  }, []);

  const stopPingLoop = useCallback(() => {
    if (!pingTimerRef.current) return;
    clearInterval(pingTimerRef.current);
    pingTimerRef.current = null;
  }, []);

  const disconnect = useCallback((reason: string) => {
    stopPingLoop();
    pendingPingRef.current.clear();
    pendingRequestsRef.current.clear();
    challengeNonceRef.current = '';
    connectIdRef.current = '';

    if (wsRef.current) {
      try {
        wsRef.current.close(1000, reason);
      } catch {
        // no-op
      }
      wsRef.current = null;
    }

    setStatus('disconnected');
    setDetail(reason);
  }, [stopPingLoop]);

  const sendRequest = useCallback((method: string, params?: unknown, timeoutMs = 7000) => {
    return new Promise<GatewayResponseFrame>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('socket not open'));
        return;
      }

      const id = makeId('req');
      const timeout = window.setTimeout(() => {
        pendingRequestsRef.current.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);

      pendingRequestsRef.current.set(id, (frame) => {
        window.clearTimeout(timeout);
        resolve(frame);
      });

      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }, []);

  const tokenStorageKey = useCallback((provider: string) => {
    const tenant = identity?.tenantId || orgId || 'personal';
    const uid = userId || 'anonymous';
    return `hosted.token.${tenant}.${uid}.${provider.toLowerCase()}`;
  }, [identity?.tenantId, orgId, userId]);

  const getPreferredClerkToken = useCallback(async () => {
    let nextToken: string | null = null;
    try {
      nextToken = await getToken({
        ...(tokenTemplate.trim().length > 0 ? { template: tokenTemplate.trim() } : {}),
        ...(organizationId.trim().length > 0 ? { organizationId: organizationId.trim() } : {}),
      });
    } catch {
      nextToken = null;
    }
    if (nextToken) return nextToken;
    try {
      return await getToken({
        ...(organizationId.trim().length > 0 ? { organizationId: organizationId.trim() } : {}),
      });
    } catch {
      return null;
    }
  }, [getToken, organizationId, tokenTemplate]);

  const fetchCloudCredentialSecret = useCallback(async (providerRaw: string) => {
    const provider = providerRaw.trim().toLowerCase();
    try {
      return await fetchSyncJson<LocalAuthProfilePayload>(
        getPreferredClerkToken,
        `/api/credentials/${encodeURIComponent(provider)}/secret`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/credential not found|not found|404/i.test(message)) {
        return null;
      }
      throw error;
    }
  }, [getPreferredClerkToken]);

  const pushCloudCredential = useCallback(async (providerRaw: string, nextToken: string) => {
    const provider = providerRaw.trim().toLowerCase();
    return await fetchSyncJson<CredentialPushResponse>(
      getPreferredClerkToken,
      '/api/credentials/push',
      {
        method: 'POST',
        body: JSON.stringify(buildApiKeyTokenSyncPayload(provider, nextToken, {
          opId: createTokenSyncOpId('hosted-push'),
          source: 'hosted-phase',
        })),
      },
    );
  }, [getPreferredClerkToken]);

  const deleteCloudCredential = useCallback(async (providerRaw: string) => {
    const provider = providerRaw.trim().toLowerCase();
    return await fetchSyncJson<CredentialDeleteResponse>(
      getPreferredClerkToken,
      `/api/credentials/${encodeURIComponent(provider)}`,
      { method: 'DELETE' },
    );
  }, [getPreferredClerkToken]);

  const saveLocalToken = useCallback(async () => {
    const provider = tokenProvider.trim().toLowerCase();
    if (!provider) return;
    await window.appShell.setSetting(tokenStorageKey(provider), tokenValue);
    addLog(`token-sync: saved local token for ${provider}`);
  }, [addLog, tokenProvider, tokenStorageKey, tokenValue]);

  const pushTokenToCloud = useCallback(async () => {
    const provider = tokenProvider.trim().toLowerCase();
    if (!provider) return;
    const stored = await window.appShell.getSetting(tokenStorageKey(provider));
    const localToken = typeof stored === 'string'
      ? stored
      : (stored as { token?: unknown } | null)?.token && typeof (stored as { token?: unknown }).token === 'string'
        ? (stored as { token: string }).token
        : tokenValue;
    if (!localToken) {
      throw new Error('no local token found to push');
    }
    const response = await pushCloudCredential(provider, localToken);
    if (!response.ok || response.verified === false) {
      throw new Error(response.reason || 'credentials push failed');
    }
    addLog(
      `token-sync: pushed ${provider} token verified=${String(response.verified ?? false)} fingerprint=${response.fingerprint ?? 'none'} txid=${response.txid}`,
    );
  }, [addLog, pushCloudCredential, tokenProvider, tokenStorageKey, tokenValue]);

  const pullTokenFromCloud = useCallback(async () => {
    const provider = tokenProvider.trim().toLowerCase();
    if (!provider) return;
    const secret = await fetchCloudCredentialSecret(provider);
    if (!secret) {
      await window.appShell.pipelineDeleteProviderToken({ provider });
      await window.appShell.setSetting(tokenStorageKey(provider), '');
      setTokenValue('');
      addLog(`token-sync: no cloud token for ${provider}`);
      return;
    }
    const nextToken = readAuthProfileToken(secret);
    setTokenValue(nextToken);
    await window.appShell.setSetting(tokenStorageKey(provider), nextToken);
    await window.appShell.pipelineSaveProviderToken({ provider, token: nextToken });
    addLog(`token-sync: pulled ${provider} token from cloud secret endpoint`);
  }, [addLog, fetchCloudCredentialSecret, tokenProvider, tokenStorageKey]);

  const runNodeAuthCheck = useCallback(async (tenantId: string): Promise<{ deviceId: string }> => {
    const keypair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicKeyRaw = await crypto.subtle.exportKey('raw', keypair.publicKey);
    const publicKey = toBase64Url(fromArrayBuffer(publicKeyRaw));
    const deviceId = `node-phase-${crypto.randomUUID().slice(0, 12)}`;

    const registerResponse = await sendRequest('device.register', {
      deviceId,
      displayName: 'One Shot Phase Node',
      platform: 'darwin',
      publicKey,
    });
    if (!registerResponse.ok) {
      throw new Error(registerResponse.error?.message || 'device.register failed');
    }
    const registerPayload = (registerResponse.payload || {}) as { deviceToken?: unknown };
    const deviceToken = asString(registerPayload.deviceToken);
    if (!deviceToken) {
      throw new Error('device.register returned empty deviceToken');
    }
    setPhase((previous) => ({ ...previous, deviceRegisterOk: true }));
    addLog(`phase2: device registered ${deviceId}`);

    const nodeWsUrl = buildNodeWsUrl(wsUrl, tenantId);
    const nodeWs = new WebSocket(nodeWsUrl);
    await new Promise<void>((resolve, reject) => {
      const nodeConnectId = makeId('node-connect');
      const nodePingId = makeId('node-ping');
      let done = false;

      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        try {
          nodeWs.close(1000, error ? 'error' : 'ok');
        } catch {
          // no-op
        }
        if (error) reject(error);
        else resolve();
      };

      nodeWs.addEventListener('error', () => {
        finish(new Error('node websocket error'));
      });

      nodeWs.addEventListener('message', async (event) => {
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(raw) as GatewayFrame;
        } catch {
          return;
        }

        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          const nonce = asString((frame.payload as { nonce?: unknown } | undefined)?.nonce);
          if (!nonce) {
            finish(new Error('node challenge missing nonce'));
            return;
          }
          const signedAt = Date.now();
          const message = new TextEncoder().encode(`${nonce}:${signedAt}`);
          const signatureRaw = await crypto.subtle.sign({ name: 'Ed25519' }, keypair.privateKey, message);
          const signature = toBase64Url(fromArrayBuffer(signatureRaw));
          nodeWs.send(
            JSON.stringify({
              type: 'req',
              id: nodeConnectId,
              method: 'connect',
              params: {
                role: 'node',
                auth: { deviceToken },
                device: { id: deviceId, publicKey, nonce, signedAt, signature },
              },
            }),
          );
          return;
        }

        if (frame.type === 'res' && frame.id === nodeConnectId) {
          if (!frame.ok) {
            finish(new Error(frame.error?.message || 'node connect failed'));
            return;
          }
          setPhase((previous) => ({ ...previous, nodeAuthOk: true }));
          nodeWs.send(
            JSON.stringify({
              type: 'req',
              id: nodePingId,
              method: 'node.ping',
              params: { source: 'one-shot-hosted-phase-node' },
            }),
          );
          return;
        }

        if (frame.type === 'res' && frame.id === nodePingId) {
          if (!frame.ok) {
            finish(new Error(frame.error?.message || 'node.ping failed'));
            return;
          }
          setPhase((previous) => ({ ...previous, nodeMethodOk: true }));
          finish();
        }
      });
    });
    addLog('phase2: node auth path passed');
    return { deviceId };
  }, [addLog, sendRequest, wsUrl]);

  const runPhase2Checks = useCallback(async (tenantId: string) => {
    const sessionId = demoSessionIdRef.current;
    const node = await runNodeAuthCheck(tenantId);
    const deviceId = node.deviceId;
    addLog(`phase2: validating session ${sessionId}`);

    const lease = await sendRequest('turn.acquire', { sessionId, deviceId, ttlMs: 120000 });
    if (!lease.ok || !(lease.payload as { acquired?: unknown } | undefined)?.acquired) {
      throw new Error(lease.error?.message || 'turn.acquire failed');
    }
    setPhase((previous) => ({ ...previous, turnLeaseOk: true }));

    const upsert = await sendRequest('session.upsert', {
      sessionId,
      deviceId,
      meta: { source: 'one-shot-hosted-phase', ts: Date.now() },
    });
    if (!upsert.ok) {
      throw new Error(upsert.error?.message || 'session.upsert failed');
    }
    setPhase((previous) => ({ ...previous, sessionUpsertOk: true }));

    const idemKey = makeId('idem');
    const userAppend = await sendRequest('chat.append', {
      sessionId,
      role: 'user',
      content: `phase2-user-${Date.now()}`,
      idempotencyKey: idemKey,
      meta: { source: 'phase-test' },
    });
    if (!userAppend.ok) {
      throw new Error(userAppend.error?.message || 'chat.append user failed');
    }

    const idemRepeat = await sendRequest('chat.append', {
      sessionId,
      role: 'user',
      content: `phase2-user-${Date.now()}`,
      idempotencyKey: idemKey,
      meta: { source: 'phase-test-repeat' },
    });
    if (!idemRepeat.ok || !(idemRepeat.payload as { duplicate?: unknown } | undefined)?.duplicate) {
      throw new Error('idempotency check failed');
    }
    setPhase((previous) => ({ ...previous, idempotencyOk: true }));

    const assistantAppend = await sendRequest('chat.append', {
      sessionId,
      role: 'assistant',
      content: `phase2-assistant-${Date.now()}`,
      idempotencyKey: makeId('idem'),
      meta: { source: 'phase-test' },
    });
    if (!assistantAppend.ok) {
      throw new Error(assistantAppend.error?.message || 'chat.append assistant failed');
    }
    setPhase((previous) => ({ ...previous, appendOk: true }));

    const history = await sendRequest('chat.history', { sessionId, afterSeq: 0, limit: 10 });
    const historyPayload = (history.payload || {}) as { messages?: unknown };
    const messages = Array.isArray(historyPayload.messages) ? historyPayload.messages : [];
    if (!history.ok || messages.length < 2) {
      throw new Error('chat.history returned insufficient messages');
    }
    setPhase((previous) => ({ ...previous, historyOk: true }));

    const typedMessages = messages as Array<{ seq?: unknown }>;
    const seqs = typedMessages
      .map((entry) => (typeof entry.seq === 'number' ? entry.seq : 0))
      .filter((seq) => seq > 0);
    const lastAckedSeq = seqs.length > 0 ? Math.max(...seqs) - 1 : 0;

    const catchup = await sendRequest('sync.catchup', { sessionId, lastAckedSeq, limit: 20 });
    const catchupPayload = (catchup.payload || {}) as { events?: unknown[]; nextAckedSeq?: unknown };
    const catchupEvents = Array.isArray(catchupPayload.events) ? catchupPayload.events : [];
    if (!catchup.ok || catchupEvents.length === 0 || typeof catchupPayload.nextAckedSeq !== 'number') {
      throw new Error('sync.catchup validation failed');
    }
    setPhase((previous) => ({ ...previous, catchupOk: true }));

    const release = await sendRequest('turn.release', { sessionId, deviceId });
    if (!release.ok) {
      addLog(`turn.release returned: ${release.error?.message || 'unknown error'}`);
    }
    addLog('phase2: checks passed');
  }, [addLog, runNodeAuthCheck, sendRequest]);

  const sendPing = useCallback((method: 'health.ping' | 'health.echo') => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const id = makeId('ping');
    pendingPingRef.current.set(id, Date.now());
    setMetrics((previous) => ({ ...previous, total: previous.total + 1 }));

    ws.send(
      JSON.stringify({
        type: 'req',
        id,
        method,
        params: method === 'health.echo' ? { source: 'one-shot-hosted-phase', ts: Date.now() } : undefined,
      }),
    );
  }, []);

  const startPingLoop = useCallback(() => {
    stopPingLoop();
    sendPing('health.ping');
    pingTimerRef.current = setInterval(() => {
      sendPing(Math.random() > 0.5 ? 'health.ping' : 'health.echo');
    }, 4000);
  }, [sendPing, stopPingLoop]);

  const connect = useCallback(async () => {
    let effectiveToken = token.trim();
    const refreshed = await getPreferredClerkToken().catch(() => null);
    if (typeof refreshed === 'string' && refreshed.trim().length > 0) {
      effectiveToken = refreshed.trim();
      setToken(effectiveToken);
      void window.appShell.pipelinePushClerkToken({ token: effectiveToken }).catch(() => {
        // Best-effort sync for main-process reconnect path.
      });
    }

    if (!effectiveToken) {
      setStatus('degraded');
      setDetail('Missing Clerk token');
      return;
    }

    disconnect('Reconnecting');
    setPhase({
      challengeSeen: false,
      connectOk: false,
      methodOk: false,
      turnLeaseOk: false,
      sessionUpsertOk: false,
      appendOk: false,
      historyOk: false,
      idempotencyOk: false,
      deviceRegisterOk: false,
      nodeAuthOk: false,
      nodeMethodOk: false,
      catchupOk: false,
    });
    setMetrics({ total: 0, ok: 0, failed: 0, lastRttMs: null });
    setIdentity(null);
    setStatus('connecting');
    setDetail('Opening websocket...');

    const wsConnectUrl = (() => {
      const separator = wsUrl.includes('?') ? '&' : '?';
      return `${wsUrl}${separator}token=${encodeURIComponent(effectiveToken)}`;
    })();

    const ws = new WebSocket(wsConnectUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setStatus('connecting');
      setDetail('Socket open, waiting for connect.challenge');
      addLog('socket open');
    });

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;

      let frame: GatewayFrame;
      try {
        frame = JSON.parse(raw) as GatewayFrame;
      } catch {
        addLog('ignored invalid JSON frame');
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const nonce = asString((frame.payload as { nonce?: unknown } | undefined)?.nonce);
        if (!nonce) {
          setStatus('degraded');
          setDetail('Challenge event missing nonce');
          addLog('challenge missing nonce');
          return;
        }

        challengeNonceRef.current = nonce;
        setPhase((previous) => ({ ...previous, challengeSeen: true }));
        connectIdRef.current = makeId('connect');

        ws.send(
          JSON.stringify({
            type: 'req',
            id: connectIdRef.current,
              method: 'connect',
              params: {
                role: 'operator',
                scopes: ['operator.read', 'operator.write', 'operator.admin'],
                auth: { token: effectiveToken },
                device: {
                  id: 'one-shot-hosted-phase',
                  nonce,
                  signedAt: Date.now(),
              },
            },
          }),
        );

        addLog('connect.challenge received -> sent connect request');
        return;
      }

      if (frame.type === 'res' && frame.id === connectIdRef.current) {
        if (frame.ok) {
          const payload = (frame.payload || {}) as {
            tenantId?: unknown;
            tenantType?: unknown;
            userId?: unknown;
            role?: unknown;
            scopes?: unknown;
          };
          setIdentity({
            tenantId: asString(payload.tenantId),
            tenantType: asString(payload.tenantType),
            userId: asString(payload.userId),
            role: asString(payload.role),
            scopes: Array.isArray(payload.scopes)
              ? payload.scopes.filter((value): value is string => typeof value === 'string')
              : [],
          });
          setPhase((previous) => ({ ...previous, connectOk: true }));
          setStatus('connected');
          setDetail('Connected and authenticated');
          addLog('connect accepted');
          startPingLoop();
          void runPhase2Checks(asString(payload.tenantId)).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setStatus('degraded');
            setDetail(`Phase 2 failed: ${message}`);
            addLog(`phase2 failed: ${message}`);
          });
        } else {
          const message = frame.error?.message || 'connect rejected';
          setStatus('degraded');
          setDetail(message);
          addLog(`connect rejected: ${message}`);
        }
        return;
      }

      if (frame.type === 'res' && frame.id && pendingPingRef.current.has(frame.id)) {
        const startedAt = pendingPingRef.current.get(frame.id) ?? Date.now();
        pendingPingRef.current.delete(frame.id);
        const rttMs = Math.max(0, Date.now() - startedAt);

        if (frame.ok) {
          setPhase((previous) => ({ ...previous, methodOk: true }));
          setMetrics((previous) => ({
            ...previous,
            ok: previous.ok + 1,
            lastRttMs: rttMs,
          }));
          return;
        }

        const message = frame.error?.message || 'method failed';
        setMetrics((previous) => ({
          ...previous,
          failed: previous.failed + 1,
          lastRttMs: rttMs,
        }));
        addLog(`method failed: ${message}`);
        return;
      }

      if (frame.type === 'res' && frame.id) {
        const resolver = pendingRequestsRef.current.get(frame.id);
        if (resolver) {
          pendingRequestsRef.current.delete(frame.id);
          resolver(frame as GatewayResponseFrame);
          return;
        }
      }

      if (frame.type === 'event' && frame.event === 'tick') {
        addLog('tick received');
      }
    });

    ws.addEventListener('close', (event) => {
      stopPingLoop();
      pendingPingRef.current.clear();
      const reason = `Socket closed (${event.code}) ${event.reason || ''}`.trim();
      setStatus('degraded');
      setDetail(reason);
      addLog(reason);
    });

    ws.addEventListener('error', () => {
      setStatus('degraded');
      setDetail('WebSocket error');
      addLog('websocket error');
    });
  }, [addLog, disconnect, getPreferredClerkToken, runPhase2Checks, startPingLoop, stopPingLoop, token, wsUrl]);

  const fetchClerkToken = useCallback(async () => {
    const nextToken = await getPreferredClerkToken();
    if (!nextToken) {
      setDetail('No Clerk token available in current session');
      return;
    }
    setToken(nextToken);
    void window.appShell.pipelinePushClerkToken({ token: nextToken }).catch(() => {
      // Best-effort background refresh for main-process cloud reconnects.
    });
    const payload = decodeJwtPayload(nextToken);
    if (!payload) {
      setDetail('Loaded token but failed to decode JWT payload');
      addLog('loaded token but payload decode failed');
    } else if (typeof payload.org_id !== 'string' || payload.org_id.length === 0) {
      setDetail('Loaded personal-context token (no org_id). This is valid for personal tenant mode.');
      addLog('loaded token in personal mode');
    } else {
      setDetail(`Loaded org-context token for ${payload.org_id}`);
      addLog(`loaded token for org ${payload.org_id}`);
    }
  }, [addLog, getPreferredClerkToken]);

  const activateOrganization = useCallback(async () => {
    const targetOrgId = organizationId.trim();
    if (!targetOrgId) {
      setDetail('Enter organization ID first (org_...)');
      return;
    }
    await setActive({ organization: targetOrgId });
    setDetail(`Active organization set to ${targetOrgId}`);
    addLog(`set active organization: ${targetOrgId}`);
  }, [addLog, organizationId, setActive]);

  const refreshLocalStatus = useCallback(async () => {
    const next = await window.appShell.pipelineGetLocalOpenclawStatus();
    setLocalStatus(next);
  }, []);

  const checkLocalRuntime = useCallback(async () => {
    const next = await window.appShell.pipelineCheckOpenclawRuntime();
    setRuntimeCheck(next);
    addLog(`local-openclaw runtime-check: ${next.hasRuntime ? 'ok' : 'missing'} ${next.detail}`);
    if (!next.hasRuntime) {
      setDetail(next.detail);
    }
    return next;
  }, [addLog]);

  const startLocalOpenclaw = useCallback(async () => {
    const preflight = await checkLocalRuntime();
    if (!preflight.hasRuntime) {
      addLog(`local-openclaw start skipped: ${preflight.detail}`);
      return;
    }
    const next = await window.appShell.pipelineStartLocalOpenclaw();
    addLog(`local-openclaw start: ${next.status} ${next.detail}`);
    await refreshLocalStatus();
  }, [addLog, checkLocalRuntime, refreshLocalStatus]);

  const stopLocalOpenclaw = useCallback(async () => {
    const next = await window.appShell.pipelineStopLocalOpenclaw();
    addLog(`local-openclaw stop: ${next.status} ${next.detail}`);
    await refreshLocalStatus();
  }, [addLog, refreshLocalStatus]);

  const connectProviderOAuth = useCallback(async (provider: string) => {
    try {
      const result = await window.appShell.pipelineLaunchProviderOAuth({ provider });
      setOpenaiOauthSessionId(result.sessionId);
      setOauthProvider(result.provider ?? provider);
      setOpenaiOauthStatusText(result.detail);
      setOauthInputValue('');
      openedOpenAIOAuthUrlRef.current = '';
      if (result.authUrl) {
        openedOpenAIOAuthUrlRef.current = result.authUrl;
        await window.appShell.openExternalUrl(result.authUrl);
        addLog(`${provider} oauth: opened browser auth URL`);
      } else {
        addLog(`${provider} oauth: started; waiting for auth URL`);
      }
    } catch (error) {
      const message = String(error);
      if (message.includes("No handler registered for 'pipeline:launch-provider-oauth'")) {
        setOpenaiOauthStatusText("Provider OAuth handler unavailable in running main process. Restart Electron app.");
        addLog('provider oauth unavailable in current main process; restart app to load new IPC handlers');
        return;
      }
      setOpenaiOauthStatusText(message);
      addLog(`${provider} oauth start failed: ${message}`);
    }
  }, [addLog]);

  const checkOpenAIOAuthStatus = useCallback(async () => {
    if (!openaiOauthSessionId.trim()) return;
    const statusResp = await window.appShell.pipelineOAuthStatus({ sessionId: openaiOauthSessionId.trim() });
    if (!statusResp.found) {
      setOpenaiOauthStatusText('session not found');
      return;
    }
    if (statusResp.authUrl) {
      setOpenaiOauthStatusText(`${statusResp.status}: ${statusResp.detail ?? ''}`);
    } else {
      setOpenaiOauthStatusText(`${statusResp.status}: ${statusResp.detail ?? ''}`);
    }
    if (statusResp.status === 'completed') {
      addLog(`${statusResp.provider ?? oauthProvider} oauth completed profile=${statusResp.profileId ?? 'unknown'}`);
    }
  }, [addLog, oauthProvider, openaiOauthSessionId]);

  const submitOAuthInput = useCallback(async () => {
    const sessionId = openaiOauthSessionId.trim();
    const inputValue = oauthInputValue.trim();
    if (!sessionId || !inputValue) return;
    try {
      await window.appShell.pipelineOAuthSubmitInput({ sessionId, inputValue });
      setOauthInputValue('');
      addLog(`${oauthProvider} oauth input submitted`);
      await checkOpenAIOAuthStatus();
    } catch (error) {
      const message = String(error);
      setOpenaiOauthStatusText(message);
      addLog(`${oauthProvider} oauth input failed: ${message}`);
    }
  }, [addLog, checkOpenAIOAuthStatus, oauthInputValue, oauthProvider, openaiOauthSessionId]);

  const listAuthProfiles = useCallback(async () => {
    const profiles = await window.appShell.pipelineListAuthProfiles();
    setLocalAuthProfiles(profiles);
    addLog(`auth profiles: ${profiles.map((p) => `${p.profileId}(${p.type}${p.hasAccess ? ':access' : ''}${p.hasRefresh ? ':refresh' : ''})`).join(', ') || 'none'}`);
  }, [addLog]);

  const checkCloudSyncForLocalProfiles = useCallback(async () => {
    if (status !== 'connected') {
      addLog('cloud sync check skipped: websocket not connected');
      return;
    }
    const profiles = localAuthProfiles.length > 0 ? localAuthProfiles : await window.appShell.pipelineListAuthProfiles();
    if (profiles.length === 0) {
      setCloudSyncChecks([]);
      addLog('cloud sync check: no local auth profiles');
      return;
    }
    const checks: CloudSyncCheck[] = [];
    const profileById = new Map(profiles.map((p) => [p.profileId, p]));
    const grouped = new Map<string, Array<{
      profileId: string;
      cloudProvider: string;
      token: string;
      type: string;
      hasAccess: boolean;
      hasRefresh: boolean;
      expires: number | null;
    }>>();

    for (const profile of profiles) {
      try {
        const secret = await window.appShell.pipelineGetAuthProfileSecret({ profileId: profile.profileId });
        if (!secret.token) continue;
        const cloudProvider = toCloudProvider(secret.provider);
        const list = grouped.get(cloudProvider) ?? [];
        list.push({
          profileId: profile.profileId,
          cloudProvider,
          token: secret.token,
          type: profile.type,
          hasAccess: profile.hasAccess,
          hasRefresh: profile.hasRefresh,
          expires: profile.expires,
        });
        grouped.set(cloudProvider, list);
      } catch (error) {
        checks.push({
          profileId: profile.profileId,
          provider: profile.provider,
          status: 'error',
          detail: String(error),
        });
      }
    }

    const rankEntry = (entry: {
      type: string;
      hasAccess: boolean;
      hasRefresh: boolean;
      expires: number | null;
    }) => {
      const oauth = entry.type === 'oauth' ? 100 : 0;
      const refresh = entry.hasRefresh ? 10 : 0;
      const access = entry.hasAccess ? 5 : 0;
      const expiry = typeof entry.expires === 'number' ? entry.expires : 0;
      return oauth + refresh + access + expiry / 1_000_000_000_000;
    };

    for (const [provider, entries] of grouped.entries()) {
      const selected = [...entries].sort((a, b) => rankEntry(b) - rankEntry(a))[0];
      if (!selected) continue;
      try {
        const secret = await fetchCloudCredentialSecret(provider);
        const extraCount = entries.length - 1;
        const extraNote = extraCount > 0 ? `; ${extraCount} additional local profile(s) ignored` : '';
        if (!secret) {
          checks.push({
            profileId: selected.profileId,
            provider,
            status: 'missing-cloud',
            detail: `cloud token missing${extraNote}`,
          });
          continue;
        }
        const cloudToken = readAuthProfileToken(secret);
        if (!cloudToken) {
          checks.push({
            profileId: selected.profileId,
            provider,
            status: 'missing-cloud',
            detail: `cloud token missing${extraNote}`,
          });
          continue;
        }
        checks.push({
          profileId: selected.profileId,
          provider,
          status: cloudToken === selected.token ? 'in-sync' : 'mismatch',
          detail: cloudToken === selected.token ? `token matches${extraNote}` : `token differs${extraNote}`,
        });
      } catch (error) {
        const fallbackProfile = profileById.get(selected.profileId);
        const detail = String(error);
        checks.push({
          profileId: selected.profileId,
          provider: fallbackProfile?.provider ?? provider,
          status: detail.includes('404') || detail.toLowerCase().includes('not found')
            ? 'missing-cloud'
            : 'error',
          detail,
        });
      }
    }
    setCloudSyncChecks(checks);
    addLog(`cloud sync check completed: ${checks.length} profile(s)`);
  }, [addLog, fetchCloudCredentialSecret, localAuthProfiles, status]);

  const checkAuthStore = useCallback(async () => {
    const diag = await window.appShell.pipelineGetAuthStoreDiagnostics();
    const pathValue = diag.authStorePath || '(not set)';
    setAuthStoreStatusText(`path=${pathValue} exists=${String(diag.exists)} profiles=${diag.profileCount}`);
    addLog(`auth-store: exists=${String(diag.exists)} profiles=${diag.profileCount}`);
  }, [addLog]);

  const saveProviderToken = useCallback(async () => {
    const provider = tokenProvider.trim().toLowerCase();
    const tokenValueTrimmed = tokenValue.trim();
    if (!provider || !tokenValueTrimmed) return;
    const result = await window.appShell.pipelineSaveProviderToken({ provider, token: tokenValueTrimmed });
    if (status === 'connected') {
      const response = await pushCloudCredential(provider, tokenValueTrimmed);
      if (!response.ok || response.verified === false) {
        addLog(`cloud push failed provider=${provider}: ${response.reason || 'credentials push failed verification'}`);
      } else {
        addLog(`cloud push verified provider=${provider} fingerprint=${response.fingerprint ?? 'none'} txid=${response.txid}`);
      }
    }
    addLog(`local token saved provider=${provider} profile=${result.profileId}`);
    setTokenValue('');
  }, [addLog, pushCloudCredential, status, tokenProvider, tokenValue]);

  const deleteProviderToken = useCallback(async (provider: string) => {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) return;
    const localProviders = localProviderAliases(normalized);
    let localRemovedTotal = 0;
    for (const localProvider of localProviders) {
      try {
        const localResult = await window.appShell.pipelineDeleteProviderToken({ provider: localProvider });
        localRemovedTotal += localResult.removedCount ?? 0;
      } catch (error) {
        addLog(`delete-token: local ${localProvider} failed: ${String(error)}`);
      }
    }
    addLog(`delete-token: local ${normalized} aliases=[${localProviders.join(',')}] removed=${localRemovedTotal}`);

    const cloudProvider = toCloudProvider(normalized);
    try {
      const cloudResult = await deleteCloudCredential(cloudProvider);
      addLog(
        `delete-token: cloud ${cloudProvider} deleted=${String(cloudResult.deleted)} verified=${String(cloudResult.verified ?? false)} txid=${cloudResult.txid} reason=${cloudResult.reason || 'none'}`,
      );
    } catch (error) {
      addLog(`delete-token: cloud ${cloudProvider} failed: ${String(error)}`);
    }
    if (tokenProvider.trim().toLowerCase() === normalized) {
      setTokenValue('');
      await window.appShell.setSetting(tokenStorageKey(normalized), '');
    }
    await listAuthProfiles();
  }, [addLog, deleteCloudCredential, listAuthProfiles, tokenProvider, tokenStorageKey]);

  const upsertChannel = useCallback(async () => {
    const id = channelId.trim();
    if (!id) return;
    const config = channelType === 'webhook'
      ? { url: channelWebhookUrl.trim() }
      : {};
    const response = await sendRequest('channel.upsert', {
      channelId: id,
      type: channelType,
      config,
      isActive: true,
    });
    if (!response.ok) {
      throw new Error(response.error?.message || 'channel.upsert failed');
    }
    const payload = (response.payload ?? {}) as { channelId?: unknown };
    const resolvedId = typeof payload.channelId === 'string' ? payload.channelId : id;
    setChannelId(resolvedId);
    addLog(`phase3: channel upserted id=${resolvedId} type=${channelType}`);
  }, [addLog, channelId, channelType, channelWebhookUrl, sendRequest]);

  const connectTelegramChannel = useCallback(async () => {
    const botToken = telegramBotToken.trim();
    const chatId = telegramChatId.trim();
    if (!botToken || !chatId) {
      throw new Error('telegram bot token and chat id are required');
    }
    const nextChannelId = 'telegram-main';
    const response = await sendRequest('channel.upsert', {
      channelId: nextChannelId,
      type: 'telegram',
      config: { botToken, chatId },
      isActive: true,
    });
    if (!response.ok) {
      throw new Error(response.error?.message || 'telegram channel.upsert failed');
    }
    setChannelId(nextChannelId);
    setChannelType('telegram');
    setChannelTargetId(chatId);
    addLog(`phase3: telegram channel connected id=${nextChannelId}`);
  }, [addLog, sendRequest, telegramBotToken, telegramChatId]);

  const connectDiscordWebhookChannel = useCallback(async () => {
    const webhookUrl = discordWebhookUrl.trim();
    if (!webhookUrl) {
      throw new Error('discord webhook url is required');
    }
    const nextChannelId = 'discord-main';
    const response = await sendRequest('channel.upsert', {
      channelId: nextChannelId,
      type: 'discord',
      config: { webhookUrl },
      isActive: true,
    });
    if (!response.ok) {
      throw new Error(response.error?.message || 'discord channel.upsert failed');
    }
    setChannelId(nextChannelId);
    setChannelType('discord');
    setChannelTargetId('discord-webhook');
    addLog(`phase3: discord webhook channel connected id=${nextChannelId}`);
  }, [addLog, discordWebhookUrl, sendRequest]);

  const listChannels = useCallback(async () => {
    const response = await sendRequest('channel.list', {});
    if (!response.ok) {
      throw new Error(response.error?.message || 'channel.list failed');
    }
    const payload = (response.payload ?? {}) as { channels?: unknown };
    const channels = Array.isArray(payload.channels) ? payload.channels : [];
    const text = channels.map((ch) => JSON.stringify(ch)).join('\n');
    setChannelListText(text);
    addLog(`phase3: channel list count=${channels.length}`);
  }, [addLog, sendRequest]);

  const sendChannelMessage = useCallback(async () => {
    const response = await sendRequest('channel.send', {
      channelId: channelId.trim(),
      targetId: channelTargetId.trim(),
      payload: { text: channelText },
      idempotencyKey: makeId('channel-send'),
    });
    if (!response.ok) {
      throw new Error(response.error?.message || 'channel.send failed');
    }
    addLog(`phase3: channel.send queued for ${channelId}`);
  }, [addLog, channelId, channelTargetId, channelText, sendRequest]);

  useEffect(() => {
    return () => {
      disconnect('Unmounted');
    };
  }, [disconnect]);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const tenantId = orgId ?? userId;
      const clerkToken = await getPreferredClerkToken();
      if (clerkToken) {
        setToken((previous) => previous || clerkToken);
      }
      const next = await window.appShell.pipelineSetActiveUser({
        userId,
        tenantId,
        ...(clerkToken ? { clerkToken } : {}),
      });
      setLocalStatus(next);
      const runtime = await window.appShell.pipelineCheckOpenclawRuntime();
      setRuntimeCheck(runtime);
      addLog(`active local profile set for ${userId}`);
    })();
  }, [addLog, getPreferredClerkToken, orgId, userId]);

  useEffect(() => {
    void refreshLocalStatus();
  }, [refreshLocalStatus]);

  useEffect(() => {
    void checkLocalRuntime();
  }, [checkLocalRuntime]);

  useEffect(() => {
    if (!localStatus || localStatus.status !== 'running') return;
    const timer = window.setInterval(() => {
      void refreshLocalStatus();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [localStatus, refreshLocalStatus]);

  useEffect(() => {
    if (!organizationId && orgId) {
      setOrganizationId(orgId);
    }
  }, [orgId, organizationId]);

  useEffect(() => {
    if (!openaiOauthSessionId.trim()) return;
    const sessionId = openaiOauthSessionId.trim();
    let timer: number | null = null;

    const stopPolling = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    timer = window.setInterval(() => {
      void (async () => {
        const statusResp = await window.appShell.pipelineOAuthStatus({ sessionId });
        if (!statusResp.found) {
          setOpenaiOauthStatusText('session not found');
          stopPolling();
          return;
        }

        setOpenaiOauthStatusText(`${statusResp.status}: ${statusResp.detail ?? ''}`);

        const statusKey = `${statusResp.status}:${statusResp.profileId ?? ''}`;
        const previousStatusKey = oauthLastStatusRef.current.get(sessionId);
        const statusChanged = previousStatusKey !== statusKey;
        oauthLastStatusRef.current.set(sessionId, statusKey);

        if (statusResp.authUrl && openedOpenAIOAuthUrlRef.current !== statusResp.authUrl) {
          openedOpenAIOAuthUrlRef.current = statusResp.authUrl;
          await window.appShell.openExternalUrl(statusResp.authUrl);
          addLog(`${statusResp.provider ?? oauthProvider} oauth: opened browser auth URL`);
        }

        if (statusResp.status === 'completed' && statusResp.profileId) {
          const profileId = statusResp.profileId;
          if (!profileId) {
            return;
          }
          if (statusChanged) {
            addLog(`${statusResp.provider ?? oauthProvider} oauth completed profile=${profileId}`);
          }
          if (!syncedOAuthProfilesRef.current.has(profileId)) {
            syncedOAuthProfilesRef.current.add(profileId);
            void (async () => {
              try {
                const secret = await window.appShell.pipelineGetAuthProfileSecret({ profileId });
                const cloudProvider = toCloudProvider(secret.provider);
                setTokenProvider(cloudProvider);
                setTokenValue(secret.token);
                addLog(`token-sync: oauth completed locally for ${cloudProvider}; use manual push if cloud sync is needed`);
              } catch (error) {
                addLog(`token-sync: oauth auto-sync error ${String(error)}`);
              }
            })();
          }
          stopPolling();
        } else if (statusResp.status === 'failed') {
          stopPolling();
        }
      })().catch((error) => {
        setOpenaiOauthStatusText(`error: ${String(error)}`);
      });
    }, 1500);

    return () => {
      stopPolling();
      oauthLastStatusRef.current.delete(sessionId);
    };
  }, [addLog, oauthProvider, openaiOauthSessionId, status]);

  const phase1Complete = useMemo(() => phase.challengeSeen && phase.connectOk && phase.methodOk, [phase]);
  const phase2Complete = useMemo(
    () => phase.turnLeaseOk
      && phase.sessionUpsertOk
      && phase.appendOk
      && phase.historyOk
      && phase.idempotencyOk
      && phase.deviceRegisterOk
      && phase.nodeAuthOk
      && phase.nodeMethodOk
      && phase.catchupOk,
    [phase],
  );
  const logText = useMemo(() => logs.slice().reverse().join('\n'), [logs]);

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="openclaw-hosted-phase-page">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-10">
        <Card>
          <CardHeader>
            <CardTitle>OpenClaw Hosted Phase Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Validates Phase 1 and Phase 2 continuously:
              {' '}
              <code>connect.challenge</code> → <code>connect</code> auth → scoped methods →
              {' '}
              <code>turn.acquire</code>/<code>session.upsert</code>/<code>chat.append</code>/<code>chat.history</code>/<code>sync.catchup</code>.
              {' '}
              Also validates node pairing/auth via <code>device.register</code> + <code>/ws-node</code>.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-ws-url">WebSocket URL</label>
                <Input id="hosted-ws-url" value={wsUrl} onChange={(event) => setWsUrl(event.target.value)} placeholder="wss://ws.capzero.ai/ws" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-template">Clerk JWT template</label>
                <Input id="hosted-template" value={tokenTemplate} onChange={(event) => setTokenTemplate(event.target.value)} placeholder="openclaw" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-org-id">Organization ID</label>
                <Input id="hosted-org-id" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} placeholder="org_..." />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-token">Clerk JWT</label>
                <Input id="hosted-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="eyJ..." />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void activateOrganization()}>Set Active Organization</Button>
              <Button type="button" onClick={() => void fetchClerkToken()}>Use Clerk Session Token</Button>
              <Button type="button" onClick={() => void connect()}>Connect + Start Loop</Button>
              <Button type="button" variant="outline" onClick={() => disconnect('Stopped by user')}>Disconnect</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(status)}>{status}</Badge>
              <span className="text-xs text-muted-foreground select-text">{detail}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Connection status</div>
                <CopyableText text={status} />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Connection detail</div>
                <CopyableText text={detail} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local OpenClaw Runtime + Auth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={localStatus?.status === 'running' ? 'success' : (localStatus?.status === 'failed' ? 'warning' : 'muted')}>
                {localStatus?.status || 'unknown'}
              </Badge>
              <Badge variant={localStatus?.gatewayProbe?.reachable ? 'success' : 'warning'}>
                gateway: {localStatus?.gatewayProbe?.reachable ? 'reachable' : 'unreachable'}
              </Badge>
              <Badge variant={localStatus?.gatewayStatus?.ok ? 'success' : 'warning'}>
                status: {localStatus?.gatewayStatus?.ok ? 'ok' : 'error'}
              </Badge>
              <Badge variant={runtimeCheck?.hasRuntime ? 'success' : 'warning'}>
                runtime: {runtimeCheck?.hasRuntime ? 'found' : 'missing'}
              </Badge>
              <span className="text-xs text-muted-foreground select-text">{localStatus?.detail || 'No local runtime status yet.'}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Runtime Preflight</div>
                <CopyableText text={runtimeCheck?.detail || ''} mono />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Expected Runtime Paths</div>
                <CopyableText text={(runtimeCheck?.expectedPaths || []).join('\n')} mono />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Found Runtime Paths</div>
                <CopyableText text={(runtimeCheck?.foundPaths || []).join('\n')} mono />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Runtime Candidates</div>
                <CopyableText
                  text={(runtimeCheck?.candidates || []).map((candidate) => `${candidate.label} -> ${candidate.command}`).join('\n')}
                  mono
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Profile Root</div>
                <CopyableText text={localStatus?.profileRoot || ''} mono />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">State Dir</div>
                <CopyableText text={localStatus?.stateDir || ''} mono />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Config Path</div>
                <CopyableText text={localStatus?.configPath || ''} mono />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Launcher</div>
                <CopyableText text={localStatus?.launcherLabel || ''} mono />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Gateway Probe</div>
                <CopyableText text={localStatus?.gatewayProbe?.detail || ''} mono />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Gateway Status Command</div>
                <CopyableText text={localStatus?.gatewayStatus?.detail || ''} mono />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void startLocalOpenclaw()}>Start Local OpenClaw</Button>
              <Button type="button" variant="outline" onClick={() => void stopLocalOpenclaw()}>Stop Local OpenClaw</Button>
              <Button type="button" variant="outline" onClick={() => void refreshLocalStatus()}>Refresh Status</Button>
              <Button type="button" variant="outline" onClick={() => void checkLocalRuntime()}>Check Runtime</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void connectProviderOAuth('openai-codex')}>Start OpenAI OAuth</Button>
              <Button type="button" variant="outline" onClick={() => void connectProviderOAuth('anthropic')}>Start Anthropic OAuth</Button>
              <Button type="button" variant="outline" onClick={() => void connectProviderOAuth('google-gemini-cli')}>Start Gemini OAuth</Button>
              <Button type="button" variant="outline" onClick={() => void connectProviderOAuth('github-copilot')}>Start GitHub Copilot OAuth</Button>
              <Button type="button" variant="outline" onClick={() => void listAuthProfiles()}>List Local Auth Profiles</Button>
              <Button type="button" variant="outline" onClick={() => void checkAuthStore()}>Check Local Auth Store</Button>
              <Button type="button" variant="outline" onClick={() => void checkCloudSyncForLocalProfiles()}>Check Cloud Sync</Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">OAuth Session</div>
                <CopyableText text={openaiOauthSessionId} mono />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">OAuth Provider</div>
                <CopyableText text={oauthProvider} mono />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">OAuth Status</div>
                <CopyableText text={openaiOauthStatusText} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="text-[11px] font-medium text-muted-foreground">Auth Store Status</div>
                <CopyableText text={authStoreStatusText} mono />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <Input
                value={oauthInputValue}
                onChange={(event) => setOauthInputValue(event.target.value)}
                placeholder="Paste OAuth input"
              />
              <Button type="button" variant="outline" onClick={() => void checkOpenAIOAuthStatus()}>
                Check OAuth Status
              </Button>
              <Button type="button" onClick={() => void submitOAuthInput()}>
                Submit OAuth Input
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Local OpenClaw Runtime Logs</div>
              <CopyableText text={(localStatus?.logTail || []).slice().reverse().join('\n')} title="Copy local runtime logs" className="w-[260px]" mono />
              <div className="max-h-52 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs font-mono">
                {(localStatus?.logTail?.length || 0) === 0 ? <div className="text-muted-foreground">No runtime logs captured yet.</div> : null}
                {(localStatus?.logTail || []).slice().reverse().map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Gateway Status Output</div>
              <CopyableText text={localStatus?.gatewayStatus?.output || ''} title="Copy gateway status output" className="w-[260px]" mono />
              <div className="max-h-52 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs font-mono">
                {(localStatus?.gatewayStatus?.output || '').trim().length === 0
                  ? <div className="text-muted-foreground">No gateway status output yet.</div>
                  : <pre className="whitespace-pre-wrap break-words">{localStatus?.gatewayStatus?.output}</pre>}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Local Auth Profiles</div>
              <div className="max-h-44 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs select-text">
                {localAuthProfiles.length === 0 ? <div className="text-muted-foreground">No profiles loaded. Click "List Local Auth Profiles".</div> : null}
                {localAuthProfiles.map((profile) => (
                  <div key={profile.profileId} className="mb-1 flex items-center gap-2 font-mono">
                    <span>
                      {profile.profileId} | {profile.provider} | {profile.type}
                      {profile.hasAccess ? ' | access' : ''}{profile.hasRefresh ? ' | refresh' : ''}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() => void deleteProviderToken(profile.provider)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Cloud Sync Check</div>
              <div className="max-h-44 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs select-text">
                {cloudSyncChecks.length === 0 ? <div className="text-muted-foreground">No sync check results yet.</div> : null}
                {cloudSyncChecks.map((item) => (
                  <div key={`${item.profileId}-${item.provider}`} className="mb-1 font-mono">
                    {item.profileId} | {item.provider} | {item.status} | {item.detail}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phase Checks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            <Badge variant={phase.challengeSeen ? 'success' : 'muted'}>challenge</Badge>
            <Badge variant={phase.connectOk ? 'success' : 'muted'}>connect</Badge>
            <Badge variant={phase.methodOk ? 'success' : 'muted'}>method</Badge>
            <Badge variant={phase1Complete ? 'success' : 'warning'}>{phase1Complete ? 'phase1-pass' : 'phase1-incomplete'}</Badge>
            <Badge variant={phase.turnLeaseOk ? 'success' : 'muted'}>turn.lease</Badge>
            <Badge variant={phase.sessionUpsertOk ? 'success' : 'muted'}>session.upsert</Badge>
            <Badge variant={phase.appendOk ? 'success' : 'muted'}>chat.append</Badge>
            <Badge variant={phase.historyOk ? 'success' : 'muted'}>chat.history</Badge>
            <Badge variant={phase.idempotencyOk ? 'success' : 'muted'}>idempotency</Badge>
            <Badge variant={phase.deviceRegisterOk ? 'success' : 'muted'}>device.register</Badge>
            <Badge variant={phase.nodeAuthOk ? 'success' : 'muted'}>node.connect</Badge>
            <Badge variant={phase.nodeMethodOk ? 'success' : 'muted'}>node.ping</Badge>
            <Badge variant={phase.catchupOk ? 'success' : 'muted'}>sync.catchup</Badge>
            <Badge variant={phase2Complete ? 'success' : 'warning'}>{phase2Complete ? 'phase2-pass' : 'phase2-incomplete'}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resolved Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Tenant ID</div>
              <CopyableText text={identity?.tenantId || ''} mono />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Tenant Type</div>
              <CopyableText text={identity?.tenantType || ''} />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">User ID</div>
              <CopyableText text={identity?.userId || ''} mono />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Role</div>
              <CopyableText text={identity?.role || ''} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <div className="text-[11px] font-medium text-muted-foreground">Scopes</div>
              <CopyableText text={identity?.scopes.join(', ') || ''} mono />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Continuous Metrics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-4">
            <div>Total: {metrics.total}</div>
            <div>OK: {metrics.ok}</div>
            <div>Failed: {metrics.failed}</div>
            <div>Last RTT: {metrics.lastRttMs ?? '-'} ms</div>
          </CardContent>
        </Card>

        <ChatSurface />

        <Card>
          <CardHeader>
            <CardTitle>Token Sync Sandbox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-token-provider">Provider</label>
                <Input
                  id="hosted-token-provider"
                  value={tokenProvider}
                  onChange={(event) => setTokenProvider(event.target.value)}
                  placeholder="openai"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="hosted-token-value">Token</label>
                <Input
                  id="hosted-token-value"
                  type="password"
                  value={tokenValue}
                  onChange={(event) => setTokenValue(event.target.value)}
                  placeholder="provider token (test)"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setTokenProvider('openai')}>OpenAI</Button>
              <Button type="button" variant="outline" onClick={() => setTokenProvider('anthropic')}>Anthropic</Button>
              <Button type="button" variant="outline" onClick={() => setTokenProvider('gemini')}>Gemini</Button>
              <Button type="button" variant="outline" onClick={() => setTokenProvider('openrouter')}>OpenRouter</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void saveLocalToken()}>Save Local (settings)</Button>
              <Button type="button" variant="outline" onClick={() => void saveProviderToken()}>Save Local (openclaw auth)</Button>
              <Button type="button" onClick={() => void pushTokenToCloud()}>Push Local to Cloud</Button>
              <Button type="button" variant="outline" onClick={() => void pullTokenFromCloud()}>Pull Cloud to Local</Button>
              <Button type="button" variant="outline" onClick={() => void deleteProviderToken(tokenProvider)}>Delete Token (local + cloud)</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Uses tenant+user scoped keys locally and <code>token.sync.push/pull</code> in hosted gateway.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phase 3 Channel Sandbox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Telegram Bot Token</label>
                <Input
                  type="password"
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  placeholder="123456789:AA..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Telegram Chat ID</label>
                <Input
                  value={telegramChatId}
                  onChange={(event) => setTelegramChatId(event.target.value)}
                  placeholder="123456789"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Discord Webhook URL</label>
                <Input
                  value={discordWebhookUrl}
                  onChange={(event) => setDiscordWebhookUrl(event.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void connectTelegramChannel()}>Connect Telegram</Button>
              <Button type="button" variant="outline" onClick={() => void connectDiscordWebhookChannel()}>Connect Discord</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Channel ID</label>
                <Input value={channelId} onChange={(event) => setChannelId(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Channel Type</label>
                <Input value={channelType} onChange={(event) => setChannelType(event.target.value)} placeholder="webhook|telegram|slack|discord" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Webhook URL (for type=webhook)</label>
                <Input value={channelWebhookUrl} onChange={(event) => setChannelWebhookUrl(event.target.value)} placeholder="https://example.com/webhook" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Target ID</label>
                <Input value={channelTargetId} onChange={(event) => setChannelTargetId(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Message Text</label>
                <Input value={channelText} onChange={(event) => setChannelText(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void upsertChannel()}>Upsert Channel</Button>
              <Button type="button" variant="outline" onClick={() => void listChannels()}>List Channels</Button>
              <Button type="button" onClick={() => void sendChannelMessage()}>Queue channel.send</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For Telegram use bot token + chat ID. For Discord use webhook URL. After connect, click Queue channel.send to verify outbound worker delivery.
            </p>
            <div className="max-h-44 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs font-mono">
              {channelListText.trim().length === 0
                ? <div className="text-muted-foreground">No channel list result yet.</div>
                : <pre className="whitespace-pre-wrap break-words">{channelListText}</pre>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Event Log</CardTitle>
            <CopyableText text={logText} title="Copy all logs" className="w-[220px]" mono />
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs font-mono select-text">
              {logs.length === 0 ? <div className="text-muted-foreground">No logs yet.</div> : null}
              {logs.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
