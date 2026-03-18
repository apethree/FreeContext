import type { NodeStatus, ProjectWorkspaceSnapshot, WorkspaceNode } from "@/features/project-workspace/types";

export const NODE_STATUS_ORDER: NodeStatus[] = [
  "in_progress",
  "ready",
  "blocked_user_input",
  "blocked_review",
  "pending",
  "done",
  "failed",
];

export function statusLabel(status: NodeStatus) {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "blocked_user_input":
      return "Needs input";
    case "blocked_review":
      return "Needs review";
    case "ready":
      return "Ready";
    case "pending":
      return "Pending";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function statusBadgeClass(status: NodeStatus) {
  switch (status) {
    case "in_progress":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "ready":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "done":
      return "bg-teal-500/15 text-teal-700 dark:text-teal-300";
    case "blocked_user_input":
    case "blocked_review":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "failed":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "pending":
    default:
      return "bg-neutral-500/15 text-neutral-700 dark:text-neutral-300";
  }
}

export function progressPercent(snapshot: ProjectWorkspaceSnapshot) {
  if (!snapshot.nodes.length) return 0;
  const done = snapshot.nodes.filter((node) => node.status === "done").length;
  return Math.round((done / snapshot.nodes.length) * 100);
}

export function sortNodes(nodes: WorkspaceNode[]) {
  return [...nodes].sort((a, b) => {
    const statusDelta =
      NODE_STATUS_ORDER.indexOf(a.status) - NODE_STATUS_ORDER.indexOf(b.status);
    if (statusDelta !== 0) return statusDelta;
    return a.priority - b.priority;
  });
}
