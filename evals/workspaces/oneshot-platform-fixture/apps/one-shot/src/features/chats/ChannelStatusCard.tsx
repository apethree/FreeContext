import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Pause, Play, Trash2 } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { Button } from "@/components/ui/button";
import type { ChannelHealth } from "./channelInstanceStatus";

type ChannelRow = {
  id: string;
  type: string;
  isActive: boolean;
  createdAt?: number;
};

type ChannelStatusResult = {
  ok: boolean;
  found?: boolean;
  channel?: { id: string; type: string; isActive: boolean; createdAt: number };
  health?: ChannelHealth;
  reason?: string;
};

function HealthDot({ health }: { health: ChannelHealth | null }) {
  if (!health || health.recentJobCount === 0) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/30" title="No jobs yet" />;
  }
  if (health.failed > 0) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" title={`${health.failed} failed`} />;
  }
  if (health.queued > 0) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-500" title={`${health.queued} queued`} />;
  }
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" title="All OK" />;
}

export function ChannelStatusCard({
  channel,
  onToggleActive,
  onDelete,
}: {
  channel: ChannelRow;
  onToggleActive: (channel: ChannelRow) => void;
  onDelete: (channel: ChannelRow) => void;
}) {
  const [status, setStatus] = useState<ChannelStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.appShell.pipelineGetChannelStatus({ channelId: channel.id });
      setStatus(result);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const health = status?.health ?? null;

  return (
    <div className="space-y-3">
      <section className="workspace-summary-card">
        <div className="workspace-section-title">
          <span className="flex items-center gap-2">
            <HealthDot health={health} />
            Channel Details
          </span>
          <span className={`workspace-tag ${channel.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted"}`}>
            {channel.isActive ? "active" : "paused"}
          </span>
        </div>
        <div className="mt-2 space-y-1.5 text-[12px]">
          <div className="workspace-action-row">
            <span className="workspace-tag">ID</span>
            <span className="flex-1 truncate font-mono text-[11px]">{channel.id}</span>
          </div>
          <div className="workspace-action-row">
            <span className="workspace-tag">Type</span>
            <span>{channel.type}</span>
          </div>
          <div className="workspace-action-row">
            <span className="workspace-tag">Created</span>
            <span>{channel.createdAt ? new Date(channel.createdAt).toLocaleString() : "unknown"}</span>
          </div>
        </div>
      </section>

      {health ? (
        <section className="workspace-summary-card">
          <div className="workspace-section-title">
            <span>Job Health</span>
            <span className="workspace-tag">{health.recentJobCount} recent</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5">
              <p className="text-[16px] font-semibold text-emerald-600">{health.completed}</p>
              <p className="text-muted-foreground">Completed</p>
            </div>
            <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5">
              <p className="text-[16px] font-semibold text-yellow-600">{health.queued}</p>
              <p className="text-muted-foreground">Queued</p>
            </div>
            <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5">
              <p className="text-[16px] font-semibold text-red-600">{health.failed}</p>
              <p className="text-muted-foreground">Failed</p>
            </div>
          </div>
          {health.lastActivity ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Last activity: {new Date(health.lastActivity).toLocaleString()}
            </p>
          ) : null}
          {health.lastError ? (
            <div className="mt-1.5">
              <button
                type="button"
                className="text-[10px] text-red-500 underline"
                onClick={() => setErrorExpanded(!errorExpanded)}
              >
                {errorExpanded ? "Hide last error" : "Show last error"}
              </button>
              {errorExpanded ? (
                <pre className="mt-1 max-h-24 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                  {health.lastError}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : loading ? (
        <p className="text-[10px] text-muted-foreground">Loading status...</p>
      ) : null}

      <div className="workspace-divider">
        <span>Actions</span>
      </div>

      <section className="space-y-1.5">
        <article className="workspace-action-row">
          <span className="flex-1 text-[12px]">Status</span>
          <Button type="button" size="xs" variant="outline" className="h-6 text-[10px]" onClick={() => onToggleActive(channel)}>
            {channel.isActive ? <><HugeiconsIcon icon={Pause} className="mr-1 h-3 w-3" />Pause</> : <><HugeiconsIcon icon={Play} className="mr-1 h-3 w-3" />Resume</>}
          </Button>
        </article>
        <article className="workspace-action-row">
          <span className="flex-1 text-[12px]">Delete channel</span>
          <Button type="button" size="xs" variant="outline" className="h-6 text-[10px] text-destructive" onClick={() => onDelete(channel)}>
            <HugeiconsIcon icon={Trash2} className="mr-1 h-3 w-3" />
            Delete
          </Button>
        </article>
        <article className="workspace-action-row">
          <span className="flex-1 text-[12px]">Refresh status</span>
          <Button type="button" size="xs" variant="outline" className="h-6 text-[10px]" disabled={loading} onClick={() => void fetchStatus()}>
            <HugeiconsIcon icon={ExternalLink} className="mr-1 h-3 w-3" />
            Refresh
          </Button>
        </article>
      </section>
    </div>
  );
}

export { HealthDot };
export type { ChannelHealth } from "./channelInstanceStatus";
