import { workspaceSnapshotKey } from "@/features/project-workspace/mockData";
import type { AppShellState } from "@/features/app/types";
import type {
  ProjectWorkspaceSnapshot,
  WorkspaceNode,
} from "@/features/project-workspace/types";

export function upsertWorkspace(
  state: AppShellState,
  snapshot: ProjectWorkspaceSnapshot,
): AppShellState {
  const key = workspaceSnapshotKey(snapshot.projectPath, snapshot.runId);
  return {
    ...state,
    projectWorkspaces: {
      ...state.projectWorkspaces,
      [key]: snapshot,
    },
  };
}

export function patchWorkspaceNode(
  snapshot: ProjectWorkspaceSnapshot,
  nodeId: string,
  patch: Partial<WorkspaceNode>,
): ProjectWorkspaceSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    ),
    lastUpdatedAt: new Date().toISOString(),
  };
}
