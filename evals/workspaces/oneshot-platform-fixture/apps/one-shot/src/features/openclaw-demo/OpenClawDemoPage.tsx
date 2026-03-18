import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GatewayConnectionMode,
  GatewayNodeInfo,
  GatewayPushEvent,
  GatewayRemoteSettings,
  GatewayStateSnapshot,
} from '@/gateway/demoTypes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type DemoChatMessageRole = 'user' | 'assistant' | 'system';
type DemoChatMessageStatus = 'streaming' | 'final' | 'error' | 'aborted';

type DemoChatMessage = {
  id: string;
  runId?: string;
  role: DemoChatMessageRole;
  text: string;
  status: DemoChatMessageStatus;
  timestampMs: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function findRunMessageIndex(messages: DemoChatMessage[], runId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (current?.runId === runId && current.role === 'assistant') {
      return index;
    }
  }
  return -1;
}

function mergeStreamText(previous: string, incoming: string): string {
  if (!previous) return incoming;
  if (!incoming) return previous;
  if (incoming === previous) return incoming;
  if (incoming.startsWith(previous)) return incoming;
  if (incoming.includes(previous)) return incoming;
  if (previous.endsWith(incoming)) return previous;
  return `${previous}${incoming}`;
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isObject(part)) return '';
      if (asString(part.type).toLowerCase() !== 'text') return '';
      return asString(part.text);
    })
    .filter(Boolean)
    .join('');
}

function extractMessageText(message: unknown): string {
  if (!isObject(message)) return '';
  const directText = asString(message.text);
  if (directText) return directText;
  const contentText = extractContentText(message.content);
  if (contentText) return contentText;
  if (isObject(message.message)) return extractMessageText(message.message);
  return '';
}

function normalizeHistoryMessages(rawMessages: unknown[]): DemoChatMessage[] {
  const normalized: DemoChatMessage[] = [];
  for (const entry of rawMessages) {
    if (!isObject(entry)) continue;
    const roleRaw = asString(entry.role).toLowerCase();
    const role: DemoChatMessageRole =
      roleRaw === 'user' ? 'user' : roleRaw === 'assistant' ? 'assistant' : 'system';
    const text = extractMessageText(entry);
    if (!text.trim()) continue;
    const timestampValue = entry.timestamp;
    const timestampMs =
      typeof timestampValue === 'number' && Number.isFinite(timestampValue)
        ? timestampValue
        : Date.now();
    normalized.push({
      id: asString(entry.id) || makeId(`history-${role}`),
      role,
      text,
      status: 'final',
      timestampMs,
    });
  }
  return normalized;
}

function parseChatEventPayload(payload: unknown): {
  runId: string;
  sessionKey: string;
  state: string;
  text: string;
  errorMessage: string;
} | null {
  if (!isObject(payload)) return null;
  const runId = asString(payload.runId);
  const sessionKey = asString(payload.sessionKey) || 'main';
  const state = asString(payload.state).toLowerCase();
  if (!runId || !state) return null;
  return {
    runId,
    sessionKey,
    state,
    text: extractMessageText(payload.message),
    errorMessage: asString(payload.errorMessage),
  };
}

function processBadgeVariant(status: GatewayStateSnapshot['processStatus']) {
  switch (status) {
    case 'running-service':
    case 'running-child':
      return 'success';
    case 'starting':
    case 'stopping':
      return 'warning';
    case 'failed':
      return 'warning';
    default:
      return 'muted';
  }
}

function tunnelBadgeVariant(status: GatewayStateSnapshot['tunnelStatus']) {
  switch (status) {
    case 'running':
      return 'success';
    case 'starting':
      return 'warning';
    case 'failed':
      return 'warning';
    default:
      return 'muted';
  }
}

function connectionBadgeVariant(status: GatewayStateSnapshot['connectionStatus']) {
  switch (status) {
    case 'connected':
      return 'success';
    case 'connecting':
      return 'info';
    case 'degraded':
      return 'warning';
    default:
      return 'muted';
  }
}

function chatStatusBadgeVariant(status: DemoChatMessageStatus) {
  if (status === 'streaming') return 'info';
  if (status === 'error' || status === 'aborted') return 'warning';
  return 'muted';
}

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

export function OpenClawDemoPage() {
  const [gatewayState, setGatewayState] = useState<GatewayStateSnapshot | null>(null);
  const [lastAction, setLastAction] = useState('No action yet.');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // UI mode selector — separate from the live connectionMode in state
  const [uiMode, setUiMode] = useState<GatewayConnectionMode>('local');

  // Remote settings form state
  const [remoteSettings, setRemoteSettings] = useState<GatewayRemoteSettings>(DEFAULT_REMOTE_SETTINGS);
  const [remoteSettingsLoaded, setRemoteSettingsLoaded] = useState(false);

  const [devices, setDevices] = useState<GatewayNodeInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');

  const [sessionKey, setSessionKey] = useState('main');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<DemoChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const sessionKeyRef = useRef(sessionKey);
  const latestConnectionStatusRef = useRef<GatewayStateSnapshot['connectionStatus'] | null>(null);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  // Load saved remote settings on mount
  useEffect(() => {
    void (async () => {
      try {
        const saved = await window.appShell.gatewayGetRemoteSettings();
        if (saved) setRemoteSettings(saved);
      } catch {
        // use defaults
      } finally {
        setRemoteSettingsLoaded(true);
      }
    })();
  }, []);

  const fetchGatewayState = useCallback(async () => {
    const snapshot = await window.appShell.gatewayGetState();
    setGatewayState(snapshot);
    // Sync UI mode to current live mode when state loads
    if (snapshot.connectionMode) setUiMode(snapshot.connectionMode);
    return snapshot;
  }, []);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError('');
    try {
      const response = await window.appShell.gatewayGetDevices();
      setDevices(response.nodes ?? []);
      setLastAction(`node.list loaded (${(response.nodes ?? []).length} device(s)).`);
    } catch (error) {
      const message = String(error);
      setDevicesError(message);
      setLastAction(`node.list failed: ${message}`);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadChatHistory = useCallback(async () => {
    const key = sessionKeyRef.current || 'main';
    setChatLoading(true);
    setChatError('');
    try {
      const response = await window.appShell.gatewayGetChatHistory({ sessionKey: key, limit: 80 });
      const nextMessages = normalizeHistoryMessages(response.messages ?? []);
      setChatMessages(nextMessages);
      setActiveRunId(null);
      setLastAction(`chat.history loaded (${nextMessages.length} message(s)) for "${key}".`);
    } catch (error) {
      const message = String(error);
      setChatError(message);
      setLastAction(`chat.history failed: ${message}`);
    } finally {
      setChatLoading(false);
    }
  }, []);

  const onGatewayEvent = useCallback((event: GatewayPushEvent) => {
    if (event.type !== 'chat') return;

    const parsed = parseChatEventPayload(event.payload);
    if (!parsed || parsed.sessionKey !== sessionKeyRef.current) return;

    setChatMessages((previous) => {
      const index = findRunMessageIndex(previous, parsed.runId);

      if (parsed.state === 'delta') {
        if (!parsed.text.trim()) return previous;
        if (index < 0) {
          return [
            ...previous,
            {
              id: makeId('assistant'),
              runId: parsed.runId,
              role: 'assistant',
              text: parsed.text,
              status: 'streaming',
              timestampMs: Date.now(),
            },
          ];
        }
        const next = [...previous];
        const current = next[index];
        next[index] = { ...current, text: mergeStreamText(current.text, parsed.text), status: 'streaming', timestampMs: Date.now() };
        return next;
      }

      if (parsed.state === 'final') {
        if (index < 0 && !parsed.text.trim()) return previous;
        if (index < 0) {
          return [...previous, { id: makeId('assistant-final'), runId: parsed.runId, role: 'assistant', text: parsed.text, status: 'final', timestampMs: Date.now() }];
        }
        const next = [...previous];
        const current = next[index];
        next[index] = { ...current, text: parsed.text.trim() ? parsed.text : current.text, status: 'final', timestampMs: Date.now() };
        return next;
      }

      if (parsed.state === 'error') {
        const detail = parsed.errorMessage || 'Gateway reported chat error.';
        if (index < 0) {
          return [...previous, { id: makeId('assistant-error'), runId: parsed.runId, role: 'system', text: detail, status: 'error', timestampMs: Date.now() }];
        }
        const next = [...previous];
        next[index] = { ...next[index], status: 'error', text: detail, timestampMs: Date.now() };
        return next;
      }

      if (parsed.state === 'aborted') {
        if (index < 0) return previous;
        const next = [...previous];
        next[index] = { ...next[index], status: 'aborted', text: next[index].text || 'Run aborted.', timestampMs: Date.now() };
        return next;
      }

      return previous;
    });

    if (parsed.state === 'final' || parsed.state === 'error' || parsed.state === 'aborted') {
      setActiveRunId((current) => (current === parsed.runId ? null : current));
    }
  }, []);

  useEffect(() => {
    void fetchGatewayState();
    const unsubscribeState = window.appShell.onGatewayState((snapshot) => {
      setGatewayState(snapshot);
    });
    const unsubscribeEvent = window.appShell.onGatewayEvent(onGatewayEvent);
    return () => {
      unsubscribeState?.();
      unsubscribeEvent?.();
    };
  }, [fetchGatewayState, onGatewayEvent]);

  useEffect(() => {
    const current = gatewayState?.connectionStatus ?? null;
    const previous = latestConnectionStatusRef.current;
    latestConnectionStatusRef.current = current;
    if (current !== 'connected' || previous === 'connected') return;
    void loadDevices();
    void loadChatHistory();
  }, [gatewayState?.connectionStatus, loadDevices, loadChatHistory]);

  const runAction = useCallback(async (actionName: string, run: () => Promise<GatewayStateSnapshot>) => {
    setBusyAction(actionName);
    try {
      const snapshot = await run();
      setGatewayState(snapshot);
      setLastAction(`${actionName}: ${snapshot.processDetail || snapshot.connectionDetail}`);
      return snapshot;
    } catch (error) {
      const message = String(error);
      setLastAction(`${actionName} failed: ${message}`);
      throw error;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const onEnableOpenclaw = useCallback(async () => {
    try {
      await runAction('Enable OpenClaw', async () => await window.appShell.gatewayEnableOpenclaw());
    } catch { /* runAction updates UI */ }
  }, [runAction]);

  const onDisableOpenclaw = useCallback(async () => {
    try {
      await runAction('Disable OpenClaw', async () => await window.appShell.gatewayDisableOpenclaw());
    } catch { /* runAction updates UI */ }
  }, [runAction]);

  const onConnect = useCallback(async () => {
    try {
      await runAction('Connect', async () => await window.appShell.gatewayConnect());
    } catch { /* runAction updates UI */ }
  }, [runAction]);

  const onConnectRemote = useCallback(async () => {
    // Derive transport from the UI mode so it's always correct regardless of form state.
    const transport = uiMode === 'remote-direct' ? 'direct' : 'ssh';
    const settings: GatewayRemoteSettings = { ...remoteSettings, transport };
    try {
      await runAction('Connect Remote', async () => await window.appShell.gatewayConnectRemote(settings));
    } catch { /* runAction updates UI */ }
  }, [runAction, remoteSettings, uiMode]);

  const onDisconnect = useCallback(async () => {
    try {
      await runAction('Disconnect', async () => await window.appShell.gatewayDisconnect());
    } catch { /* runAction updates UI */ }
  }, [runAction]);

  const onSendChat = useCallback(async () => {
    const message = chatInput.trim();
    if (!message) return;
    const key = sessionKeyRef.current || 'main';

    setChatError('');
    setChatInput('');
    setChatMessages((previous) => [
      ...previous,
      { id: makeId('user'), role: 'user', text: message, status: 'final', timestampMs: Date.now() },
    ]);

    try {
      const response = await window.appShell.gatewaySendChat({ sessionKey: key, message });
      setActiveRunId(response.runId);
      setLastAction(`chat.send started run ${response.runId}`);
    } catch (error) {
      const detail = String(error);
      setChatError(detail);
      setChatMessages((previous) => [
        ...previous,
        { id: makeId('send-error'), role: 'system', text: `chat.send failed: ${detail}`, status: 'error', timestampMs: Date.now() },
      ]);
      setLastAction(`chat.send failed: ${detail}`);
    }
  }, [chatInput]);

  const onAbortChat = useCallback(async () => {
    const key = sessionKeyRef.current || 'main';
    try {
      const response = await window.appShell.gatewayAbortChat({
        sessionKey: key,
        ...(activeRunId ? { runId: activeRunId } : {}),
      });
      setLastAction(response.aborted
        ? `chat.abort requested for "${key}"${activeRunId ? ` run ${activeRunId}` : ''}.`
        : 'chat.abort returned without aborting an active run.');
    } catch (error) {
      const detail = String(error);
      setChatError(detail);
      setLastAction(`chat.abort failed: ${detail}`);
    }
  }, [activeRunId]);

  const patchRemote = useCallback((patch: Partial<GatewayRemoteSettings>) => {
    setRemoteSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const effectiveState = gatewayState;
  const processStatus = effectiveState?.processStatus ?? 'stopped';
  const processDetail = effectiveState?.processDetail ?? 'OpenClaw is disabled.';
  const tunnelStatus = effectiveState?.tunnelStatus ?? 'stopped';
  const tunnelDetail = effectiveState?.tunnelDetail ?? '';
  const connectionStatus = effectiveState?.connectionStatus ?? 'disconnected';
  const connectionDetail = effectiveState?.connectionDetail ?? 'Gateway socket disconnected.';
  const activityLabel = effectiveState?.activity?.label || 'Idle';
  const healthSummary = effectiveState?.health.summary || 'Health pending.';
  const isLocalRunning = processStatus === 'running-service' || processStatus === 'running-child';
  const isConnected = connectionStatus === 'connected';
  const isBusy = busyAction !== null;
  const lastError = connectionStatus === 'degraded' ? connectionDetail : '';

  const chatMessagesView = useMemo(
    () =>
      chatMessages.map((message) => {
        const toneClass =
          message.role === 'user'
            ? 'border-blue-500/30 bg-blue-500/5'
            : message.role === 'assistant'
              ? 'border-border bg-background'
              : 'border-amber-500/40 bg-amber-500/10';
        return (
          <div key={message.id} className={`rounded-md border px-3 py-2 text-sm ${toneClass}`}>
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium capitalize">{message.role}</span>
              <Badge variant={chatStatusBadgeVariant(message.status)}>{message.status}</Badge>
              {message.runId ? (
                <span className="truncate text-xs text-muted-foreground">run: {message.runId}</span>
              ) : null}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{message.text}</pre>
          </div>
        );
      }),
    [chatMessages],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="openclaw-demo-page">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 pb-8">
        <div>
          <h1 className="text-lg font-semibold">OpenClaw Gateway</h1>
          <p className="text-sm text-muted-foreground">
            Connect to a local or remote OpenClaw gateway to enable AI agent capabilities.
          </p>
        </div>

        {/* Mode selector */}
        <Card>
          <CardHeader>
            <CardTitle>Connection Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {(['local', 'remote-ssh', 'remote-direct'] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={uiMode === mode ? 'default' : 'outline'}
                  onClick={() => setUiMode(mode)}
                  disabled={isBusy}
                >
                  {mode === 'local' ? 'Local' : mode === 'remote-ssh' ? 'Remote (SSH Tunnel)' : 'Remote (Direct)'}
                </Button>
              ))}
            </div>

            {/* Local controls */}
            {uiMode === 'local' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Manage a local OpenClaw gateway process. Uses <code className="font-mono">openclaw gateway run</code> on this machine.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void (isLocalRunning ? onDisableOpenclaw() : onEnableOpenclaw())}
                    disabled={isBusy}
                  >
                    {busyAction === 'Enable OpenClaw' || busyAction === 'Disable OpenClaw'
                      ? 'Working…'
                      : isLocalRunning ? 'Disable OpenClaw' : 'Enable OpenClaw'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onConnect()}
                    disabled={isBusy}
                  >
                    {busyAction === 'Connect' ? 'Connecting…' : 'Connect WS'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onDisconnect()}
                    disabled={isBusy}
                  >
                    Disconnect
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Process:</span>
                  <Badge variant={processBadgeVariant(processStatus)}>{processStatus}</Badge>
                  <span className="select-text break-all text-xs text-muted-foreground">{processDetail}</span>
                </div>
              </div>
            )}

            {/* Remote SSH controls */}
            {uiMode === 'remote-ssh' && remoteSettingsLoaded && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Connects via <code className="font-mono">ssh -N -L</code> port forwarding to the remote OpenClaw gateway.
                  The SSH key must allow passwordless login (BatchMode).
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="ssh-target">
                      SSH Target <span className="text-muted-foreground font-normal">(user@host)</span>
                    </label>
                    <Input
                      id="ssh-target"
                      value={remoteSettings.sshTarget}
                      onChange={(e) => patchRemote({ sshTarget: e.target.value })}
                      placeholder="user@gateway-host"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="ssh-port">
                      SSH Port
                    </label>
                    <Input
                      id="ssh-port"
                      type="number"
                      value={remoteSettings.sshPort}
                      onChange={(e) => patchRemote({ sshPort: Number(e.target.value) || 22 })}
                      placeholder="22"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="identity-file">
                      Identity File <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="identity-file"
                      value={remoteSettings.identityFile}
                      onChange={(e) => patchRemote({ identityFile: e.target.value })}
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-gateway-port">
                      Remote Gateway Port
                    </label>
                    <Input
                      id="remote-gateway-port"
                      type="number"
                      value={remoteSettings.remoteGatewayPort}
                      onChange={(e) => patchRemote({ remoteGatewayPort: Number(e.target.value) || 18789 })}
                      placeholder="18789"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-token">
                      Token <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="remote-token"
                      value={remoteSettings.token}
                      onChange={(e) => patchRemote({ token: e.target.value })}
                      placeholder="gateway auth token"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-password">
                      Password <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="remote-password"
                      type="password"
                      value={remoteSettings.password}
                      onChange={(e) => patchRemote({ password: e.target.value })}
                      placeholder="gateway auth password"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void onConnectRemote()}
                    disabled={isBusy || !remoteSettings.sshTarget.trim()}
                  >
                    {busyAction === 'Connect Remote' ? 'Connecting…' : 'Connect'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onDisconnect()}
                    disabled={isBusy}
                  >
                    Disconnect
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Tunnel:</span>
                  <Badge variant={tunnelBadgeVariant(tunnelStatus)}>{tunnelStatus}</Badge>
                  {tunnelDetail ? <span className="select-text break-all text-xs text-muted-foreground">{tunnelDetail}</span> : null}
                </div>
              </div>
            )}

            {/* Remote Direct controls */}
            {uiMode === 'remote-direct' && remoteSettingsLoaded && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Connects directly to a remote gateway via WebSocket. Use <code className="font-mono">wss://</code> for TLS.
                  Plain <code className="font-mono">ws://</code> is only allowed for loopback addresses.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="col-span-full space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="remote-url">
                      Remote Gateway URL
                    </label>
                    <Input
                      id="remote-url"
                      value={remoteSettings.remoteUrl}
                      onChange={(e) => patchRemote({ remoteUrl: e.target.value, transport: 'direct' })}
                      placeholder="wss://gateway-host:18789"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="direct-token">
                      Token <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="direct-token"
                      value={remoteSettings.token}
                      onChange={(e) => patchRemote({ token: e.target.value })}
                      placeholder="gateway auth token"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="direct-password">
                      Password <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      id="direct-password"
                      type="password"
                      value={remoteSettings.password}
                      onChange={(e) => patchRemote({ password: e.target.value })}
                      placeholder="gateway auth password"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void onConnectRemote()}
                    disabled={isBusy || !remoteSettings.remoteUrl.trim()}
                  >
                    {busyAction === 'Connect Remote' ? 'Connecting…' : 'Connect'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onDisconnect()}
                    disabled={isBusy}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            )}

            <p className="select-text break-all text-xs text-muted-foreground">Last action: {lastAction}</p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Connection status */}
          <Card data-testid="gateway-connection-section">
            <CardHeader>
              <CardTitle>Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <Badge variant={connectionBadgeVariant(connectionStatus)}>{connectionStatus}</Badge>
              </div>
              <p className="select-text break-all text-xs text-muted-foreground">{connectionDetail}</p>
              <div>
                <p className="text-xs font-medium">Health</p>
                <p className="select-text break-all text-xs text-muted-foreground">{healthSummary}</p>
              </div>
              {lastError ? (
                <p className="select-text break-all rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                  {lastError}
                </p>
              ) : null}
              <div className="select-text space-y-0.5 break-all text-xs text-muted-foreground">
                <p>Config: {effectiveState?.config.configPath || '(unknown)'}</p>
                <p>WS URL: {effectiveState?.config.wsUrl || 'ws://127.0.0.1:18789'}</p>
                <p>Mode: {effectiveState?.connectionMode ?? '—'}</p>
              </div>
            </CardContent>
          </Card>

          {/* Activity */}
          <Card data-testid="gateway-activity-section">
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Current:</span>
                <Badge variant={activityLabel === 'Idle' ? 'muted' : 'info'}>{activityLabel}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Session: {effectiveState?.activity?.sessionKey || 'main'}
              </p>
              <p className="text-xs text-muted-foreground">
                Updated:{' '}
                {effectiveState?.activity?.updatedAtMs
                  ? new Date(effectiveState.activity.updatedAtMs).toLocaleTimeString()
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Connected devices */}
        <Card data-testid="connected-devices-section">
          <CardHeader>
            <CardTitle>Connected Devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDevices()}
                disabled={devicesLoading || !isConnected}
              >
                {devicesLoading ? 'Loading…' : 'Refresh devices'}
              </Button>
              <span className="text-xs text-muted-foreground">Source: node.list</span>
            </div>
            {devicesError ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{devicesError}</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs" data-testid="connected-devices-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Display Name</th>
                    <th className="px-2 py-2 font-medium">Node ID</th>
                    <th className="px-2 py-2 font-medium">Platform</th>
                    <th className="px-2 py-2 font-medium">Version</th>
                    <th className="px-2 py-2 font-medium">Paired</th>
                    <th className="px-2 py-2 font-medium">Connected</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-muted-foreground" colSpan={6}>
                        No devices returned yet.
                      </td>
                    </tr>
                  ) : (
                    devices.map((device) => (
                      <tr key={device.nodeId} className="border-b align-top">
                        <td className="px-2 py-2">{device.displayName || '—'}</td>
                        <td className="px-2 py-2 font-mono text-[11px]">{device.nodeId}</td>
                        <td className="px-2 py-2">{device.platform || '—'}</td>
                        <td className="px-2 py-2">{device.version || '—'}</td>
                        <td className="px-2 py-2">{device.paired === true ? 'yes' : device.paired === false ? 'no' : '—'}</td>
                        <td className="px-2 py-2">{device.connected === true ? 'yes' : device.connected === false ? 'no' : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Chat */}
        <Card data-testid="basic-chat-section">
          <CardHeader>
            <CardTitle>Chat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <label className="mt-2 text-xs text-muted-foreground" htmlFor="openclaw-session-key">
                Session key
              </label>
              <Input
                id="openclaw-session-key"
                value={sessionKey}
                onChange={(event) => setSessionKey(event.target.value)}
                placeholder="main"
                data-testid="openclaw-session-key"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadChatHistory()}
                disabled={chatLoading}
              >
                {chatLoading ? 'Loading…' : 'Load history'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void onAbortChat()}
                disabled={!isConnected}
              >
                Stop run
              </Button>
              <span className="text-xs text-muted-foreground">
                Active run: {activeRunId || 'none'}
              </span>
            </div>
            {chatError ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                {chatError}
              </p>
            ) : null}
            <div
              className="max-h-[340px] min-h-[180px] space-y-2 overflow-auto rounded-md border bg-muted/20 p-2"
              data-testid="openclaw-chat-log"
            >
              {chatMessages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No chat messages loaded yet.</p>
              ) : (
                chatMessagesView
              )}
            </div>
            <div className="space-y-2">
              <Textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Send a message…"
                rows={3}
                data-testid="openclaw-chat-input"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void onSendChat()}
                  disabled={!chatInput.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
