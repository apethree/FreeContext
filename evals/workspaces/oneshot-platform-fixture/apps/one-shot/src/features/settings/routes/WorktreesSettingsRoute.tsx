import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CheckIcon,
  CopyIcon,
  FilterIcon,
  GitBranchIcon,
  ListFilterIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  TerminalSquareIcon,
  Trash2Icon,
  WrenchIcon,
  PowerIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type OrchestratorListResult = Awaited<
  ReturnType<Window["appShell"]["devOrchestratorList"]>
>;
type OrchestratorHealthResult = Awaited<
  ReturnType<Window["appShell"]["devOrchestratorHealth"]>
>;
type CurrentWorktreeStatusResult = Awaited<
  ReturnType<Window["appShell"]["devOrchestratorStatusCurrentWorktree"]>
>;
type WorktreeRow = OrchestratorListResult["discoveredWorktrees"][number];
type BlockedCategory = NonNullable<WorktreeRow["blockedCategory"]>;
type WorktreeFilter = "all" | "active" | "inactive" | "disconnected" | "stale";

type ServiceTone = "active" | "inactive" | "warning" | "error";

const BRANCH_COLORS = [
  "#374151",
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#ec4899",
  "#eab308",
];

function stateFromRow(row: WorktreeRow) {
  if (row.stale) return "stale" as const;
  if (!row.enabled) return "inactive" as const;
  if (row.blockedReason) return "disconnected" as const;
  if (
    row.status.cloud === "online" ||
    row.status.cloud === "external" ||
    row.status.app === "online" ||
    row.status.app === "external" ||
    row.status.cloud === "launching" ||
    row.status.app === "launching"
  )
    return "active" as const;
  return "inactive" as const;
}

function rowLabel(row: WorktreeRow) {
  const label = row.label?.trim();
  if (label && !label.match(/\([a-z0-9-]{8}\)$/i)) return label;
  const parts = row.path.split("/").filter(Boolean);
  return parts[parts.length - 2] || row.worktreeKey;
}

const BLOCKED_CATEGORY_GUIDANCE: Record<BlockedCategory, string> = {
  credentials: "Switch profile mode to 'local' for Miniflare, or add the required env vars to .dev.vars / .env.local.",
  port: "Free up the port or adjust port ranges in dev-orchestrator/worktrees.local.json.",
  'missing-dirs': "Ensure apps/gateway and apps/one-shot directories exist in the worktree.",
  stale: "This worktree was removed from disk. Run 'Cleanup stale entries' to remove it.",
  profile: "Check that the profile name exists in worktrees.local.json profiles.",
  'health-check': "Cloud process started but never became healthy. Check cloud logs for errors.",
  'startup-failed': "Process exited immediately after start. Check logs for stack traces or missing dependencies.",
};

function serviceTone(status: string): ServiceTone {
  if (status === "online" || status === "launching") return "active";
  if (status === "external") return "warning";
  if (status === "errored" || status === "error") return "error";
  if (status === "stopped" || status === "missing" || status === "blocked") return "inactive";
  return "warning";
}

// Single solid-pill badge — color encodes the state, label names the service.
// Matches the NS1 / EW12 transit badge visual: one rounded rect, solid bg, white text.
function ServiceBadge({ label, status }: { label: string; status: string }) {
  const tone = serviceTone(status);
  const bg = {
    active:   'bg-emerald-500',
    inactive: 'bg-slate-400',
    warning:  'bg-amber-500',
    error:    'bg-red-500',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${bg}`}
      title={status}
    >
      {label}
    </span>
  );
}

const ROOT_COLOR = BRANCH_COLORS[0]; // #374151 — matches the first (main) worktree

// x position of the trunk within the 36px gutter column
const TRUNK_X = 6;
// y position (px from row top) where the curve lands and the dot sits
const BRANCH_Y = 20;
// x position of the dot — right edge of the gutter (36px - dot radius ≈ 30)
const DOT_X = 30;

function TrunkPassthrough() {
  return (
    <div className="relative self-stretch">
      <svg className="absolute inset-0 h-full w-full">
        <line
          x1={TRUNK_X}
          y1="0"
          x2={TRUNK_X}
          y2="100%"
          stroke={`${ROOT_COLOR}44`}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}


function ActionIconButton(props: {
  tooltip: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={props.variant ?? "outline"}
          className={`h-8 w-8 ${props.active ? "border-blue-500 bg-blue-600 text-white hover:bg-blue-600 hover:text-white" : ""}`}
          onClick={props.onClick}
          disabled={props.disabled}
        >
          {props.children}
          <span className="sr-only">{props.tooltip}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{props.tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function WorktreesSettingsRoute() {
  const [listResult, setListResult] = useState<OrchestratorListResult | null>(
    null,
  );
  const [health, setHealth] = useState<OrchestratorHealthResult | null>(null);
  const [currentWorktreeStatus, setCurrentWorktreeStatus] = useState<CurrentWorktreeStatusResult | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorktreeFilter>("all");
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState("one-shot-platform");
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [logsTargetKey, setLogsTargetKey] = useState<string | null>(null);
  const [actionFeedbackByKey, setActionFeedbackByKey] = useState<Record<string, string>>({});
  const [maintenanceFeedback, setMaintenanceFeedback] = useState("");
  const [selectedProcessByKey, setSelectedProcessByKey] = useState<
    Record<string, string>
  >({});
  const [stdout, setStdout] = useState<string[]>([]);
  const [stderr, setStderr] = useState<string[]>([]);
  const [logsError, setLogsError] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [liveStartedAtMs, setLiveStartedAtMs] = useState<number | null>(null);
  const [copiedSignal, setCopiedSignal] = useState("");
  const liveCursorRef = useRef<{
    stdoutOffset: number;
    stderrOffset: number;
  } | null>(null);
  const livePollInFlightRef = useRef(false);

  const copyText = useCallback(async (value: string) => {
    if (!value.trim()) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  }, []);

  const refresh = useCallback(async () => {
    const [listSettled, healthSettled, currentSettled] = await Promise.allSettled([
      window.appShell.devOrchestratorList(),
      window.appShell.devOrchestratorHealth(),
      window.appShell.devOrchestratorStatusCurrentWorktree(),
    ]);

    if (listSettled.status === "fulfilled") setListResult(listSettled.value);
    if (healthSettled.status === "fulfilled") setHealth(healthSettled.value);
    if (currentSettled.status === "fulfilled") setCurrentWorktreeStatus(currentSettled.value);

    if (
      listSettled.status === "rejected" ||
      healthSettled.status === "rejected" ||
      currentSettled.status === "rejected"
    ) {
      const parts = [
        listSettled.status === "rejected"
          ? `list: ${String(listSettled.reason)}`
          : null,
        healthSettled.status === "rejected"
          ? `health: ${String(healthSettled.reason)}`
          : null,
        currentSettled.status === "rejected"
          ? `current: ${String(currentSettled.reason)}`
          : null,
      ].filter(Boolean);
      setLoadError(parts.join(" | "));
    } else {
      setLoadError("");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!listResult) return;
    setSelectedProcessByKey((previous) => {
      const next = { ...previous };
      for (const row of listResult.discoveredWorktrees) {
        const key = row.worktreeKey;
        const available = listResult.processes.filter(
          (process) => process.worktreeKey === key && process.status !== "missing",
        );
        if (
          !next[key] ||
          !available.some((process) => process.name === next[key])
        ) {
          const preferred =
            available.find(
              (process) =>
                process.kind === "cloud" &&
                (process.status === "online" || process.status === "launching"),
            ) ??
            available.find(
              (process) =>
                process.worktreeKey === key && process.kind === "app",
            ) ??
            available.find((process) => process.kind === "cloud") ??
            available.find((process) => process.kind === "app") ??
            null;
          if (preferred) next[key] = preferred.name;
        }
      }
      return next;
    });
  }, [listResult]);

  const mainRepoRow = useMemo(
    () =>
      (listResult?.discoveredWorktrees ?? []).find(
        (row) => row.branch === "main",
      ) ?? null,
    [listResult],
  );

  const worktreeRows = useMemo(() => {
    const allRows = listResult?.discoveredWorktrees ?? [];
    if (!mainRepoRow) return allRows;
    return [
      mainRepoRow,
      ...allRows.filter((row) => row.worktreeKey !== mainRepoRow.worktreeKey),
    ];
  }, [listResult, mainRepoRow]);

  const filteredRows = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return worktreeRows.filter((row) => {
      if (filter !== "all" && stateFromRow(row) !== filter) return false;
      if (!lowered) return true;
      return [
        rowLabel(row),
        row.worktreeKey,
        row.path,
        row.branch,
        row.profile ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(lowered);
    });
  }, [filter, query, worktreeRows]);

  const logsTargetRow = useMemo(
    () =>
      logsTargetKey
        ? (worktreeRows.find((row) => row.worktreeKey === logsTargetKey) ??
          null)
        : null,
    [logsTargetKey, worktreeRows],
  );

  const logsTargetProcesses = useMemo(
    () =>
      logsTargetKey
        ? (listResult?.processes ?? []).filter(
            (item) =>
              item.worktreeKey === logsTargetKey &&
              item.status !== "missing",
          )
        : [],
    [listResult, logsTargetKey],
  );

  const runAction = useCallback(
    async (
      action: "start" | "stop" | "restart",
      scope?: { type: "all" } | { type: "worktree"; worktreeKey: string },
      services?: Array<"cloud" | "app">,
    ) => {
      const scopeKey = scope && "worktreeKey" in scope ? scope.worktreeKey : null;
      setBusyAction(
        `${action}:${scope?.type ?? "all"}:${scope && "worktreeKey" in scope ? scope.worktreeKey : ""}`,
      );
      try {
        let result:
          | Awaited<ReturnType<Window["appShell"]["devOrchestratorStart"]>>
          | Awaited<ReturnType<Window["appShell"]["devOrchestratorStop"]>>
          | Awaited<ReturnType<Window["appShell"]["devOrchestratorRestart"]>>;
        if (action === "start") {
          result = await window.appShell.devOrchestratorStart(
            scope || services ? { ...(scope ? { scope } : {}), ...(services ? { services } : {}) } : undefined,
          );
        } else if (action === "stop") {
          result = await window.appShell.devOrchestratorStop(
            scope || services ? { ...(scope ? { scope } : {}), ...(services ? { services } : {}) } : undefined,
          );
        } else {
          result = await window.appShell.devOrchestratorRestart(
            scope || services ? { ...(scope ? { scope } : {}), ...(services ? { services } : {}) } : undefined,
          );
        }

        if (scopeKey) {
          const relatedSkips = result.skipped.filter((item) =>
            item.name.includes(scopeKey),
          );
          if (!result.ok) {
            setActionFeedbackByKey((previous) => ({
              ...previous,
              [scopeKey]: result.reason ?? `Failed to ${action}.`,
            }));
          } else if (relatedSkips.length > 0) {
            setActionFeedbackByKey((previous) => ({
              ...previous,
              [scopeKey]: relatedSkips[0].reason,
            }));
          } else {
            setActionFeedbackByKey((previous) => ({ ...previous, [scopeKey]: "" }));
          }
        }
        await refresh();
      } finally {
        setBusyAction("");
      }
    },
    [refresh],
  );

  const setWorktreeEnabled = useCallback(
    async (worktreeKey: string, enabled: boolean) => {
      setBusyAction(`toggle:${worktreeKey}`);
      try {
        const next = await window.appShell.devOrchestratorSetWorktreeEnabled({
          worktreeKey,
          enabled,
        });
        setListResult(next);
        const nextHealth = await window.appShell.devOrchestratorHealth();
        setHealth(nextHealth);
        const nextCurrent = await window.appShell.devOrchestratorStatusCurrentWorktree();
        setCurrentWorktreeStatus(nextCurrent);
      } finally {
        setBusyAction("");
      }
    },
    [],
  );

  const rescan = useCallback(async () => {
    setBusyAction("rescan");
    try {
      const next = await window.appShell.devOrchestratorRescan();
      setListResult(next);
      const nextHealth = await window.appShell.devOrchestratorHealth();
      setHealth(nextHealth);
      const nextCurrent = await window.appShell.devOrchestratorStatusCurrentWorktree();
      setCurrentWorktreeStatus(nextCurrent);
    } finally {
      setBusyAction("");
    }
  }, []);

  const runRecoveryAction = useCallback(
    async (action: "stop-all" | "restart-all" | "cleanup-stale" | "hard-reset") => {
      setBusyAction(`recovery:${action}`);
      setMaintenanceFeedback("");
      try {
        if (action === "cleanup-stale") {
          const next = await window.appShell.devOrchestratorCleanupStale();
          setListResult(next);
          const nextHealth = await window.appShell.devOrchestratorHealth();
          setHealth(nextHealth);
          if (!next.ok) {
            setMaintenanceFeedback(next.reason ?? "Cleanup stale failed.");
          } else {
            setMaintenanceFeedback("Cleanup complete. Stale worktrees removed.");
          }
          return;
        }

        const result =
          action === "stop-all"
            ? await window.appShell.devOrchestratorStop()
            : action === "restart-all"
              ? await window.appShell.devOrchestratorRestart()
              : await window.appShell.devOrchestratorDelete();

        const summaryParts = [
          result.ok ? "Done." : "Failed.",
          `Affected: ${result.affected.length}.`,
          result.skipped.length > 0 ? `Skipped: ${result.skipped.length}.` : "",
          !result.ok && result.reason ? result.reason : "",
          result.ok && result.skipped.length > 0 ? result.skipped[0]?.reason ?? "" : "",
        ].filter(Boolean);
        setMaintenanceFeedback(summaryParts.join(" "));
        await refresh();
      } finally {
        setBusyAction("");
      }
    },
    [refresh],
  );

  const loadLogs = useCallback(async () => {
    if (!logsTargetKey) return;
    const processName = selectedProcessByKey[logsTargetKey];
    if (!processName) {
      setLogsError(
        "No PM2-managed process is available for this worktree. If app was started manually, its logs are in that terminal.",
      );
      setStdout([]);
      setStderr([]);
      return;
    }
    setLogsError("");
    const result = await window.appShell.devOrchestratorLogs({
      processName,
      lines: 120,
    });
    if (!result.ok) {
      const reason = result.reason ?? "Could not load logs.";
      if (reason.includes("Unknown process")) {
        setLogsError(
          "Selected service is not PM2-managed (likely external/manual). For external app logs, use the terminal where npm start is running.",
        );
      } else {
        setLogsError(reason);
      }
      setStdout([]);
      setStderr([]);
      return;
    }
    setStdout(result.stdout.slice(-250));
    setStderr(result.stderr.slice(-250));
  }, [logsTargetKey, selectedProcessByKey]);

  const stopLiveCapture = useCallback(() => {
    setLiveMode(false);
    setLiveStartedAtMs(null);
    liveCursorRef.current = null;
    livePollInFlightRef.current = false;
  }, []);

  const startLiveCapture = useCallback(async () => {
    if (!logsTargetKey) return;
    const processName = selectedProcessByKey[logsTargetKey];
    if (!processName) {
      setLogsError(
        "No PM2-managed process is available for live logs on this worktree.",
      );
      return;
    }
    setLogsError("");
    setStdout([]);
    setStderr([]);
    const result = await window.appShell.devOrchestratorLiveLogs({
      processName,
      fromNow: true,
    });
    if (!result.ok) {
      setLogsError(result.reason ?? "Could not start live capture.");
      return;
    }
    liveCursorRef.current = result.cursor;
    setLiveStartedAtMs(Date.now());
    setLiveMode(true);
  }, [logsTargetKey, selectedProcessByKey]);

  useEffect(() => {
    if (!liveMode || !logsTargetKey) return;
    const processName = selectedProcessByKey[logsTargetKey];
    if (!processName) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || livePollInFlightRef.current) return;
      const cursor = liveCursorRef.current;
      if (!cursor) return;
      livePollInFlightRef.current = true;
      try {
        const result = await window.appShell.devOrchestratorLiveLogs({
          processName,
          cursor,
          maxBytes: 256 * 1024,
        });
        if (cancelled) return;
        if (!result.ok) {
          setLogsError(result.reason ?? "Live capture failed.");
          return;
        }
        liveCursorRef.current = result.cursor;
        setLogsError("");
        setStdout((previous) => [...previous, ...result.stdout].slice(-500));
        setStderr((previous) => [...previous, ...result.stderr].slice(-500));
      } finally {
        livePollInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, 900);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      livePollInFlightRef.current = false;
    };
  }, [liveMode, logsTargetKey, selectedProcessByKey]);

  if (!listResult && !health) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading worktree orchestration status…
      </p>
    );
  }

  if (!listResult || !health) {
    return (
      <Card className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">
          Loading worktree orchestration status…
        </p>
        {loadError ? <p className="text-xs text-red-500 select-text">{loadError}</p> : null}
      </Card>
    );
  }

  // All rows share this grid. Zero gap between rows so the trunk is never broken.
  // Vertical spacing comes only from padding inside the right column of each row.
  const COL = "grid grid-cols-[36px_1fr]";

  return (
    <div className="pb-6">
      {/* ── Root node: project selector ── */}
      {/*
       * Root row — the dropdown button starts at x=0 and overlaps the trunk.
       * The trunk SVG is absolutely positioned behind the button so the line
       * still flows out from under it down to the first worktree.
       */}
      <div className="relative pt-1.5 pb-12">
        {/* Trunk: sits behind the button, from button-center (y=24) downward */}
        <svg
          className="pointer-events-none absolute left-0 top-0 h-full w-9"
          style={{ zIndex: 0 }}
        >
          <line
            x1={TRUNK_X}
            y1={24}
            x2={TRUNK_X}
            y2="100%"
            stroke={`${ROOT_COLOR}55`}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        {/* Button + toolbar — button starts flush-left, overlapping the trunk */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-[15rem] justify-between gap-2 rounded-full"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <img
                    src="/one-shot-logo.svg"
                    alt="Project logo"
                    className="h-4 w-4 shrink-0"
                  />
                  <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  <span className="truncate text-xs font-medium">
                    {selectedProject}
                  </span>
                </span>
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[20rem] p-2">
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Search project"
                className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              />
              <DropdownMenuItem
                className="cursor-pointer rounded-md text-xs"
                onClick={() => setSelectedProject("one-shot-platform")}
              >
                <img
                  src="/one-shot-logo.svg"
                  alt=""
                  className="mr-2 h-3.5 w-3.5"
                />
                one-shot-platform
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                Mock selector for now
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-1.5">
            <ActionIconButton
              tooltip="Filter"
              onClick={() => setShowFilters((previous) => !previous)}
              variant="ghost"
            >
              <FilterIcon className="h-4 w-4" />
            </ActionIconButton>
            <ActionIconButton
              tooltip="Rescan"
              onClick={() => {
                void rescan();
              }}
              disabled={busyAction.length > 0}
              variant="ghost"
            >
              <RefreshCwIcon className="h-4 w-4" />
            </ActionIconButton>
            <ActionIconButton
              tooltip={showSearch ? "Hide search" : "Search"}
              onClick={() => setShowSearch((previous) => !previous)}
              variant="ghost"
            >
              {showSearch ? (
                <XIcon className="h-4 w-4" />
              ) : (
                <SearchIcon className="h-4 w-4" />
              )}
            </ActionIconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={busyAction.length > 0}
                >
                  <WrenchIcon className="h-4 w-4" />
                  <span className="sr-only">Recovery actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[15rem] p-1.5">
                <DropdownMenuItem
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    void runRecoveryAction("stop-all");
                  }}
                >
                  <PowerIcon className="mr-2 h-3.5 w-3.5" />
                  Stop all services
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    void runRecoveryAction("restart-all");
                  }}
                >
                  <RotateCcwIcon className="mr-2 h-3.5 w-3.5" />
                  Restart enabled
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    void runRecoveryAction("cleanup-stale");
                  }}
                >
                  <RefreshCwIcon className="mr-2 h-3.5 w-3.5" />
                  Cleanup stale entries
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer text-xs text-red-500 focus:text-red-500"
                  onClick={() => {
                    void runRecoveryAction("hard-reset");
                  }}
                >
                  <Trash2Icon className="mr-2 h-3.5 w-3.5" />
                  Hard reset PM2
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {maintenanceFeedback ? (
        <div className={COL}>
          <TrunkPassthrough />
          <div className="py-1">
            <div className="rounded-md border border-blue-300/30 bg-blue-500/10 px-2.5 py-1.5 text-[11px] text-foreground/90 select-text">
              {maintenanceFeedback}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Search input — trunk passes through unbroken ── */}
      {showSearch ? (
        <div className={COL}>
          <TrunkPassthrough />
          <div className="py-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by branch, name, path"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs"
            />
          </div>
        </div>
      ) : null}

      {/* ── Filter chips — trunk passes through ── */}
      {showFilters ? (
        <div className={`${COL} items-center`}>
          <TrunkPassthrough />
          <div className="flex flex-wrap items-center gap-1.5 py-1">
            {(
              [
                "all",
                "active",
                "inactive",
                "disconnected",
                "stale",
              ] as WorktreeFilter[]
            ).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filter === value ? "default" : "outline"}
                className="h-7 text-[11px] capitalize"
                onClick={() => setFilter(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Worktree rows ── No spacing between rows; spacing lives inside pb-2 on the card wrapper */}
      {filteredRows.length === 0 ? (
        <div className={COL}>
          <TrunkPassthrough />
          <div className="py-1">
            <Card className="p-3 text-xs text-muted-foreground">
              No worktrees match current filters.
            </Card>
          </div>
        </div>
      ) : (
        filteredRows.map((row, index) => {
          const key = row.worktreeKey;
          const isLast = index === filteredRows.length - 1;
              const detailsVisible = Boolean(detailsOpen[key]);
              const selectedForLogs = logsTargetKey === key;
              const branchColor = BRANCH_COLORS[index % BRANCH_COLORS.length];
              const isCurrentRow =
                currentWorktreeStatus?.ok &&
                currentWorktreeStatus.worktreeKey === key;
              const appExternallyOwned = Boolean(
                isCurrentRow &&
                  currentWorktreeStatus?.appOwnership === "external",
              );
              const cloudManagedOrExternal =
                row.status.cloud === "online" ||
                row.status.cloud === "launching" ||
                row.status.cloud === "external";
              const appManagedOrExternal =
                row.status.app === "online" ||
                row.status.app === "launching" ||
                row.status.app === "external";
              const isRunning = cloudManagedOrExternal || appManagedOrExternal;
              const primaryAction: "start" | "stop" = appExternallyOwned
                ? (cloudManagedOrExternal ? "stop" : "start")
                : (isRunning ? "stop" : "start");
              const serviceFilterForRow = appExternallyOwned
                ? (["cloud"] as Array<"cloud" | "app">)
                : undefined;
              const feedback = actionFeedbackByKey[key]?.trim() || "";
              const detailsText = [
                `name: ${rowLabel(row)}`,
            `worktreeKey: ${row.worktreeKey}`,
            `path: ${row.path}`,
            `branch: ${row.branch}`,
            `profile: ${row.profile ?? "-"}`,
            `profileSource: ${row.profileSource}`,
            `ports: cloud=${String(row.ports.cloudPort ?? "-")} app=${String(row.ports.appPort ?? "-")}`,
            `userDataDir: ${row.userDataDir}`,
            `cloudProcess: ${row.cloudProcessName}`,
            `appProcess: ${row.appProcessName}`,
            `status: cloud=${row.status.cloud} app=${row.status.app}`,
            `ownership: cloud=${isCurrentRow ? (currentWorktreeStatus?.cloudOwnership ?? "-") : "-"} app=${isCurrentRow ? (currentWorktreeStatus?.appOwnership ?? "-") : "-"}`,
          ].join("\n");

          return (
            <div key={key} className={COL}>
              {/*
               * Gutter column — 36px wide.
               * Trunk (ROOT_COLOR) runs from y=0 to y=BRANCH_Y (last row) or y=100% (all others).
               * y=100% includes the pb-2 on the card wrapper, so the trunk seamlessly
               * connects into the top of the next row's y=0 with zero gap.
               *
               * Branch (branchColor): horizontal line from trunk to the dot.
               * Dot: circle at the right end of the branch, right before the card.
               *      |
               *      |──────o  <card>
               *      |
               */}
              <div className="relative">
                <svg className="absolute inset-0 h-full w-full">
                  {/*
                   * Trunk continuation below the branch — ROOT_COLOR, drawn first so the
                   * J-curve renders on top where they overlap near BRANCH_Y.
                   */}
                  {!isLast && (
                    <line
                      x1={TRUNK_X}
                      y1={BRANCH_Y}
                      x2={TRUNK_X}
                      y2="100%"
                      stroke={`${ROOT_COLOR}55`}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  )}

                  {/*
                   * Bezier J-curve connector (GitLens / React Flow smooth-edge style).
                   *
                   * M TRUNK_X,0            — start at top of this row (connects to trunk above)
                   * C TRUNK_X,BRANCH_Y     — CP1: pull straight DOWN from start → looks like trunk
                   *   DOT_X-4,BRANCH_Y    — CP2: approach from left at dot height → arrives horizontally
                   *   DOT_X,BRANCH_Y      — end at the dot
                   *
                   * Result:  ↓ (straight) → curves smoothly → ─── dot
                   */}
                  <path
                    d={`M ${TRUNK_X},0 C ${TRUNK_X},${BRANCH_Y} ${DOT_X - 4},${BRANCH_Y} ${DOT_X},${BRANCH_Y}`}
                    fill="none"
                    stroke={branchColor}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />

                  {/* Dot at the tip of the J-curve */}
                  <circle
                    cx={DOT_X}
                    cy={BRANCH_Y}
                    r="4.5"
                    fill="white"
                    stroke={branchColor}
                    strokeWidth="2"
                  />
                </svg>
              </div>

              {/* Card wrapper — pb-2 creates the inter-card gap; trunk covers it */}
              <div className={isLast ? "" : "pb-2"}>
                <Card
                  className="space-y-2 bg-transparent p-2.5"
                  style={{ borderColor: `${branchColor}44` }}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {rowLabel(row)}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {row.branch}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <ServiceBadge label="cloud" status={row.status.cloud} />
                      <ServiceBadge label="app" status={row.status.app} />
                      {appExternallyOwned ? (
                        <span className="rounded border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                          app external
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <ActionIconButton
                        tooltip={isRunning ? "Stop" : "Start"}
                        onClick={() => {
                          void runAction(primaryAction, {
                            type: "worktree",
                            worktreeKey: key,
                          }, serviceFilterForRow);
                        }}
                        disabled={busyAction.length > 0}
                        active={primaryAction === "stop"}
                      >
                        {primaryAction === "stop" ? (
                          <SquareIcon className="h-4 w-4" />
                        ) : (
                          <PlayIcon className="h-4 w-4" />
                        )}
                      </ActionIconButton>
                      <ActionIconButton
                        tooltip="Restart"
                        onClick={() => {
                          void runAction("restart", {
                            type: "worktree",
                            worktreeKey: key,
                          }, serviceFilterForRow);
                        }}
                        disabled={busyAction.length > 0}
                      >
                        <RotateCcwIcon className="h-4 w-4" />
                      </ActionIconButton>
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(checked) => {
                          void setWorktreeEnabled(key, checked);
                        }}
                        disabled={busyAction.length > 0}
                        className="data-[state=checked]:bg-emerald-500"
                        aria-label={`Enable ${rowLabel(row)}`}
                      />
                      <ActionIconButton
                        tooltip="Details"
                        onClick={() =>
                          setDetailsOpen((previous) => ({
                            ...previous,
                            [key]: !previous[key],
                          }))
                        }
                        active={detailsVisible}
                      >
                        <ListFilterIcon className="h-4 w-4" />
                      </ActionIconButton>
                      <ActionIconButton
                        tooltip="Open logs"
                        onClick={() => {
                          setLogsTargetKey((previous) =>
                            previous === key ? null : key,
                          );
                          stopLiveCapture();
                          setStdout([]);
                          setStderr([]);
                          setLogsError("");
                        }}
                        active={selectedForLogs}
                      >
                        <TerminalSquareIcon className="h-4 w-4" />
                      </ActionIconButton>
                    </div>
                  </div>

                  {feedback ? (
                    <div className="rounded-md border border-amber-400/30 bg-amber-500/8 px-2 py-1.5">
                      <p className="text-[11px] text-foreground/90 select-text">{feedback}</p>
                    </div>
                  ) : null}

                  {detailsVisible ? (
                    <div className="mt-1 border-t border-border/60 pt-2">
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                        Details
                      </p>
                      {row.blockedReason ? (
                        <div className="mb-2 rounded-md border border-red-400/35 bg-gradient-to-r from-red-500/8 via-transparent to-transparent p-2">
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-red-500">
                            <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
                            {row.blockedCategory ? `Blocked: ${row.blockedCategory}` : 'Config issue'}
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <p className="whitespace-pre-wrap break-all text-[11px] text-foreground/90 select-text">
                                {row.blockedReason}
                              </p>
                              {row.blockedCategory && BLOCKED_CATEGORY_GUIDANCE[row.blockedCategory] ? (
                                <p className="text-[11px] text-muted-foreground italic">
                                  {BLOCKED_CATEGORY_GUIDANCE[row.blockedCategory]}
                                </p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 shrink-0 px-2 text-[11px]"
                              onClick={async () => {
                                const copied = await copyText(row.blockedReason ?? "");
                                if (copied) {
                                  setCopiedSignal(`error:${key}`);
                                  window.setTimeout(() => setCopiedSignal(""), 1200);
                                }
                              }}
                            >
                              {copiedSignal === `error:${key}` ? (
                                <CheckIcon className="mr-1 h-3 w-3" />
                              ) : (
                                <CopyIcon className="mr-1 h-3 w-3" />
                              )}
                              Copy
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {loadError ? (
                        <div className="mb-2 rounded-md border border-orange-400/35 bg-gradient-to-r from-orange-500/8 via-transparent to-transparent p-2">
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-orange-500">
                            <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
                            Orchestrator status
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <p className="whitespace-pre-wrap break-all text-[11px] text-foreground/90 select-text">
                              {loadError}
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 shrink-0 px-2 text-[11px]"
                              onClick={async () => {
                                const copied = await copyText(loadError);
                                if (copied) {
                                  setCopiedSignal(`load:${key}`);
                                  window.setTimeout(() => setCopiedSignal(""), 1200);
                                }
                              }}
                            >
                              {copiedSignal === `load:${key}` ? (
                                <CheckIcon className="mr-1 h-3 w-3" />
                              ) : (
                                <CopyIcon className="mr-1 h-3 w-3" />
                              )}
                              Copy
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <pre className="max-h-44 overflow-auto rounded-md border border-border/60 bg-background/50 p-2 text-[11px] leading-5 text-muted-foreground select-text">
                        {detailsText}
                      </pre>
                      <div className="mt-1 flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={async () => {
                            const copied = await copyText(detailsText);
                            if (copied) {
                              setCopiedSignal(`details:${key}`);
                              window.setTimeout(
                                () => setCopiedSignal(""),
                                1200,
                              );
                            }
                          }}
                        >
                          {copiedSignal === `details:${key}` ? (
                            <CheckIcon className="mr-1 h-3 w-3" />
                          ) : (
                            <CopyIcon className="mr-1 h-3 w-3" />
                          )}
                          Copy
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </div>
            </div>
          );
        })
      )}

      {logsTargetRow ? (
        <Card className="relative z-10 mt-6 space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Logs • {rowLabel(logsTargetRow)}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setLogsTargetKey(null);
                stopLiveCapture();
              }}
            >
              <XIcon className="mr-1 h-3.5 w-3.5" />
              Close
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedProcessByKey[logsTargetRow.worktreeKey] ?? ""}
              onChange={(event) =>
                setSelectedProcessByKey((previous) => ({
                  ...previous,
                  [logsTargetRow.worktreeKey]: event.target.value,
                }))
              }
              className="h-8 min-w-[14rem] rounded-md border border-border bg-background px-2 text-[11px]"
            >
              {logsTargetProcesses.length === 0 ? (
                <option value="">No PM2-managed process</option>
              ) : (
                logsTargetProcesses.map((process) => (
                  <option key={process.name} value={process.name}>
                    {process.kind} ({process.status})
                  </option>
                ))
              )}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void loadLogs();
              }}
            >
              Reload
            </Button>
            {liveMode ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={stopLiveCapture}
              >
                Stop live
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void startLiveCapture();
                }}
              >
                Live
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                const copied = await copyText(
                  [...stdout, ...stderr].join("\n"),
                );
                if (copied) {
                  setCopiedSignal("logs:all");
                  window.setTimeout(() => setCopiedSignal(""), 1200);
                }
              }}
            >
              {copiedSignal === "logs:all" ? (
                <CheckIcon className="mr-1 h-3.5 w-3.5" />
              ) : (
                <CopyIcon className="mr-1 h-3.5 w-3.5" />
              )}
              Copy logs
            </Button>
            {liveMode ? (
              <span className="text-[11px] text-emerald-600">
                Live since{" "}
                {liveStartedAtMs
                  ? new Date(liveStartedAtMs).toLocaleTimeString()
                  : "now"}
              </span>
            ) : null}
          </div>

          {logsError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 select-text">
              {logsError}
            </div>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                stdout
              </p>
              <pre className="max-h-56 overflow-auto rounded border border-border bg-background p-2 text-[11px] leading-5 select-text">
                {stdout.join("\n") || "(empty)"}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                stderr
              </p>
              <pre className="max-h-56 overflow-auto rounded border border-border bg-background p-2 text-[11px] leading-5 select-text">
                {stderr.join("\n") || "(empty)"}
              </pre>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="text-[11px] text-muted-foreground">
        <p>
          PM2: {health.pm2Connected ? "connected" : "disconnected"} •{" "}
          {health.enabledCount} enabled • {health.worktreeCount} total
        </p>
      </div>
    </div>
  );
}
