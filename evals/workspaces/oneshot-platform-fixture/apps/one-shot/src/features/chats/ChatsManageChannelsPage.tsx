import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Link2, ListFilter, MessageSquare, RefreshCw, Trash2, Wifi } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { FaApple, FaDiscord, FaSlack, FaTelegram, FaWhatsapp } from "react-icons/fa6";
import { SiGooglechat, SiMattermost, SiMatrix, SiSignal, SiTwitch } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  buildConfigFromValues,
  CHANNEL_CATALOG,
  getChannelDefinition,
  getChannelSetupInstructions,
  nextChannelId,
  resolveChannelCatalogType,
  type ChannelDefinition,
} from "./channelCatalog";
import {
  deriveInstanceStatus,
  type ChannelHealth,
  type ChannelInstance,
  type ChannelStatusResult,
  type InstanceStatus,
  type ProbeResult,
} from "./channelInstanceStatus";
import { useChannels, useChannelsCollection } from "@/shared/hooks/useChannels";
type PersistedChannelRow = {
  id: string;
  type: string;
  isActive: boolean;
  createdAt?: number;
};

type ChannelFormState = {
  fields: Record<string, string>;
  systemPrompt: string;
};

function seedInstances(): ChannelInstance[] {
  return CHANNEL_CATALOG.map((item) => ({
    id: item.id,
    type: item.id,
    isPersisted: false,
    isActive: false,
    status: "disconnected",
  }));
}

function mergeWithPersisted(
  current: ChannelInstance[],
  persisted: PersistedChannelRow[],
): ChannelInstance[] {
  // Keep only local drafts; persisted rows are rebuilt from cloud payload.
  const localDrafts = current.filter((item) => !item.isPersisted);
  const map = new Map(localDrafts.map((item) => [item.id, item]));

  for (const row of persisted) {
    const existing = map.get(row.id);
    map.set(row.id, {
      id: row.id,
      type: existing ? existing.type : row.type,
      isPersisted: true,
      isActive: row.isActive,
      status: row.isActive ? "connecting" : "disconnected",
      createdAt: row.createdAt,
    });
  }

  for (const definition of CHANNEL_CATALOG) {
    const hasType = Array.from(map.values()).some((item) => item.type === definition.id);
    if (!hasType) {
      const id = definition.id;
      if (!map.has(id)) {
        map.set(id, {
          id,
          type: definition.id,
          isPersisted: false,
          isActive: false,
          status: "disconnected",
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export { deriveInstanceStatus } from "./channelInstanceStatus";

function statusPillClass(status: InstanceStatus): string {
  if (status === "connected") return "bg-emerald-500/10 text-emerald-600";
  if (status === "connecting") return "bg-amber-500/10 text-amber-600";
  if (status === "error") return "bg-red-500/10 text-red-600";
  return "bg-muted text-muted-foreground";
}

function StatusDot({ status }: { status: InstanceStatus }) {
  if (status === "connected") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />;
  if (status === "connecting") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />;
  if (status === "error") return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />;
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/35" />;
}

function ChannelIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? "";
  if (type === "telegram") return <FaTelegram className={`${cls} text-sky-500`} />;
  if (type === "slack") return <FaSlack className={`${cls} text-violet-600`} />;
  if (type === "discord") return <FaDiscord className={`${cls} text-indigo-500`} />;
  if (type === "whatsapp") return <FaWhatsapp className={`${cls} text-emerald-500`} />;
  if (type === "imessage" || type === "bluebubbles") return <FaApple className={`${cls} text-slate-900 dark:text-slate-200`} />;
  if (type === "signal") return <SiSignal className={`${cls} text-blue-500`} />;
  if (type === "googlechat") return <SiGooglechat className={`${cls} text-green-500`} />;
  if (type === "mattermost") return <SiMattermost className={`${cls} text-blue-600`} />;
  if (type === "matrix") return <SiMatrix className={`${cls} text-slate-700 dark:text-slate-300`} />;
  if (type === "twitch") return <SiTwitch className={`${cls} text-purple-600`} />;
  if (type === "zalo" || type === "zalouser") return <HugeiconsIcon icon={MessageSquare} className={`${cls} text-blue-500`} />;
  if (type === "webchat") return <HugeiconsIcon icon={MessageSquare} className={`${cls} text-cyan-600`} />;
  return <HugeiconsIcon icon={Link2} className={`${cls} text-emerald-500`} />;
}

function backendTypeFor(definition: ChannelDefinition): string {
  return definition.backendType;
}

export function ChatsManageChannelsPage() {
  const { orgId, userId } = useAuth();
  const tenantId = orgId ?? userId ?? "";
  const channels = useChannels();
  const channelsCollection = useChannelsCollection();

  const [instances, setInstances] = useState<ChannelInstance[]>(() => seedInstances());
  const [selectedId, setSelectedId] = useState<string>(() => seedInstances()[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [syncMessage, setSyncMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== "undefined" ? window.innerWidth < 920 : false);

  const [formById, setFormById] = useState<Record<string, ChannelFormState>>({});
  const [healthById, setHealthById] = useState<Record<string, ChannelHealth | null>>({});
  const [probeById, setProbeById] = useState<Record<string, ProbeResult | null>>({});
  const [lastErrorById, setLastErrorById] = useState<Record<string, string | null>>({});
  const [showReconfigure, setShowReconfigure] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const selected = instances.find((item) => item.id === selectedId) ?? null;
  const selectedDefinition = selected ? getChannelDefinition(selected.type) : null;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return instances.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (!normalized) return true;
      return item.id.toLowerCase().includes(normalized) || item.type.toLowerCase().includes(normalized);
    });
  }, [instances, query, typeFilter]);

  const updateStatusFromPayload = useCallback((channelId: string, status: ChannelStatusResult | null, probe?: ProbeResult | null) => {
    setInstances((previous) => previous.map((item) => {
      if (item.id !== channelId) return item;
      const remoteIsActive = status?.channel?.isActive;
      const nextIsActive = typeof remoteIsActive === "boolean" ? remoteIsActive : item.isActive;
      const nextItem = { ...item, isActive: nextIsActive };
      return { ...nextItem, status: deriveInstanceStatus(nextItem, status, probe) };
    }));
  }, []);

  const fetchStatus = useCallback(async (channelId: string) => {
    try {
      const result = await window.appShell.pipelineGetChannelStatus({ channelId }) as ChannelStatusResult;
      if (!result.ok) {
        setHealthById((prev) => ({ ...prev, [channelId]: null }));
        setLastErrorById((prev) => ({ ...prev, [channelId]: result.reason ?? "No status payload returned." }));
        updateStatusFromPayload(channelId, result);
        return;
      }

      if (result.found === false) {
        setHealthById((prev) => ({ ...prev, [channelId]: null }));
        setLastErrorById((prev) => ({ ...prev, [channelId]: "Channel was not found in remote state." }));
        updateStatusFromPayload(channelId, result);
        return;
      }

      setHealthById((prev) => ({ ...prev, [channelId]: result.health ?? null }));
      setLastErrorById((prev) => ({ ...prev, [channelId]: result.health?.lastError ?? null }));
      updateStatusFromPayload(channelId, result);
    } catch (error) {
      setHealthById((prev) => ({ ...prev, [channelId]: null }));
      setLastErrorById((prev) => ({ ...prev, [channelId]: String(error) }));
      setInstances((previous) => previous.map((item) => (
        item.id === channelId && item.isPersisted && item.isActive ? { ...item, status: "error" } : item
      )));
    }
  }, [updateStatusFromPayload]);

  const fetchProbe = useCallback(async (channelId: string) => {
    setProbingId(channelId);
    try {
      const result = await window.appShell.pipelineProbeChannel({ channelId });
      const probe = result.probe as ProbeResult | null;
      setProbeById((prev) => ({ ...prev, [channelId]: probe }));
      if (probe && !probe.skipped) {
        if (probe.ok) {
          setLastErrorById((prev) => ({ ...prev, [channelId]: null }));
        } else {
          setLastErrorById((prev) => ({ ...prev, [channelId]: probe.error ?? "Probe failed" }));
        }
      }
      // Update instance status using the probe result
      setInstances((previous) => previous.map((item) => {
        if (item.id !== channelId) return item;
        return { ...item, status: deriveInstanceStatus(item, null, probe) };
      }));
    } catch (error) {
      setProbeById((prev) => ({ ...prev, [channelId]: { ok: false, error: String(error) } }));
      setLastErrorById((prev) => ({ ...prev, [channelId]: String(error) }));
    } finally {
      setProbingId(null);
    }
  }, []);

  const refreshStatuses = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const persisted = channels
        .map((channel) => ({
          id: channel.id,
          type: resolveChannelCatalogType(channel.type, channel.id),
          isActive: channel.is_active !== false,
          ...(typeof channel.created_at === "number" ? { createdAt: channel.created_at } : {}),
        }))
        .filter((value): value is PersistedChannelRow => Boolean(value));

      for (const row of persisted) {
        if (row.isActive) {
          void fetchStatus(row.id);
        }
      }
      setSyncMessage(`Refreshed status for ${persisted.length} connected channel${persisted.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSyncMessage(`Could not refresh channel status: ${String(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [channels, fetchStatus]);

  useEffect(() => {
    const persisted = channels
      .map((channel) => ({
        id: channel.id,
        type: resolveChannelCatalogType(channel.type, channel.id),
        isActive: channel.is_active !== false,
        ...(typeof channel.created_at === "number" ? { createdAt: channel.created_at } : {}),
      }))
      .filter((value): value is PersistedChannelRow => Boolean(value));
    setInstances((previous) => mergeWithPersisted(previous, persisted));
  }, [channels]);

  useEffect(() => {
    for (const item of instances) {
      if (!item.isPersisted || !item.isActive) continue;
      if (Object.prototype.hasOwnProperty.call(healthById, item.id)) continue;
      void fetchStatus(item.id);
    }
  }, [fetchStatus, healthById, instances]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 919px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!selected || selected.isPersisted) return;
    const timeout = setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeout);
  }, [selected]);

  const getFormState = useCallback((instanceId: string): ChannelFormState => {
    return formById[instanceId] ?? { fields: {}, systemPrompt: "" };
  }, [formById]);

  const setFormField = useCallback((instanceId: string, key: string, value: string) => {
    setFormById((previous) => ({
      ...previous,
      [instanceId]: {
        fields: { ...(previous[instanceId]?.fields ?? {}), [key]: value },
        systemPrompt: previous[instanceId]?.systemPrompt ?? "",
      },
    }));
  }, []);

  const setSystemPrompt = useCallback((instanceId: string, value: string) => {
    setFormById((previous) => ({
      ...previous,
      [instanceId]: {
        fields: previous[instanceId]?.fields ?? {},
        systemPrompt: value,
      },
    }));
  }, []);

  const handleAddChannel = useCallback((type: string) => {
    const ids = instances.map((item) => item.id);
    const channelId = nextChannelId(type, ids);
    const next: ChannelInstance = {
      id: channelId,
      type,
      isPersisted: false,
      isActive: false,
      status: "disconnected",
    };

    setInstances((previous) => [next, ...previous]);
    setSelectedId(channelId);
    setShowTypePicker(false);
    setTypeFilter("all");
    setFormById((previous) => ({
      ...previous,
      [channelId]: previous[channelId] ?? { fields: {}, systemPrompt: "" },
    }));
  }, [instances]);

  const handleConnect = useCallback(async () => {
    if (!selected || !selectedDefinition) return;
    const form = getFormState(selected.id);

    for (const field of selectedDefinition.configFields) {
      if (field.required && !form.fields[field.key]?.trim()) {
        setSyncMessage(`${field.label} is required.`);
        return;
      }
    }

    const config = buildConfigFromValues(selectedDefinition, form.fields, form.systemPrompt);
    const backendType = backendTypeFor(selectedDefinition);

    if (!tenantId) {
      setSyncMessage("Connect failed: missing authenticated identity.");
      return;
    }

    try {
      const tx = selected.isPersisted
        ? channelsCollection.update(selected.id, (draft) => {
          draft.type = backendType;
          draft.config = config;
          draft.is_active = true;
        })
        : channelsCollection.insert({
          tenant_id: tenantId,
          id: selected.id,
          type: backendType,
          config,
          is_active: true,
          created_at: Date.now(),
        });
      await tx.isPersisted.promise;
    } catch (error) {
      setSyncMessage(`Connect failed for ${selected.id}: ${String(error)}`);
      return;
    }

    setInstances((previous) => previous.map((item) => (
      item.id === selected.id
        ? { ...item, isPersisted: true, isActive: true, status: "connecting" }
        : item
    )));
    setSyncMessage(`Saved channel ${selected.id}.`);
    void fetchStatus(selected.id);
    // Probe the channel to validate the token against the external API
    void fetchProbe(selected.id);
  }, [channelsCollection, fetchProbe, fetchStatus, getFormState, selected, selectedDefinition, tenantId]);

  const handleToggleActive = useCallback(async () => {
    if (!selected || !selectedDefinition) return;
    const nextIsActive = !selected.isActive;

    try {
      const tx = channelsCollection.update(selected.id, (draft) => {
        draft.type = backendTypeFor(selectedDefinition);
        draft.is_active = nextIsActive;
        draft.config = draft.config ?? {};
      });
      await tx.isPersisted.promise;
    } catch (error) {
      setSyncMessage(`${nextIsActive ? "Resume" : "Pause"} failed for ${selected.id}: ${String(error)}`);
      return;
    }

    setInstances((previous) => previous.map((item) => (
      item.id === selected.id
        ? {
            ...item,
            isPersisted: true,
            isActive: nextIsActive,
            status: nextIsActive ? "connecting" : "disconnected",
          }
        : item
    )));

    setSyncMessage(`${nextIsActive ? "Resumed" : "Paused"} channel ${selected.id}.`);
    if (nextIsActive) {
      void fetchStatus(selected.id);
    }
  }, [channelsCollection, fetchStatus, selected, selectedDefinition]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;

    if (selected.isPersisted) {
      try {
        const tx = channelsCollection.delete(selected.id);
        await tx.isPersisted.promise;
      } catch (error) {
        setSyncMessage(`Delete failed for ${selected.id}: ${String(error)}`);
        return;
      }
      setSyncMessage(`Deleted channel ${selected.id}.`);
    } else {
      setSyncMessage(`Removed ${selected.id}.`);
    }

    setInstances((previous) => {
      const remaining = previous.filter((item) => item.id !== selected.id);
      const stillHasType = remaining.some((item) => item.type === selected.type);
      if (!stillHasType) {
        remaining.push({
          id: selected.type,
          type: selected.type,
          isPersisted: false,
          isActive: false,
          status: "disconnected",
        });
      }
      return remaining.sort((a, b) => a.id.localeCompare(b.id));
    });

    setFormById((previous) => {
      const next = { ...previous };
      delete next[selected.id];
      return next;
    });
    setHealthById((previous) => {
      const next = { ...previous };
      delete next[selected.id];
      return next;
    });
    setProbeById((previous) => {
      const next = { ...previous };
      delete next[selected.id];
      return next;
    });
    setLastErrorById((previous) => {
      const next = { ...previous };
      delete next[selected.id];
      return next;
    });

    const fallback = filtered.find((item) => item.id !== selected.id)?.id
      ?? instances.find((item) => item.id !== selected.id)?.id
      ?? selected.type;
    setSelectedId(fallback);
  }, [channelsCollection, filtered, instances, selected]);

  const selectedForm = selected ? getFormState(selected.id) : { fields: {}, systemPrompt: "" };
  const selectedHealth = selected ? (healthById[selected.id] ?? null) : null;
  const selectedProbe = selected ? (probeById[selected.id] ?? null) : null;

  return (
    <section className="workspace-shell">
      <ResizablePanelGroup orientation={isMobile ? "vertical" : "horizontal"} className="h-full min-w-0">

        {/* ── LEFT PANEL ── */}
        <ResizablePanel defaultSize={isMobile ? 44 : 34} minSize={isMobile ? 28 : 22} className="min-w-0 overflow-hidden">
          <aside className="workspace-pane min-w-0">
            <div className="workspace-pane-header">
              <div className="workspace-section-title">
                <span>Channels</span>
                <span className="workspace-tag">{filtered.length}</span>
              </div>
              <div className="relative flex items-center gap-1.5">
                <button
                  type="button"
                  className="workspace-icon-btn"
                  onClick={() => void refreshStatuses()}
                  aria-label="Refresh"
                  disabled={isRefreshing}
                >
                  <HugeiconsIcon icon={RefreshCw} className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="workspace-icon-btn" aria-label="Filter">
                      <HugeiconsIcon icon={ListFilter} className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setTypeFilter("all")}>All</DropdownMenuItem>
                    {CHANNEL_CATALOG.map((d) => (
                      <DropdownMenuItem key={d.id} onSelect={() => setTypeFilter(d.id)}>{d.label}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setShowTypePicker((p) => !p)}>
                  + Channel
                </Button>
                {showTypePicker ? (
                  <div className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-border bg-popover p-1 shadow-lg">
                    <p className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">Channel type</p>
                    <div className="max-h-72 overflow-auto">
                      {CHANNEL_CATALOG.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => handleAddChannel(d.id)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                        >
                          <ChannelIcon type={d.id} className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1 truncate">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels"
              className="mb-2 h-8 text-sm"
            />

            <div className="workspace-scroll min-h-0 flex-1 space-y-0.5 pr-0.5">
              {filtered.length === 0 ? (
                <p className="px-1 py-3 text-sm text-muted-foreground">No channels found.</p>
              ) : filtered.map((inst) => {
                const def = getChannelDefinition(inst.type);
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => { setSelectedId(inst.id); setShowReconfigure(false); }}
                    className={`workspace-action-row w-full items-center py-2.5 text-left ${selectedId === inst.id ? "workspace-contact-row-active" : ""}`}
                  >
                    <ChannelIcon type={inst.type} className="h-5 w-5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{def?.label ?? inst.type}</p>
                      {inst.id !== inst.type ? (
                        <p className="truncate text-xs text-muted-foreground">{inst.id}</p>
                      ) : null}
                    </div>
                    <StatusDot status={inst.status} />
                  </button>
                );
              })}
            </div>

            {syncMessage ? (
              <p className="mt-1.5 truncate text-xs text-muted-foreground/60">{syncMessage}</p>
            ) : null}
          </aside>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20 bg-border/80" />

        {/* ── RIGHT PANEL ── */}
        <ResizablePanel defaultSize={isMobile ? 56 : 66} minSize={isMobile ? 32 : 34} className="min-w-0 overflow-hidden">
          <main className="workspace-canvas min-w-0">
            <div className="workspace-canvas-body">
              {!selected || !selectedDefinition ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">Select a channel to configure it</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/50">or click + Channel to add one</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">

                  {/* HEADER */}
                  <div className="flex items-center gap-3">
                    <ChannelIcon type={selected.type} className="h-8 w-8 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[17px] font-semibold text-foreground">{selectedDefinition.label}</h2>
                      {selected.id !== selected.type ? (
                        <p className="truncate text-xs text-muted-foreground">{selected.id}</p>
                      ) : null}
                    </div>
                    {selected.isPersisted ? (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(selected.status)}`}>
                        {selected.isActive ? (selected.status === "error" ? "Error" : "Active") : "Paused"}
                      </span>
                    ) : null}
                  </div>

                  {/* STATUS CARD — only when persisted */}
                  {selected.isPersisted && !showReconfigure ? (
                    <div className="overflow-hidden rounded-xl border border-border/70">
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusDot status={selected.status} />
                          <span className="text-sm font-medium capitalize">{selected.status}</span>
                          {selectedProbe?.ok && selectedProbe.bot?.username ? (
                            <span className="text-xs text-muted-foreground">@{selectedProbe.bot.username}</span>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {selectedProbe?.elapsedMs != null
                            ? `${selectedProbe.elapsedMs}ms`
                            : selectedHealth?.lastActivity
                              ? new Date(selectedHealth.lastActivity).toLocaleString()
                              : "No activity yet"}
                        </span>
                      </div>
                      {lastErrorById[selected.id] ? (
                        <div className="border-t border-border/70 px-4 py-2.5">
                          <p className="break-words text-sm text-red-500">{lastErrorById[selected.id]}</p>
                        </div>
                      ) : null}
                      <details className="group border-t border-border/70">
                        <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
                          <span>Job details</span>
                          <span className="group-open:hidden">›</span>
                          <span className="hidden group-open:inline">‹</span>
                        </summary>
                        <div className="space-y-0.5 px-4 pb-3 pt-1 text-xs text-muted-foreground">
                          <p>Completed: {selectedHealth?.completed ?? 0}</p>
                          <p>Queued: {selectedHealth?.queued ?? 0}</p>
                          <p>Failed: {selectedHealth?.failed ?? 0}</p>
                          <p>Recent total: {selectedHealth?.recentJobCount ?? 0}</p>
                        </div>
                      </details>
                    </div>
                  ) : null}

                  {/* SETUP FORM — when not persisted OR reconfiguring */}
                  {(!selected.isPersisted || showReconfigure) ? (
                    <div className="space-y-4">
                      {/* Steps */}
                      <div>
                        <p className="mb-3 text-sm font-medium text-foreground/80">How to connect</p>
                        <ol className="space-y-2.5">
                          {getChannelSetupInstructions(selectedDefinition).map((step, i) => (
                            <li key={step} className="flex items-start gap-3 text-sm text-foreground/80">
                              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                                {i + 1}
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* Config fields — iOS grouped card */}
                      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
                        {selectedDefinition.configFields.map((field, index) => (
                          <div key={field.key} className="px-4 py-3">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              {field.label}
                              {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
                            </label>
                            <Input
                              ref={index === 0 ? firstFieldRef : undefined}
                              type={field.type === "password" ? "password" : "text"}
                              value={selectedForm.fields[field.key] ?? ""}
                              onChange={(e) => setFormField(selected.id, field.key, e.target.value)}
                              placeholder={field.placeholder}
                              className="h-8 border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                            />
                            {field.helpText ? (
                              <p className="mt-0.5 text-xs text-muted-foreground/70">{field.helpText}</p>
                            ) : null}
                          </div>
                        ))}
                        {/* System prompt — collapsed by default */}
                        <details className="group">
                          <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                            <span>System Prompt (optional)</span>
                            <span className="group-open:hidden">›</span>
                            <span className="hidden group-open:inline">‹</span>
                          </summary>
                          <div className="px-4 pb-3">
                            <textarea
                              rows={3}
                              value={selectedForm.systemPrompt}
                              onChange={(e) => setSystemPrompt(selected.id, e.target.value)}
                              placeholder="Optional: custom personality for this channel…"
                              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                            />
                          </div>
                        </details>
                      </div>

                      {/* Form actions */}
                      <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void handleConnect()}>
                Connect
              </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void window.appShell.openExternalUrl(selectedDefinition.docsUrl)}
                        >
                          Docs ↗
                        </Button>
                        {selected.isPersisted && showReconfigure ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => setShowReconfigure(false)}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* CHANNEL ACTIONS — when persisted and not reconfiguring */}
                  {selected.isPersisted && !showReconfigure ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={selected.isActive ? "outline" : "default"}
                        onClick={() => void handleToggleActive()}
                      >
                        {selected.isActive ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void fetchProbe(selected.id)}
                        disabled={probingId === selected.id}
                      >
                        <HugeiconsIcon icon={Wifi} className={`mr-1.5 h-3.5 w-3.5 ${probingId === selected.id ? "animate-pulse" : ""}`} />
                        {probingId === selected.id ? "Testing..." : "Test Connection"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void fetchStatus(selected.id)}
                      >
                        Refresh
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowReconfigure(true)}
                      >
                        Reconfigure
                      </Button>
                      <div className="flex-1" />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDelete()}
                      >
                        <HugeiconsIcon icon={Trash2} className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  ) : null}

                </div>
              )}
            </div>
          </main>
        </ResizablePanel>

      </ResizablePanelGroup>
    </section>
  );
}
