import type {
  AppShellState,
  AssistantScope,
  ProjectProfile,
  ProjectRun,
} from '@/features/app/types';
import {
  DEFAULT_CREATE_PROJECT_DRAFT,
} from '@/features/project-workspace/mockData';

let runIdCounter = 0;
const PROJECT_NAME_ADJECTIVES = [
  'rapid',
  'bright',
  'swift',
  'clear',
  'bold',
  'steady',
  'smart',
  'fresh',
  'prime',
  'neat',
];
const PROJECT_NAME_NOUNS = [
  'orbit',
  'canvas',
  'forge',
  'signal',
  'vector',
  'studio',
  'ledger',
  'pilot',
  'kernel',
  'atlas',
];

export function globalAssistantSessionId(scope: AssistantScope): string {
  return `assistant:global:${scope}`;
}

export function globalAssistantModeSessionId(mode: AppShellState['activeMode']): string {
  return globalAssistantSessionId(mode);
}

function nextRunId() {
  runIdCounter += 1;
  return `run-${Date.now()}-${runIdCounter}`;
}

function randomFromList(values: readonly string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? 'project';
}

export function generateCreateLaunchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `launch-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function generateDefaultProjectName(): string {
  return `${randomFromList(PROJECT_NAME_ADJECTIVES)}-${randomFromList(PROJECT_NAME_NOUNS)}-app`;
}

export function createDefaultCreateProjectDraft() {
  return {
    ...DEFAULT_CREATE_PROJECT_DRAFT,
    projectName: generateDefaultProjectName(),
    createStep: 'curate' as const,
    progressMessage: '',
  };
}

export function safeProjectName(projectPath: string): string {
  const normalized = projectPath.trim().replace(/\\/g, '/');
  if (!normalized) return 'unnamed-project';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export function createRun(projectPath: string, runName?: string): ProjectRun {
  const timestamp = Date.now();
  return {
    id: nextRunId(),
    projectId: projectPath,
    name: runName?.trim() || `Run ${new Date(timestamp).toLocaleDateString()}`,
    createdAt: timestamp,
    isHidden: false,
    isBookmarked: false,
    isArchived: false,
  };
}

export function defaultProjectProfile(projectPath: string): ProjectProfile {
  const run = createRun(projectPath, 'Initial run');
  return {
    skills: [],
    agents: [],
    technologies: [],
    displayName: safeProjectName(projectPath),
    createdAt: Date.now(),
    isBookmarked: false,
    isExpanded: true,
    isHidden: false,
    isArchived: false,
    runsHidden: false,
    runs: [run],
    updatedAt: new Date().toISOString(),
  };
}

export const DEFAULT_APP_STATE: AppShellState = {
  activeMode: 'work',
  lastMode: 'work',
  settingsSection: 'General',
  projectPaths: [],
  selectedProjectPath: '',
  selectedRunByProject: {},
  projectProfiles: {},
  projectBookmarks: {},
  sidebarWidthPx: 304,
  sidebarCollapsed: false,
  homeGettingStartedOpen: true,
  homeDashboardOpen: true,
  selectedEditor: 'vscode',
  terminalOpen: false,
  assistantWorkspace: {
    activeScope: 'all',
    selectedSessionIdByScope: {
      all: globalAssistantSessionId('all'),
      work: globalAssistantSessionId('work'),
      finance: globalAssistantSessionId('finance'),
      social: globalAssistantSessionId('social'),
      health: globalAssistantSessionId('health'),
      chats: globalAssistantSessionId('chats'),
      mail: globalAssistantSessionId('mail'),
    },
    manualSessions: [],
    drawer: {
      kind: 'none',
      modeFilter: 'all',
    },
  },
  sortMode: 'created',
  createLaunchId: generateCreateLaunchId(),
  createProjectDraft: createDefaultCreateProjectDraft(),
  projectWorkspaces: {},
};
