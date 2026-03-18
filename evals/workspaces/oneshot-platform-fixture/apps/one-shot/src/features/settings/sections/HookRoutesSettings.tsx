import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { HookRouteAction } from '@/gateway/hookOpsTypes';
import { SectionTitle } from '@/features/settings/ui/SettingsLayout';
import { useHookAgents, useHookAgentsCollection } from '@/shared/hooks/useHookAgents';
import { useHookRoutes, useHookRoutesCollection } from '@/shared/hooks/useHookRoutes';

type RouteDraft = {
  name: string;
  action: HookRouteAction;
  enabled: boolean;
  token: string;
  agentId: string;
  transformModule: string;
  defaultSessionKey: string;
  wakeMode: 'now' | 'next-heartbeat';
  deliver: boolean;
  channel: string;
  to: string;
  model: string;
  thinking: string;
  timeoutSeconds: string;
  messageTemplate: string;
  textTemplate: string;
};

type AgentDraft = {
  agentId: string;
  enabled: boolean;
  provider: string;
  model: string;
  systemPrompt: string;
  thinking: string;
  timeoutSeconds: string;
  sessionMode: 'main' | 'isolated';
  summaryToMain: boolean;
};

function emptyRouteDraft(): RouteDraft {
  return {
    name: '',
    action: 'wake',
    enabled: true,
    token: '',
    agentId: '',
    transformModule: '',
    defaultSessionKey: '',
    wakeMode: 'now',
    deliver: true,
    channel: '',
    to: '',
    model: '',
    thinking: '',
    timeoutSeconds: '',
    messageTemplate: '',
    textTemplate: '',
  };
}

function emptyAgentDraft(): AgentDraft {
  return {
    agentId: '',
    enabled: true,
    provider: '',
    model: '',
    systemPrompt: '',
    thinking: '',
    timeoutSeconds: '',
    sessionMode: 'isolated',
    summaryToMain: true,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function HookRoutesSettings() {
  const routesCollection = useHookRoutesCollection();
  const agentsCollection = useHookAgentsCollection();
  const routes = useHookRoutes();
  const agents = useHookAgents();
  const [events, setEvents] = useState<Array<{
    eventId: string;
    hookName: string;
    action: HookRouteAction;
    status: string;
    error: string | null;
    source: string;
    path: string;
    createdAtMs: number;
    processedAtMs: number | null;
  }>>([]);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>(() => emptyRouteDraft());
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(() => emptyAgentDraft());
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const eventRes = await window.appShell.pipelineListHookEvents({ limit: 50 });
      setEvents(eventRes.ok ? eventRes.events : []);
      setNotice(eventRes.reason || 'Hook events refreshed.');
    } catch (error) {
      setNotice(`Refresh failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const routeNameOptions = useMemo(
    () => routes.map((route) => route.name).sort((a, b) => a.localeCompare(b)),
    [routes],
  );

  const agentIdOptions = useMemo(
    () => agents.map((agent) => agent.agent_id).sort((a, b) => a.localeCompare(b)),
    [agents],
  );

  const loadRoute = useCallback((routeName: string) => {
    const route = routes.find((entry) => entry.name === routeName);
    if (!route) return;
    const config = route.config_json ?? {};
    setRouteDraft({
      name: route.name,
      action: route.action,
      enabled: route.enabled,
      token: '',
      agentId: asString(config.agentId),
      transformModule: asString(config.transformModule),
      defaultSessionKey: asString(config.defaultSessionKey),
      wakeMode: config.wakeMode === 'next-heartbeat' ? 'next-heartbeat' : 'now',
      deliver: config.deliver !== false,
      channel: asString(config.channel),
      to: asString(config.to),
      model: asString(config.model),
      thinking: asString(config.thinking),
      timeoutSeconds: typeof config.timeoutSeconds === 'number' ? String(config.timeoutSeconds) : '',
      messageTemplate: asString(config.messageTemplate),
      textTemplate: asString(config.textTemplate),
    });
    setSelectedRoute(routeName);
    setNotice(`Loaded route "${routeName}" into editor.`);
  }, [routes]);

  const loadAgent = useCallback((agentId: string) => {
    const agent = agents.find((entry) => entry.agent_id === agentId);
    if (!agent) return;
    const config = agent.config_json ?? {};
    setAgentDraft({
      agentId: agent.agent_id,
      enabled: agent.enabled,
      provider: asString(config.provider),
      model: asString(config.model),
      systemPrompt: asString(config.systemPrompt),
      thinking: asString(config.thinking),
      timeoutSeconds: typeof config.timeoutSeconds === 'number' ? String(config.timeoutSeconds) : '',
      sessionMode: config.sessionMode === 'main' ? 'main' : 'isolated',
      summaryToMain: config.summaryToMain !== false,
    });
    setSelectedAgent(agentId);
    setNotice(`Loaded agent "${agentId}" into editor.`);
  }, [agents]);

  const saveRoute = useCallback(async () => {
    const name = routeDraft.name.trim();
    if (!name) {
      setNotice('Route name is required.');
      return;
    }
    setBusy(true);
    try {
      const timeoutParsed = Number(routeDraft.timeoutSeconds);
      const config: Record<string, unknown> = {
        ...(routeDraft.agentId.trim() ? { agentId: routeDraft.agentId.trim() } : {}),
        ...(routeDraft.transformModule.trim() ? { transformModule: routeDraft.transformModule.trim() } : {}),
        ...(routeDraft.defaultSessionKey.trim() ? { defaultSessionKey: routeDraft.defaultSessionKey.trim() } : {}),
        ...(routeDraft.wakeMode ? { wakeMode: routeDraft.wakeMode } : {}),
        deliver: routeDraft.deliver,
        ...(routeDraft.channel.trim() ? { channel: routeDraft.channel.trim() } : {}),
        ...(routeDraft.to.trim() ? { to: routeDraft.to.trim() } : {}),
        ...(routeDraft.model.trim() ? { model: routeDraft.model.trim() } : {}),
        ...(routeDraft.thinking.trim() ? { thinking: routeDraft.thinking.trim() } : {}),
        ...(Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? { timeoutSeconds: timeoutParsed } : {}),
        ...(routeDraft.messageTemplate.trim() ? { messageTemplate: routeDraft.messageTemplate.trim() } : {}),
        ...(routeDraft.textTemplate.trim() ? { textTemplate: routeDraft.textTemplate.trim() } : {}),
      };

      const existing = routes.find((entry) => entry.name === name);
      let tx;
      if (existing) {
        tx = routesCollection.update(name, (draft) => {
          draft.action = routeDraft.action;
          draft.enabled = routeDraft.enabled;
          draft.config_json = config;
          draft.updated_at_ms = Date.now();
          if (routeDraft.token.trim()) {
            draft.token = routeDraft.token.trim();
          } else {
            draft.token = undefined;
          }
        });
      } else {
        tx = routesCollection.insert({
          tenant_id: '',
          name,
          action: routeDraft.action,
          enabled: routeDraft.enabled,
          token_hash: null,
          config_json: config,
          created_at_ms: Date.now(),
          updated_at_ms: Date.now(),
          ...(routeDraft.token.trim() ? { token: routeDraft.token.trim() } : {}),
        });
      }
      await tx.isPersisted.promise;
      setNotice(`Saved route "${name}".`);
      setRouteDraft((prev) => ({ ...prev, token: '' }));
    } catch (error) {
      setNotice(`Save route failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [routeDraft, routes, routesCollection]);

  const deleteRoute = useCallback(async () => {
    const name = routeDraft.name.trim();
    if (!name) {
      setNotice('Select or enter a route name to delete.');
      return;
    }
    setBusy(true);
    try {
      const tx = routesCollection.delete(name);
      await tx.isPersisted.promise;
      setNotice(`Deleted route "${name}".`);
      setRouteDraft(emptyRouteDraft());
      setSelectedRoute('');
    } catch (error) {
      setNotice(`Delete route failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [routeDraft.name, routesCollection]);

  const saveAgent = useCallback(async () => {
    const agentId = agentDraft.agentId.trim();
    if (!agentId) {
      setNotice('Agent ID is required.');
      return;
    }
    setBusy(true);
    try {
      const timeoutParsed = Number(agentDraft.timeoutSeconds);
      const config: Record<string, unknown> = {
        ...(agentDraft.provider.trim() ? { provider: agentDraft.provider.trim() } : {}),
        ...(agentDraft.model.trim() ? { model: agentDraft.model.trim() } : {}),
        ...(agentDraft.systemPrompt.trim() ? { systemPrompt: agentDraft.systemPrompt.trim() } : {}),
        ...(agentDraft.thinking.trim() ? { thinking: agentDraft.thinking.trim() } : {}),
        ...(Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? { timeoutSeconds: timeoutParsed } : {}),
        sessionMode: agentDraft.sessionMode,
        summaryToMain: agentDraft.summaryToMain,
      };

      const existing = agents.find((entry) => entry.agent_id === agentId);
      let tx;
      if (existing) {
        tx = agentsCollection.update(agentId, (draft) => {
          draft.enabled = agentDraft.enabled;
          draft.config_json = config;
          draft.updated_at_ms = Date.now();
        });
      } else {
        tx = agentsCollection.insert({
          tenant_id: '',
          agent_id: agentId,
          enabled: agentDraft.enabled,
          config_json: config,
          created_at_ms: Date.now(),
          updated_at_ms: Date.now(),
        });
      }
      await tx.isPersisted.promise;
      setNotice(`Saved hook agent "${agentId}".`);
    } catch (error) {
      setNotice(`Save agent failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [agentDraft, agents, agentsCollection]);

  const deleteAgent = useCallback(async () => {
    const agentId = agentDraft.agentId.trim();
    if (!agentId) {
      setNotice('Select or enter an agent ID to delete.');
      return;
    }
    setBusy(true);
    try {
      const tx = agentsCollection.delete(agentId);
      await tx.isPersisted.promise;
      setNotice(`Deleted agent "${agentId}".`);
      setAgentDraft(emptyAgentDraft());
      setSelectedAgent('');
    } catch (error) {
      setNotice(`Delete agent failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [agentDraft.agentId, agentsCollection]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Hook Routes</SectionTitle>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </Button>
      </div>
      <p className="text-responsive-xs text-muted-foreground">
        Manage webhook route matching, transform modules, runtime agent profiles, and recent hook execution events.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Route Editor</h3>
            <Select value={selectedRoute} onValueChange={(value) => loadRoute(value)}>
              <SelectTrigger className="h-8 w-52">
                <SelectValue placeholder="Load existing route" />
              </SelectTrigger>
              <SelectContent>
                {routeNameOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-name">Route name</Label>
              <Input
                id="hook-route-name"
                value={routeDraft.name}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="github-pr-opened"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-action">Action</Label>
              <Select
                value={routeDraft.action}
                onValueChange={(value: HookRouteAction) => setRouteDraft((prev) => ({ ...prev, action: value }))}
              >
                <SelectTrigger id="hook-route-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wake">wake</SelectItem>
                  <SelectItem value="agent">agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-agent">Agent ID</Label>
              <Input
                id="hook-route-agent"
                value={routeDraft.agentId}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, agentId: event.target.value }))}
                placeholder="main"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-token">Shared token (optional on update)</Label>
              <Input
                id="hook-route-token"
                value={routeDraft.token}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, token: event.target.value }))}
                placeholder="Paste new token to rotate"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-model">Model override</Label>
              <Input
                id="hook-route-model"
                value={routeDraft.model}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, model: event.target.value }))}
                placeholder="gpt-5.2-codex"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-thinking">Thinking mode</Label>
              <Input
                id="hook-route-thinking"
                value={routeDraft.thinking}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, thinking: event.target.value }))}
                placeholder="minimal | low | medium | high"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-transform">Transform module</Label>
              <Input
                id="hook-route-transform"
                value={routeDraft.transformModule}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, transformModule: event.target.value }))}
                placeholder="github/pr-opened.mjs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-session">Default session key</Label>
              <Input
                id="hook-route-session"
                value={routeDraft.defaultSessionKey}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, defaultSessionKey: event.target.value }))}
                placeholder="main"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-channel">Deliver channel</Label>
              <Input
                id="hook-route-channel"
                value={routeDraft.channel}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, channel: event.target.value }))}
                placeholder="last or channel-id"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-to">Deliver target (to)</Label>
              <Input
                id="hook-route-to"
                value={routeDraft.to}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, to: event.target.value }))}
                placeholder="discord channel/user"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-route-timeout">Timeout (seconds)</Label>
              <Input
                id="hook-route-timeout"
                value={routeDraft.timeoutSeconds}
                onChange={(event) => setRouteDraft((prev) => ({ ...prev, timeoutSeconds: event.target.value }))}
                placeholder="60"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
              <span className="text-xs font-medium">Enabled</span>
              <Switch
                checked={routeDraft.enabled}
                onCheckedChange={(value) => setRouteDraft((prev) => ({ ...prev, enabled: value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
              <span className="text-xs font-medium">Deliver output</span>
              <Switch
                checked={routeDraft.deliver}
                onCheckedChange={(value) => setRouteDraft((prev) => ({ ...prev, deliver: value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hook-route-wake-mode">Wake mode</Label>
            <Select
              value={routeDraft.wakeMode}
              onValueChange={(value: 'now' | 'next-heartbeat') => setRouteDraft((prev) => ({ ...prev, wakeMode: value }))}
            >
              <SelectTrigger id="hook-route-wake-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="now">now</SelectItem>
                <SelectItem value="next-heartbeat">next-heartbeat</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hook-route-message-template">Message template</Label>
            <Textarea
              id="hook-route-message-template"
              value={routeDraft.messageTemplate}
              onChange={(event) => setRouteDraft((prev) => ({ ...prev, messageTemplate: event.target.value }))}
              placeholder="Template for rendered hook message"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hook-route-text-template">Text template</Label>
            <Textarea
              id="hook-route-text-template"
              value={routeDraft.textTemplate}
              onChange={(event) => setRouteDraft((prev) => ({ ...prev, textTemplate: event.target.value }))}
              placeholder="Optional plain-text template"
              rows={3}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void saveRoute()} disabled={busy}>
              Save Route
            </Button>
            <Button variant="outline" size="sm" onClick={() => void deleteRoute()} disabled={busy}>
              Delete Route
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedRoute('');
                setRouteDraft(emptyRouteDraft());
              }}
              disabled={busy}
            >
              Clear
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Agent Profiles</h3>
            <Select value={selectedAgent} onValueChange={(value) => loadAgent(value)}>
              <SelectTrigger className="h-8 w-52">
                <SelectValue placeholder="Load existing agent" />
              </SelectTrigger>
              <SelectContent>
                {agentIdOptions.map((agentId) => (
                  <SelectItem key={agentId} value={agentId}>
                    {agentId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-id">Agent ID</Label>
              <Input
                id="hook-agent-id"
                value={agentDraft.agentId}
                onChange={(event) => setAgentDraft((prev) => ({ ...prev, agentId: event.target.value }))}
                placeholder="alerts-bot"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-provider">Provider</Label>
              <Input
                id="hook-agent-provider"
                value={agentDraft.provider}
                onChange={(event) => setAgentDraft((prev) => ({ ...prev, provider: event.target.value }))}
                placeholder="openai"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-model">Model</Label>
              <Input
                id="hook-agent-model"
                value={agentDraft.model}
                onChange={(event) => setAgentDraft((prev) => ({ ...prev, model: event.target.value }))}
                placeholder="gpt-5.2-codex"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-thinking">Thinking</Label>
              <Input
                id="hook-agent-thinking"
                value={agentDraft.thinking}
                onChange={(event) => setAgentDraft((prev) => ({ ...prev, thinking: event.target.value }))}
                placeholder="minimal | low | medium | high"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-timeout">Timeout (seconds)</Label>
              <Input
                id="hook-agent-timeout"
                value={agentDraft.timeoutSeconds}
                onChange={(event) => setAgentDraft((prev) => ({ ...prev, timeoutSeconds: event.target.value }))}
                placeholder="60"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook-agent-session-mode">Session mode</Label>
              <Select
                value={agentDraft.sessionMode}
                onValueChange={(value: 'main' | 'isolated') => setAgentDraft((prev) => ({ ...prev, sessionMode: value }))}
              >
                <SelectTrigger id="hook-agent-session-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="isolated">isolated</SelectItem>
                  <SelectItem value="main">main</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hook-agent-system-prompt">System prompt</Label>
            <Textarea
              id="hook-agent-system-prompt"
              value={agentDraft.systemPrompt}
              onChange={(event) => setAgentDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))}
              placeholder="You handle webhook alerts..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
              <span className="text-xs font-medium">Enabled</span>
              <Switch
                checked={agentDraft.enabled}
                onCheckedChange={(value) => setAgentDraft((prev) => ({ ...prev, enabled: value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
              <span className="text-xs font-medium">Summary to main</span>
              <Switch
                checked={agentDraft.summaryToMain}
                onCheckedChange={(value) => setAgentDraft((prev) => ({ ...prev, summaryToMain: value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void saveAgent()} disabled={busy}>
              Save Agent
            </Button>
            <Button variant="outline" size="sm" onClick={() => void deleteAgent()} disabled={busy}>
              Delete Agent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedAgent('');
                setAgentDraft(emptyAgentDraft());
              }}
              disabled={busy}
            >
              Clear
            </Button>
          </div>
        </Card>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Recent Hook Events</h3>
          <Badge variant="muted">{events.length}</Badge>
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hook events yet.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border border-border/70">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Time</th>
                  <th className="px-2 py-1 text-left font-medium">Route</th>
                  <th className="px-2 py-1 text-left font-medium">Action</th>
                  <th className="px-2 py-1 text-left font-medium">Status</th>
                  <th className="px-2 py-1 text-left font-medium">Source</th>
                  <th className="px-2 py-1 text-left font-medium">Path</th>
                  <th className="px-2 py-1 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.eventId} className="border-t border-border/60 align-top">
                    <td className="px-2 py-1 whitespace-nowrap">{new Date(event.createdAtMs).toLocaleString()}</td>
                    <td className="px-2 py-1">{event.hookName}</td>
                    <td className="px-2 py-1">{event.action}</td>
                    <td className="px-2 py-1">{event.status}</td>
                    <td className="px-2 py-1">{event.source}</td>
                    <td className="px-2 py-1">{event.path}</td>
                    <td className="px-2 py-1 text-red-500">{event.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">{notice}</p>
    </div>
  );
}
