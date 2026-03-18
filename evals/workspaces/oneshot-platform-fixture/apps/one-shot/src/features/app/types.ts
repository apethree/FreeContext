import type {
  CreateProjectDraft,
  ProjectWorkspaceSnapshot,
} from "@/features/project-workspace/types";

export type SortMode = 'name' | 'created' | 'manual';
export type OpenTarget = 'vscode' | 'cursor' | 'zed' | 'finder' | 'ghostty';
export type AppMode = 'work' | 'finance' | 'social' | 'health' | 'chats' | 'mail';
export type AssistantScope = 'all' | AppMode;
export type SidebarModeSelection = 'oneshot' | AppMode;
export type AssistantManualSession = {
  id: string;
  title: string;
  scope: AssistantScope;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AssistantWorkspaceState = {
  activeScope: AssistantScope;
  selectedSessionIdByScope: Record<AssistantScope, string>;
  manualSessions: AssistantManualSession[];
  drawer: {
    kind: 'none' | 'status' | 'review';
    modeFilter: AssistantScope;
  };
};

export type SettingsSection =
  | 'General'
  | 'Billing'
  | 'Connect Accounts'
  | 'Manage Channels'
  | 'Hook Routes'
  | 'Archived projects'
  | 'MCP servers'
  | 'Git'
  | 'Environments'
  | 'Worktrees'
  | 'Archived threads';

export interface ProjectRun {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  isHidden: boolean;
  isBookmarked: boolean;
  isArchived: boolean;
}

export interface ProjectProfile {
  skills: string[];
  agents: string[];
  technologies: string[];
  displayName: string;
  createdAt: number;
  isBookmarked: boolean;
  isExpanded: boolean;
  isHidden: boolean;
  isArchived: boolean;
  runsHidden: boolean;
  runs: ProjectRun[];
  updatedAt: string;
}

export interface AppShellState {
  activeMode: AppMode;
  lastMode: AppMode;
  settingsSection: SettingsSection;
  projectPaths: string[];
  selectedProjectPath: string;
  selectedRunByProject: Record<string, string>;
  projectProfiles: Record<string, ProjectProfile>;
  projectBookmarks: Record<string, boolean>;
  sidebarWidthPx: number;
  sidebarCollapsed: boolean;
  homeGettingStartedOpen: boolean;
  homeDashboardOpen: boolean;
  selectedEditor: OpenTarget;
  terminalOpen: boolean;
  assistantWorkspace: AssistantWorkspaceState;
  sortMode: SortMode;
  createLaunchId: string;
  createProjectDraft: CreateProjectDraft;
  projectWorkspaces: Record<string, ProjectWorkspaceSnapshot>;
}

export interface TerminalSessionInfo {
  sessionId: string;
  cwd: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

export interface TerminalExitEvent {
  sessionId: string;
  code: number | null;
  signal: string | null;
}
