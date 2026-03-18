import { Activity, Bot, Clock3, Cpu, Dot } from "lucide-react";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { PageContentContainer } from "@/features/app/PageContentContainer";
import {
  Clock01Icon,
  Message01Icon,
  WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";

const LIVE_AGENTS = [
  {
    id: "agent-copy",
    name: "Copywriter Agent",
    status: "Running",
    task: "Drafting launch announcement copy",
    elapsed: "02:14",
    throughput: "38 tokens/s",
  },
  {
    id: "agent-finance",
    name: "Finance Analyst",
    status: "Queued",
    task: "Reconciling weekly spend report",
    elapsed: "00:42",
    throughput: "Waiting on data",
  },
  {
    id: "agent-comms",
    name: "Comms Router",
    status: "Running",
    task: "Prioritizing inbound support requests",
    elapsed: "06:31",
    throughput: "94 events/min",
  },
];

const STATUS_CLASS: Record<string, string> = {
  Running: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
  Queued: "bg-amber-500/20 text-amber-500 border-amber-500/30",
};

export function LiveFlowPage() {
  return (
    <PageContentContainer className="space-y-4">
      <section className="workspace-shell p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="workspace-heading">Live Flow</p>
            <p className="text-xs text-muted-foreground">
              Real-time status of active agent runs across your workspace.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-emerald-500" />
            Updating now
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <article className="workspace-shell p-3">
          <p className="workspace-label">Live agents</p>
          <p className="mt-1 text-lg font-semibold">12</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            8 running, 4 queued
          </p>
        </article>
        <article className="workspace-shell p-3">
          <p className="workspace-label">Avg. cycle</p>
          <p className="mt-1 text-lg font-semibold">01:48</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Past 30 minutes
          </p>
        </article>
        <article className="workspace-shell p-3">
          <p className="workspace-label">Throughput</p>
          <p className="mt-1 text-lg font-semibold">1,942 ops/hr</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Stable across all modes
          </p>
        </article>
      </section>

      <section className="workspace-shell p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="workspace-label">Agent activity</p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open full timeline
          </button>
        </div>

        <div className="space-y-2">
          {LIVE_AGENTS.map((agent) => (
            <article
              key={agent.id}
              className="rounded-lg border border-border/70 bg-card px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">{agent.name}</p>
                <span
                  className={`ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[agent.status] ?? ""}`}
                >
                  <Dot className="h-3 w-3" />
                  {agent.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{agent.task}</p>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3 w-3" />
                  {agent.elapsed}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  {agent.throughput}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="workspace-shell p-3">
        <p className="workspace-label mb-2">Recent events</p>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={WorkflowCircle01Icon} className="h-3.5 w-3.5" />
            Workflow "Customer onboarding" started in Work mode
          </li>
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Message01Icon} className="h-3.5 w-3.5" />
            Communication assistant completed 14 routing decisions
          </li>
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} className="h-3.5 w-3.5" />
            Finance digest queued for 09:00 run window
          </li>
        </ul>
      </section>
    </PageContentContainer>
  );
}
