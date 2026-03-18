import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyableText } from '@/components/ui/copyable-text';
import { Input } from '@/components/ui/input';
import { PageContentContainer } from '@/features/app/PageContentContainer';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { GatewayPushEvent, GatewayStateSnapshot } from '@/gateway/demoTypes';
import { getAppCapabilities } from '@/lib/appCapabilities';

type DebugResponse = {
  ok: boolean;
  reason?: string;
  payload?: unknown;
};

type EventFeedEntry = {
  id: string;
  ts: number;
  type: string;
  event: string;
  summary: string;
};

type TokenSyncAuditEntry = {
  ts: number;
  level: string;
  event: string;
  opId: string;
  source: string;
  provider: string;
  tokenKind: string | null;
  verified: boolean | null;
  hasToken: boolean | null;
  fingerprint: string | null;
  error: string | null;
  raw: string;
};

type HealthCheckResult = {
  status: 'idle' | 'checking' | 'ok' | 'error';
  port: number | null;
  httpOk: boolean | null;
  httpBody: Record<string, unknown> | null;
  wsStatus: string | null;
  cloudProcessStatus: string | null;
  cloudOwnership: string | null;
  error: string | null;
  checkedAtMs: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseWsPort(urlLike: string): number | null {
  const trimmed = urlLike.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.port) {
      const explicit = Number(parsed.port);
      return Number.isFinite(explicit) && explicit > 0 ? explicit : null;
    }
    if (parsed.protocol === 'wss:') return 443;
    if (parsed.protocol === 'ws:') return 80;
    return null;
  } catch {
    return null;
  }
}

function formatTs(value: unknown): string {
  const timestamp = asNumber(value);
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}

function summarizeEvent(event: GatewayPushEvent): string {
  const payload = asObject(event.payload);
  if (!payload) return 'no payload';
  if (event.type === 'chat') {
    return `${asString(payload.state) || 'state?'} ${asString(payload.sessionKey) || ''}`.trim();
  }
  if (event.type === 'agent') {
    return `${asString(payload.stream) || 'stream?'} ${asString(payload.sessionKey) || ''}`.trim();
  }
  return Object.keys(payload).slice(0, 4).join(', ') || 'payload';
}

function connectionVariant(status: GatewayStateSnapshot['connectionStatus'] | null) {
  if (status === 'connected') return 'success';
  if (status === 'connecting') return 'info';
  if (status === 'degraded') return 'warning';
  return 'muted';
}

function healthStatusVariant(status: HealthCheckResult['status']) {
  if (status === 'ok') return 'success' as const;
  if (status === 'error') return 'warning' as const;
  if (status === 'checking') return 'info' as const;
  return 'muted' as const;
}

function cloudProcessVariant(status: string | null) {
  if (status === 'online' || status === 'external') return 'success' as const;
  if (status === 'launching') return 'info' as const;
  if (status === 'stopped' || status === 'blocked' || status === 'error') return 'warning' as const;
  return 'muted' as const;
}

export function CloudInspectorPage() {
  const { getToken } = useAuth();
  const capabilities = useMemo(() => getAppCapabilities(), []);
  const isWebRuntime = capabilities.platform === 'web';
  const [limitInput, setLimitInput] = useState('20');
  const [sessionIdFilter, setSessionIdFilter] = useState('');
  const [includeR2, setIncludeR2] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [gatewayState, setGatewayState] = useState<GatewayStateSnapshot | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<unknown>(null);
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [eventFeed, setEventFeed] = useState<EventFeedEntry[]>([]);
  const [health, setHealth] = useState<HealthCheckResult>({
    status: 'idle',
    port: null,
    httpOk: null,
    httpBody: null,
    wsStatus: null,
    cloudProcessStatus: null,
    cloudOwnership: null,
    error: null,
    checkedAtMs: null,
  });

  // ── Cloud health check ─────────────────────────────────────────────────────

  const runHealthCheck = useCallback(async () => {
    setHealth((prev) => ({ ...prev, status: 'checking' }));

    try {
      if (isWebRuntime) {
        const gState = await window.appShell.gatewayGetState();
        setGatewayState(gState);
        const configuredPort = parseWsPort(gState.config.wsUrl || '');
        const endpointConfigured = Boolean((gState.config.wsUrl || '').trim());
        setHealth({
          status: endpointConfigured ? (gState.connectionStatus === 'connected' ? 'ok' : 'error') : 'idle',
          port: configuredPort,
          httpOk: null,
          httpBody: null,
          wsStatus: gState.connectionStatus ?? null,
          cloudProcessStatus: null,
          cloudOwnership: null,
          error: endpointConfigured ? gState.lastCloudConnectError : 'Cloud websocket URL is not configured for web runtime.',
          checkedAtMs: Date.now(),
        });
        return;
      }

      // Resolve cloud port:
      // 1) orchestrator-assigned port when cloud is running there
      // 2) explicit dev-local WS override setting
      // 3) VITE_ONESHOT_WS_URL
      // 4) fallback 8789
      const statusResult = await window.appShell.devOrchestratorStatusCurrentWorktree();
      const orchestratorPort = statusResult.row?.ports.cloudPort ?? null;
      const cloudProcessStatus = statusResult.row?.status.cloud ?? null;
      const cloudOwnership = statusResult.cloudOwnership ?? null;
      const orchestratorRunning = cloudProcessStatus === 'online'
        || cloudProcessStatus === 'launching'
        || cloudProcessStatus === 'external';
      let configuredPort: number | null = null;
      const devLocalWsOverride = await window.appShell.getSetting('gateway.devLocalWsUrl');
      if (typeof devLocalWsOverride === 'string') {
        configuredPort = parseWsPort(devLocalWsOverride);
      }
      if (!configuredPort) {
        configuredPort = parseWsPort(import.meta.env.VITE_ONESHOT_WS_URL || '');
      }

      const cloudPort = orchestratorRunning && orchestratorPort ? orchestratorPort : (configuredPort ?? 8789);

      // HTTP health check via main process (avoids renderer CORS issues)
      let httpOk: boolean | null = null;
      let httpBody: Record<string, unknown> | null = null;
      let httpError: string | null = null;
      try {
        const probe = await window.appShell.devOrchestratorCloudHealthProbe({ port: cloudPort });
        httpOk = probe.ok;
        httpBody = probe.body ?? null;
        if (probe.error) httpError = probe.error;
      } catch (err) {
        httpOk = false;
        httpError = String(err);
      }

      // WS connection status from gateway service
      const gState = await window.appShell.gatewayGetState();
      setGatewayState(gState);
      const wsStatus = gState.connectionStatus ?? null;

      setHealth({
        status: httpOk ? 'ok' : 'error',
        port: cloudPort,
        httpOk,
        httpBody,
        wsStatus,
        cloudProcessStatus,
        cloudOwnership,
        error: httpError,
        checkedAtMs: Date.now(),
      });
    } catch (err) {
      setHealth((prev) => ({
        ...prev,
        status: 'error',
        error: String(err),
        checkedAtMs: Date.now(),
      }));
    }
  }, [isWebRuntime]);

  // ── DO snapshot ───────────────────────────────────────────────────────────

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    const limit = Number.parseInt(limitInput, 10);
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const payload: { limit: number; includeR2: boolean; sessionId?: string } = {
      limit: effectiveLimit,
      includeR2,
    };
    if (sessionIdFilter.trim()) {
      payload.sessionId = sessionIdFilter.trim();
    }
    try {
      if (isWebRuntime) {
        const nextState = await window.appShell.gatewayGetState();
        setGatewayState(nextState);
        if (nextState.connectionStatus !== 'connected') {
          setDebugSnapshot(null);
          return;
        }
      }
      const [nextState, snapshot] = await Promise.all([
        window.appShell.gatewayGetState(),
        window.appShell.gatewayDebugCloudSnapshot(payload) as Promise<DebugResponse>,
      ]);
      setGatewayState(nextState);
      if (!snapshot.ok) {
        setDebugSnapshot(null);
        setFetchError(snapshot.reason || 'debug snapshot failed');
        return;
      }
      setDebugSnapshot(snapshot.payload ?? null);
    } catch (error) {
      setFetchError(String(error));
      setDebugSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [includeR2, isWebRuntime, limitInput, sessionIdFilter]);

  const handleConnectCloud = useCallback(async () => {
    setConnecting(true);
    try {
      let token: string | null = null;
      try {
        token = await getToken({ template: 'openclaw' });
      } catch {
        token = null;
      }
      if (!token) token = await getToken();
      if (!token) {
        setFetchError('No Clerk token available — are you signed in?');
        return;
      }
      await window.appShell.gatewayConnectCloud({ token });
      setTimeout(() => {
        void fetchSnapshot();
        void runHealthCheck();
      }, 2000);
    } catch (error) {
      setFetchError(`Cloud connect failed: ${String(error)}`);
    } finally {
      setConnecting(false);
    }
  }, [getToken, fetchSnapshot, runHealthCheck]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    void fetchSnapshot();
    void runHealthCheck();
  }, [fetchSnapshot, runHealthCheck]);

  useEffect(() => {
    const unsubscribe = window.appShell.onGatewayEvent((event) => {
      const entry: EventFeedEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        ts: event.ts,
        type: event.type,
        event: event.event,
        summary: summarizeEvent(event),
      };
      setEventFeed((previous) => [entry, ...previous].slice(0, 80));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchSnapshot();
      void runHealthCheck();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchSnapshot, runHealthCheck]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const parsed = useMemo(() => asObject(debugSnapshot), [debugSnapshot]);
  const context = asObject(parsed?.context);
  const doSection = asObject(parsed?.do);
  const sqlite = asObject(doSection?.sqlite);
  const kv = asObject(doSection?.kv);
  const d1 = asObject(parsed?.d1);
  const channels = asObject(d1?.channels);
  const jobs = asObject(d1?.jobs);

  const sessions = Array.isArray(sqlite?.sessions)
    ? (sqlite.sessions as Array<Record<string, unknown>>)
    : [];
  const tokens = Array.isArray(kv?.tokens)
    ? (kv.tokens as Array<Record<string, unknown>>)
    : [];
  const r2 = Array.isArray(doSection?.r2)
    ? (doSection.r2 as Array<Record<string, unknown>>)
    : [];
  const recentChannels = Array.isArray(channels?.recent)
    ? (channels.recent as Array<Record<string, unknown>>)
    : [];
  const jobsByStatus = Array.isArray(jobs?.byStatus)
    ? (jobs.byStatus as Array<Record<string, unknown>>)
    : [];
  const recentFailedJobs = Array.isArray(jobs?.recentFailed)
    ? (jobs.recentFailed as Array<Record<string, unknown>>)
    : [];
  const activityLog = Array.isArray(parsed?.activityLog)
    ? (parsed.activityLog as Array<{ ts: number; level: string; msg: string }>)
    : [];
  const tokenSyncAudit = useMemo<TokenSyncAuditEntry[]>(() => {
    const rows: TokenSyncAuditEntry[] = [];
    for (const entry of activityLog) {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(entry.msg) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      if (!payload || payload.domain !== 'token.sync') {
        continue;
      }
      const parsedTs = typeof payload.ts === 'string' ? Date.parse(payload.ts) : Number.NaN;
      rows.push({
        ts: Number.isFinite(parsedTs) ? parsedTs : entry.ts,
        level: entry.level,
        event: asString(payload.event) || 'token.sync',
        opId: asString(payload.opId) || 'n/a',
        source: asString(payload.source) || 'unknown',
        provider: asString(payload.provider) || 'unknown',
        tokenKind: asString(payload.tokenKind) || null,
        verified: typeof payload.verified === 'boolean' ? payload.verified : null,
        hasToken: typeof payload.hasToken === 'boolean' ? payload.hasToken : null,
        fingerprint: asString(payload.fingerprint) || null,
        error: asString(payload.error) || null,
        raw: entry.msg,
      });
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, 80);
  }, [activityLog]);

  const rawJson = useMemo(() => JSON.stringify(debugSnapshot, null, 2), [debugSnapshot]);

  // ── Shared header ─────────────────────────────────────────────────────────

  const headerBar = (
    <div className="rounded-xl border border-border/70 bg-gradient-to-br from-background via-background to-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Cloud Inspector</h2>
          <p className="text-sm text-muted-foreground">
            Cloudflare gateway health, DO snapshots, and live event feed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={connectionVariant(gatewayState?.connectionStatus ?? null)}>
            {gatewayState?.connectionStatus ?? 'disconnected'}
          </Badge>
          <Badge variant="muted">{gatewayState?.connectionMode ?? 'n/a'}</Badge>
          <Badge variant="muted">{gatewayState?.cloudTarget ?? 'none'}</Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleConnectCloud()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Retry Connect'}
          </Button>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        <p>
          scope: <span className="font-mono">{gatewayState?.connectionScope ?? 'n/a'}</span>
          {' '}• target: <span className="font-mono">{gatewayState?.cloudTarget ?? 'none'}</span>
          {' '}• cloud port: <span className="font-mono">{health.port ?? 'resolving…'}</span>
        </p>
        {gatewayState?.lastCloudConnectError ? (
          <p className="mt-1 whitespace-pre-wrap break-all text-foreground/90 select-text">
            {gatewayState.lastCloudConnectError}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <label className="flex h-8 items-center gap-2 rounded-md border border-input px-3 text-sm">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          auto refresh (5s)
        </label>
      </div>
    </div>
  );

  return (
    <PageContentContainer className="max-w-[1400px] gap-3 pb-8">
      {headerBar}

      <Tabs defaultValue="cloud">
        <TabsList>
          <TabsTrigger value="cloud">Cloud Gateway</TabsTrigger>
          <TabsTrigger value="local">DO Snapshot</TabsTrigger>
        </TabsList>

        {/* ── CLOUD TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="cloud" className="flex flex-col gap-3 mt-3">

          {/* Health status banner */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2">
                Wrangler Health
                <Badge variant={healthStatusVariant(health.status)}>
                  {health.status === 'idle' ? 'not checked' : health.status}
                </Badge>
              </CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void runHealthCheck()}
                disabled={health.status === 'checking'}
              >
                {health.status === 'checking' ? 'Checking…' : 'Re-check'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Cloud port</p>
                  <p className="font-mono text-sm font-semibold">{health.port ?? '—'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">HTTP /health</p>
                  <p className={`text-sm font-semibold ${health.httpOk === true ? 'text-green-500' : health.httpOk === false ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {health.httpOk === true ? 'OK' : health.httpOk === false ? 'FAIL' : '—'}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">WS connection</p>
                  <Badge variant={connectionVariant(gatewayState?.connectionStatus ?? null)} className="mt-0.5 text-xs">
                    {health.wsStatus ?? '—'}
                  </Badge>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Process status</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge variant={cloudProcessVariant(health.cloudProcessStatus)} className="text-xs">
                      {health.cloudProcessStatus ?? '—'}
                    </Badge>
                    {health.cloudOwnership ? (
                      <span className="text-xs text-muted-foreground">({health.cloudOwnership})</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {health.httpBody ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Health response</p>
                  <pre className="select-text rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed">
                    {JSON.stringify(health.httpBody, null, 2)}
                  </pre>
                </div>
              ) : null}

              {health.error ? (
                <div className="select-text rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                  {health.error}
                </div>
              ) : null}

              {health.checkedAtMs ? (
                <p className="text-[11px] text-muted-foreground">Last checked: {new Date(health.checkedAtMs).toLocaleTimeString()}</p>
              ) : null}
            </CardContent>
          </Card>

          {/* WS connection details */}
          <Card>
            <CardHeader>
              <CardTitle>WebSocket Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm select-text">
              <p><span className="text-muted-foreground">status:</span>{' '}
                <Badge variant={connectionVariant(gatewayState?.connectionStatus ?? null)} className="text-xs">
                  {gatewayState?.connectionStatus ?? 'n/a'}
                </Badge>
              </p>
              <p><span className="text-muted-foreground">mode:</span> <span className="font-mono">{gatewayState?.connectionMode ?? 'n/a'}</span></p>
              <p><span className="text-muted-foreground">scope:</span> <span className="font-mono">{gatewayState?.connectionScope ?? 'n/a'}</span></p>
              <p><span className="text-muted-foreground">target:</span> <span className="font-mono">{gatewayState?.cloudTarget ?? 'n/a'}</span></p>
              <p><span className="text-muted-foreground">last connect attempt:</span> {formatTs(gatewayState?.lastCloudConnectAttemptAtMs ?? null)}</p>
              {gatewayState?.lastCloudConnectError ? (
                <p className="whitespace-pre-wrap break-all text-destructive">{gatewayState.lastCloudConnectError}</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Cloud Activity Log (last {activityLog.length} / 100)</CardTitle>
              <CopyableText
                text={activityLog.map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.msg}`).join('\n')}
                title="Copy activity log"
                className="w-[160px]"
                mono
              />
            </CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed font-mono select-text">
                {activityLog.length === 0 ? (
                  <div className="text-muted-foreground">
                    {parsed
                      ? 'No activity yet — send a request to the gateway to see entries here.'
                      : 'Connect to the gateway and refresh to see activity.'}
                  </div>
                ) : (
                  [...activityLog].reverse().map((entry, index) => (
                    <div
                      key={`${entry.ts}-${index}`}
                      className={`whitespace-pre-wrap break-all ${entry.level === 'error' ? 'text-destructive' : ''}`}
                    >
                      <span className="text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span>
                      {' '}
                      <span className={entry.level === 'error' ? 'font-semibold' : 'text-muted-foreground'}>[{entry.level}]</span>
                      {' '}
                      {entry.msg}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Token Sync Audit ({tokenSyncAudit.length})</CardTitle>
              <CopyableText
                text={tokenSyncAudit.map((entry) => `${new Date(entry.ts).toISOString()} ${entry.event} provider=${entry.provider} opId=${entry.opId} source=${entry.source} verified=${String(entry.verified)} hasToken=${String(entry.hasToken)} fingerprint=${entry.fingerprint ?? 'none'} error=${entry.error ?? 'none'}`).join('\n')}
                title="Copy token sync audit"
                className="w-[170px]"
                mono
              />
            </CardHeader>
            <CardContent>
              {tokenSyncAudit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No token sync events yet. Trigger push/pull/delete to populate this list.</p>
              ) : (
                <div className="space-y-1">
                  {tokenSyncAudit.map((entry, index) => (
                    <div key={`${entry.opId}-${entry.event}-${index}`} className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-xs select-text">
                      <span className="text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="truncate">
                          <span className="font-semibold">{entry.event}</span>
                          {' '}provider=<span className="font-mono">{entry.provider}</span>
                          {' '}opId=<span className="font-mono">{entry.opId}</span>
                          {' '}source=<span className="font-mono">{entry.source}</span>
                        </div>
                        <div className="truncate text-muted-foreground">
                          verified={String(entry.verified)}
                          {' '}hasToken={String(entry.hasToken)}
                          {' '}tokenKind={entry.tokenKind ?? 'none'}
                          {' '}fingerprint={entry.fingerprint ?? 'none'}
                        </div>
                        {entry.error ? (
                          <div className="whitespace-pre-wrap break-all text-destructive">{entry.error}</div>
                        ) : null}
                      </div>
                      <Badge variant={entry.verified === true ? 'success' : entry.verified === false ? 'warning' : 'muted'} className="text-[10px]">
                        {entry.verified === true ? 'verified' : entry.verified === false ? 'failed' : 'n/a'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live event feed */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Live Gateway Event Feed</CardTitle>
              <div className="flex items-center gap-2">
                <CopyableText
                  text={eventFeed.map((e) => `${new Date(e.ts).toISOString()} ${e.event || e.type} ${e.summary}`).join('\n')}
                  title="Copy event feed"
                  className="w-[170px]"
                  mono
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setEventFeed([])}>
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {eventFeed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events received yet.</p>
              ) : (
                eventFeed.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[auto_auto_1fr] gap-2 rounded-md border border-border/50 px-2 py-1 text-xs select-text">
                    <span className="text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span>
                    <span className="font-medium">{entry.event || entry.type}</span>
                    <span className="whitespace-pre-wrap break-all text-muted-foreground">{entry.summary}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

        </TabsContent>

        {/* ── LOCAL / DO SNAPSHOT TAB ────────────────────────────────────────── */}
        <TabsContent value="local" className="flex flex-col gap-3 mt-3">

          {/* Snapshot controls */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="session row limit"
              inputMode="numeric"
              className="w-36"
            />
            <Input
              value={sessionIdFilter}
              onChange={(e) => setSessionIdFilter(e.target.value)}
              placeholder="sessionId filter (optional)"
              className="w-64"
            />
            <label className="flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm">
              <input type="checkbox" checked={includeR2} onChange={(e) => setIncludeR2(e.target.checked)} />
              include R2 manifests
            </label>
            <Button type="button" size="sm" onClick={() => void fetchSnapshot()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {fetchError ? (
            <div className="select-text whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-sm text-destructive">
              {fetchError}
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Context</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm select-text">
                <p><span className="text-muted-foreground">tenant:</span> {asString(context?.tenantId) || 'n/a'}</p>
                <p><span className="text-muted-foreground">user:</span> {asString(context?.userId) || 'n/a'}</p>
                <p><span className="text-muted-foreground">role:</span> {asString(context?.role) || 'n/a'}</p>
                <p><span className="text-muted-foreground">scopes:</span> {Array.isArray(context?.scopes) ? (context.scopes as string[]).join(', ') : 'n/a'}</p>
                <p><span className="text-muted-foreground">snapshot ts:</span> {formatTs(parsed?.ts)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Storage Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm select-text">
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">DO sessions</p>
                  <p className="text-lg font-semibold">{asNumber(sqlite?.sessionCount) ?? 0}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">idempotency keys</p>
                  <p className="text-lg font-semibold">{asNumber(sqlite?.idempotencyCount) ?? 0}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">token records</p>
                  <p className="text-lg font-semibold">{asNumber(kv?.tokenCount) ?? 0}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">turn leases</p>
                  <p className="text-lg font-semibold">{asNumber(kv?.turnLeaseCount) ?? 0}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Token Sync Records (cloud KV)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm select-text">
              {tokens.length === 0 ? (
                <p className="text-muted-foreground">No token-sync records found for the current tenant/user.</p>
              ) : (
                tokens.map((token) => (
                  <div key={asString(token.provider)} className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-md border border-border/50 px-2 py-1">
                    <span className="font-mono text-xs">{asString(token.provider)}</span>
                    <span className="text-xs text-muted-foreground">{formatTs(token.updatedAtMs)}</span>
                    <span className="text-xs text-muted-foreground">{asNumber(token.valueBytes) ?? 0} bytes</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session Buffer State (DO SQLite)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 select-text">
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions found.</p>
              ) : (
                sessions.map((session) => (
                  <div key={asString(session.id)} className="rounded-md border border-border/60 p-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-mono">{asString(session.id)}</span>
                      <span className="text-muted-foreground">msg={asNumber(session.msgCount) ?? 0}</span>
                      <span className="text-muted-foreground">seq={asNumber(session.lastSeq) ?? 0}</span>
                      <span className="text-muted-foreground">pending={asNumber(session.pendingCount) ?? 0}</span>
                      <span className="text-muted-foreground">pendingBytes={asNumber(session.pendingBytes) ?? 0}</span>
                      <span className="text-muted-foreground">segments={asNumber(session.segmentCount) ?? 0}</span>
                      <span className="text-muted-foreground">updated={formatTs(session.updatedAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>R2 Manifest Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm select-text">
                {r2.length === 0 ? (
                  <p className="text-muted-foreground">No R2 manifest data (toggle "include R2 manifests").</p>
                ) : (
                  r2.map((entry) => (
                    <div key={asString(entry.sessionId)} className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-md border border-border/50 px-2 py-1">
                      <span className="truncate font-mono text-xs">{asString(entry.sessionId)}</span>
                      <span className="text-xs text-muted-foreground">segments {asNumber(entry.segmentCount) ?? 0}</span>
                      <span className="text-xs text-muted-foreground">{formatTs(entry.updatedAt)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>D1 Channels + Jobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm select-text">
                <p>
                  <span className="text-muted-foreground">channels:</span>{' '}
                  {asNumber(channels?.total) ?? 0} total / {asNumber(channels?.active) ?? 0} active
                </p>
                <div className="flex flex-wrap gap-1">
                  {jobsByStatus.length === 0 ? (
                    <span className="text-muted-foreground">no jobs</span>
                  ) : (
                    jobsByStatus.map((row) => (
                      <Badge key={asString(row.status)} variant="muted">
                        {asString(row.status)}: {asNumber(row.count) ?? 0}
                      </Badge>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">recent channels: {recentChannels.length}</p>
                <p className="text-xs text-muted-foreground">recent failed jobs: {recentFailedJobs.length}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Raw Snapshot</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { if (rawJson) void navigator.clipboard.writeText(rawJson); }}
              >
                Copy JSON
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[360px] overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed select-text">
                {rawJson || 'null'}
              </pre>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>
    </PageContentContainer>
  );
}
