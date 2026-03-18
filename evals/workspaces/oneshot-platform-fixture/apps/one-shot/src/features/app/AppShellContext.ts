import type React from 'react';
import { useOutletContext } from 'react-router-dom';
import type {
  AppMode,
  AppShellState,
  AssistantManualSession,
  AssistantScope,
  OpenTarget,
} from '@/features/app/types';
import type { CreateProjectDraft } from '@/features/project-workspace/types';
import type { AssistantChannelSession } from '@/features/assistant-chat/useAssistantWorkspaceStore';

type AssistantWorkspaceContext = {
  activeScope: AssistantScope;
  globalSessionId: string;
  selectedSessionId: string;
  manualSessions: AssistantManualSession[];
  channelSessions: AssistantChannelSession[];
  drawerKind: AppShellState['assistantWorkspace']['drawer']['kind'];
  drawerModeFilter: AssistantScope;
  setActiveScope: (scope: AssistantScope) => void;
  setDrawer: (kind: AppShellState['assistantWorkspace']['drawer']['kind'], modeFilter?: AssistantScope) => void;
  closeDrawer: () => void;
  selectSession: (sessionId: string) => void;
  createManualSession: () => string;
  renameManualSession: (sessionId: string, title: string) => void;
  deleteManualSession: (sessionId: string) => void;
};

export type AppShellContextValue = {
  appState: AppShellState;
  pageTitle: string;
  selectedProjectName: string;
  setAppState: React.Dispatch<React.SetStateAction<AppShellState>>;
  assistantWorkspace: AssistantWorkspaceContext;
  onOpenHome: () => void;
  onOpenSkills: () => void;
  onOpenTemplates: () => void;
  onOpenStyleLab: () => void;
  onOpenOneShot: () => void;
  onOpenOpenClawDemo: () => void;
  onOpenOpenClawHostedPhase: () => void;
  onOpenLive: () => void;
  onOpenAssistantChat: () => void;
  onCreateProject: () => void;
  onOpenSettings: (section?: string) => void;
  onOpenProject: (projectPath: string, runId?: string) => void;
  onCreateProjectFromDraft: (draft: CreateProjectDraft) => void;
  onOpenExistingProject: () => Promise<void>;
  onSelectOpenTarget: (target: OpenTarget) => Promise<void>;
  onOpenTerminal: () => void;
  onSetActiveMode: (mode: AppMode) => void;
  onSwitchMode: (mode: AppMode) => void;
  onSignOut: () => Promise<void>;
};

export function useAppShellContext() {
  return useOutletContext<AppShellContextValue>();
}
