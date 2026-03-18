import { ArrowRight, Check, Minus, RefreshCw, Trash2 } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statusLabel } from "@/features/project-workspace/helpers";
import type { ProjectRun } from "@/features/app/types";
import type { ProjectWorkspaceSnapshot } from "@/features/project-workspace/types";

type ProjectWorkspaceHeaderProps = {
  projectName: string;
  projectPath: string;
  runs: ProjectRun[];
  activeRunId: string;
  snapshot: ProjectWorkspaceSnapshot;
  progress: number;
  onSelectRun: (runId: string) => void;
  onRefresh: () => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onApprove: () => void;
};

export function ProjectWorkspaceHeader({
  projectName,
  projectPath,
  runs,
  activeRunId,
  snapshot,
  progress,
  onSelectRun,
  onRefresh,
  onStart,
  onPause,
  onStop,
  onApprove,
}: ProjectWorkspaceHeaderProps) {
  const activeNode = snapshot.nodes.find((node) => node.id === snapshot.runState.activeNodeId);
  const completedCount = snapshot.nodes.filter((node) => node.status === "done").length;

  return (
    <div className="rounded-md border border-border/70 bg-card/85 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{projectName}</p>
          <p className="truncate text-xs text-muted-foreground">{projectPath}</p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={activeRunId} onValueChange={onSelectRun}>
            <SelectTrigger className="h-8 min-w-44">
              <SelectValue placeholder="Select run" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  {run.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
            <HugeiconsIcon icon={RefreshCw} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={onStart}>
            <HugeiconsIcon icon={ArrowRight} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            Start
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onPause}>
            <HugeiconsIcon icon={Minus} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            Pause
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onStop}>
            <HugeiconsIcon icon={Trash2} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            Stop
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onApprove}>
            <HugeiconsIcon icon={Check} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            Approve
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{completedCount}/{snapshot.nodes.length} complete</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{snapshot.phase}</Badge>
          {activeNode ? <Badge variant="info">{statusLabel(activeNode.status)}</Badge> : null}
          {snapshot.stagedChanges.length > 0 ? (
            <Badge variant="warning">{snapshot.stagedChanges.length} staged</Badge>
          ) : (
            <Badge variant="success">No staged changes</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
