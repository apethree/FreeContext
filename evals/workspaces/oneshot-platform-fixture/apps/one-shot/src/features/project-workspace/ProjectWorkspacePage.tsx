import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useAppShellContext } from "@/features/app/AppShellContext";
import { safeProjectName } from "@/features/app/defaults";
import { PageContentContainer } from "@/features/app/PageContentContainer";
import { progressPercent } from "@/features/project-workspace/helpers";
import { createWorkspaceSnapshot, workspaceSnapshotKey } from "@/features/project-workspace/mockData";
import { ProjectWorkspaceHeader } from "@/features/project-workspace/ProjectWorkspaceHeader";
import { WorkspaceDagCanvas } from "@/features/project-workspace/WorkspaceDagCanvas";
import { WorkspaceLeftPanel } from "@/features/project-workspace/WorkspaceLeftPanel";
import { WorkspaceRightPanel } from "@/features/project-workspace/WorkspaceRightPanel";
import { patchWorkspaceNode, upsertWorkspace } from "@/features/project-workspace/workspaceState";
import type { ProjectWorkspaceSnapshot } from "@/features/project-workspace/types";
import { ChatSurface } from "@/features/chat/ChatSurface";

function withSnapshotUpdate(
  setAppState: ReturnType<typeof useAppShellContext>["setAppState"],
  projectPath: string,
  runId: string,
  updater: (snapshot: ProjectWorkspaceSnapshot) => ProjectWorkspaceSnapshot,
) {
  setAppState((previous) => {
    const key = workspaceSnapshotKey(projectPath, runId);
    const profile = previous.projectProfiles[projectPath];
    const baseSnapshot =
      previous.projectWorkspaces[key] ||
      createWorkspaceSnapshot(projectPath, runId, profile?.displayName || safeProjectName(projectPath));
    return upsertWorkspace(previous, updater(baseSnapshot));
  });
}

export function ProjectWorkspacePage() {
  const { projectId, runId } = useParams();
  const { appState, setAppState, onOpenProject } = useAppShellContext();
  const decodedProjectPath = projectId ? decodeURIComponent(projectId) : appState.selectedProjectPath;
  const profile = decodedProjectPath ? appState.projectProfiles[decodedProjectPath] : null;
  const activeRunId =
    runId ||
    (decodedProjectPath ? appState.selectedRunByProject[decodedProjectPath] : "") ||
    profile?.runs[0]?.id ||
    "";
  const workspaceKey = workspaceSnapshotKey(decodedProjectPath || "", activeRunId);
  const snapshot = decodedProjectPath ? appState.projectWorkspaces[workspaceKey] : undefined;
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    if (!decodedProjectPath || !profile || !activeRunId) return;
    if (snapshot) return;
    setAppState((previous) => {
      const nextSnapshot = createWorkspaceSnapshot(decodedProjectPath, activeRunId, profile.displayName);
      return {
        ...previous,
        projectWorkspaces: {
          ...previous.projectWorkspaces,
          [workspaceSnapshotKey(decodedProjectPath, activeRunId)]: nextSnapshot,
        },
      };
    });
  }, [activeRunId, decodedProjectPath, profile, setAppState, snapshot]);

  useEffect(() => {
    if (!snapshot?.nodes.length) return;
    const activeNodeId = snapshot.runState.activeNodeId || snapshot.nodes[0]?.id || "";
    setSelectedNodeId((previous) => (snapshot.nodes.some((node) => node.id === previous) ? previous : activeNodeId));
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || !selectedNodeId) return;
    const selectedNode = snapshot.nodes.find((node) => node.id === selectedNodeId);
    setNoteDraft(selectedNode?.notes || "");
  }, [selectedNodeId, snapshot]);

  const selectedNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === selectedNodeId) || null,
    [selectedNodeId, snapshot],
  );

  if (!decodedProjectPath || !profile) {
    return (
      <PageContentContainer>
        <Card className="border-border/70 bg-card/85 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Project not found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The selected project is not available in local shell state.
            </p>
          </CardContent>
        </Card>
      </PageContentContainer>
    );
  }

  if (!activeRunId || !snapshot) {
    return (
      <PageContentContainer>
        <Card className="border-border/70 bg-card/85 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Loading workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Preparing run context…</p>
          </CardContent>
        </Card>
      </PageContentContainer>
    );
  }

  const progress = progressPercent(snapshot);

  const onRefresh = () => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      events: [
        {
          id: `evt-refresh-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "workspace_refreshed",
          node_id: current.runState.activeNodeId,
          details: "Workspace refreshed from local snapshot.",
          payload: {},
        },
        ...current.events,
      ],
      lastUpdatedAt: new Date().toISOString(),
    }));
  };

  const onStart = () => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      runState: {
        ...current.runState,
        haltReason: "none",
        haltNodeId: "",
        haltDetails: "",
        updatedAt: new Date().toISOString(),
      },
      events: [
        {
          id: `evt-start-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "run_started",
          node_id: current.runState.activeNodeId,
          details: "Run started in local mode.",
          payload: {},
        },
        ...current.events,
      ],
    }));
  };

  const onPause = () => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      runState: {
        ...current.runState,
        haltReason: "needs_user_input",
        haltNodeId: current.runState.activeNodeId,
        haltDetails: "Paused manually by user.",
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const onStop = () => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      runState: {
        ...current.runState,
        haltReason: "error",
        haltNodeId: current.runState.activeNodeId,
        haltDetails: "Stopped manually by user.",
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const onApprove = () => {
    if (!selectedNodeId) return;
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => {
      const patched = patchWorkspaceNode(current, selectedNodeId, { status: "done" });
      return {
        ...patched,
        runState: {
          ...patched.runState,
          lastCompletedNodeId: selectedNodeId,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const onSaveNodeNote = () => {
    if (!selectedNodeId) return;
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) =>
      patchWorkspaceNode(current, selectedNodeId, { notes: noteDraft }),
    );
  };

  const onApproveStagedChange = (changeId: string) => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      stagedChanges: current.stagedChanges.filter((change) => change.id !== changeId),
      lastUpdatedAt: new Date().toISOString(),
    }));
  };

  const onRejectStagedChange = (changeId: string) => {
    withSnapshotUpdate(setAppState, decodedProjectPath, activeRunId, (current) => ({
      ...current,
      stagedChanges: current.stagedChanges.filter((change) => change.id !== changeId),
      events: [
        {
          id: `evt-reject-${changeId}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "staged_change_rejected",
          node_id: selectedNodeId || current.runState.activeNodeId,
          details: `Rejected staged change ${changeId}.`,
          payload: {},
        },
        ...current.events,
      ],
      lastUpdatedAt: new Date().toISOString(),
    }));
  };

  return (
    <PageContentContainer className="min-h-0">
      <ProjectWorkspaceHeader
        projectName={profile.displayName || safeProjectName(decodedProjectPath)}
        projectPath={decodedProjectPath}
        runs={profile.runs}
        activeRunId={activeRunId}
        snapshot={snapshot}
        progress={progress}
        onSelectRun={(nextRunId) => onOpenProject(decodedProjectPath, nextRunId)}
        onRefresh={onRefresh}
        onStart={onStart}
        onPause={onPause}
        onStop={onStop}
        onApprove={onApprove}
      />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1 gap-3">
        <ResizablePanel defaultSize="22%" minSize="18%" className="min-w-0 overflow-hidden">
          <WorkspaceLeftPanel
            nodes={snapshot.nodes}
            events={snapshot.events}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50%" minSize="36%" className="min-w-0 overflow-hidden">
          <WorkspaceDagCanvas
            nodes={snapshot.nodes}
            edges={snapshot.edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="28%" minSize="20%" className="min-w-0 overflow-hidden">
          <WorkspaceRightPanel
            snapshot={snapshot}
            selectedNode={selectedNode}
            noteDraft={noteDraft}
            onNoteDraftChange={setNoteDraft}
            onSaveNodeNote={onSaveNodeNote}
            onApproveStagedChange={onApproveStagedChange}
            onRejectStagedChange={onRejectStagedChange}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <div className="mt-3">
        <ChatSurface />
      </div>
    </PageContentContainer>
  );
}
