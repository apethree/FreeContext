import { useEffect, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SETTINGS_SECTIONS } from '@/features/app/constants';
import { DEFAULT_APP_STATE, globalAssistantSessionId } from '@/features/app/defaults';
import { appShellHydratedAtom, appShellStateAtom } from '@/features/app/state';
import type {
  AppMode,
  AppShellState,
  AssistantScope,
  SettingsSection,
} from '@/features/app/types';

const persistedStateSchema = z.object({
  activeMode: z.string().optional(),
  lastMode: z.string().optional(),
  settingsSection: z.string().optional(),
  projectPaths: z.array(z.string()).optional(),
  selectedProjectPath: z.string().optional(),
  selectedRunByProject: z.record(z.string(), z.string()).optional(),
  projectProfiles: z.record(z.string(), z.unknown()).optional(),
  projectBookmarks: z.record(z.string(), z.boolean()).optional(),
  sidebarWidthPx: z.number().optional(),
  sidebarCollapsed: z.boolean().optional(),
  homeGettingStartedOpen: z.boolean().optional(),
  homeDashboardOpen: z.boolean().optional(),
  selectedEditor: z.enum(['vscode', 'cursor', 'zed', 'finder', 'ghostty']).optional(),
  terminalOpen: z.boolean().optional(),
  sortMode: z.enum(['name', 'created', 'manual']).optional(),
  createLaunchId: z.string().optional(),
  createProjectDraft: z.record(z.string(), z.unknown()).optional(),
  projectWorkspaces: z.record(z.string(), z.unknown()).optional(),
  assistantWorkspace: z.object({
    activeScope: z.string().optional(),
    selectedSessionIdByScope: z.record(z.string(), z.string()).optional(),
    // Legacy key kept for migration.
    selectedSessionIdByMode: z.record(z.string(), z.string()).optional(),
    manualSessions: z.array(z.object({
      id: z.string(),
      title: z.string(),
      scope: z.string().optional(),
      mode: z.string().optional(),
      createdAtMs: z.number(),
      updatedAtMs: z.number(),
    })).optional(),
    drawer: z.object({
      kind: z.enum(['none', 'status', 'review']).optional(),
      modeFilter: z.string().optional(),
    }).optional(),
  }).optional(),
});

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

function normalizePersistedMode(value?: string): AppMode | undefined {
  if (value === 'work' || value === 'finance' || value === 'social' || value === 'health' || value === 'chats' || value === 'mail') {
    return value;
  }
  if (value === 'logistics') return 'social';
  if (value === 'communication') return 'chats';
  return undefined;
}

function normalizeAssistantScope(value?: string): AssistantScope | undefined {
  if (value === 'all') return 'all';
  return normalizePersistedMode(value);
}

function mergeState(rawState: unknown): AppShellState {
  const parsed = persistedStateSchema.safeParse(rawState);
  if (!parsed.success) {
    return DEFAULT_APP_STATE;
  }
  const nextState = parsed.data;
  const settingsSection =
    typeof nextState.settingsSection === 'string' && isSettingsSection(nextState.settingsSection)
      ? nextState.settingsSection
      : DEFAULT_APP_STATE.settingsSection;

  const merged: AppShellState = {
    ...DEFAULT_APP_STATE,
    ...nextState,
    activeMode: normalizePersistedMode(nextState.activeMode) ?? DEFAULT_APP_STATE.activeMode,
    lastMode: normalizePersistedMode(nextState.lastMode) ?? DEFAULT_APP_STATE.lastMode,
    settingsSection,
    projectProfiles: {
      ...DEFAULT_APP_STATE.projectProfiles,
      ...(nextState.projectProfiles as AppShellState['projectProfiles'] | undefined),
    },
    selectedRunByProject: {
      ...DEFAULT_APP_STATE.selectedRunByProject,
      ...(nextState.selectedRunByProject ?? {}),
    },
    projectBookmarks: {
      ...DEFAULT_APP_STATE.projectBookmarks,
      ...(nextState.projectBookmarks ?? {}),
    },
    createProjectDraft: {
      ...DEFAULT_APP_STATE.createProjectDraft,
      ...(nextState.createProjectDraft as AppShellState['createProjectDraft'] | undefined),
    },
    projectWorkspaces: {
      ...DEFAULT_APP_STATE.projectWorkspaces,
      ...(nextState.projectWorkspaces as AppShellState['projectWorkspaces'] | undefined),
    },
    assistantWorkspace: {
      activeScope: normalizeAssistantScope(nextState.assistantWorkspace?.activeScope) ?? DEFAULT_APP_STATE.assistantWorkspace.activeScope,
      selectedSessionIdByScope: {
        ...DEFAULT_APP_STATE.assistantWorkspace.selectedSessionIdByScope,
        ...(nextState.assistantWorkspace?.selectedSessionIdByScope ?? {}),
      } as AppShellState['assistantWorkspace']['selectedSessionIdByScope'],
      manualSessions: Array.isArray(nextState.assistantWorkspace?.manualSessions)
        ? nextState.assistantWorkspace.manualSessions as AppShellState['assistantWorkspace']['manualSessions']
        : DEFAULT_APP_STATE.assistantWorkspace.manualSessions,
      drawer: {
        kind: nextState.assistantWorkspace?.drawer?.kind ?? DEFAULT_APP_STATE.assistantWorkspace.drawer.kind,
        modeFilter: normalizeAssistantScope(nextState.assistantWorkspace?.drawer?.modeFilter) ?? DEFAULT_APP_STATE.assistantWorkspace.drawer.modeFilter,
      },
    },
  };

  // Migrate pre-scope records on first read.
  if (nextState.assistantWorkspace?.selectedSessionIdByMode) {
    const legacySelected = nextState.assistantWorkspace.selectedSessionIdByMode;
    (['work', 'finance', 'social', 'health', 'chats', 'mail'] as AppMode[]).forEach((mode) => {
      const selected = legacySelected[mode];
      if (typeof selected === 'string' && selected.trim()) {
        merged.assistantWorkspace.selectedSessionIdByScope[mode] = selected;
      }
    });
  }

  merged.sidebarWidthPx = Number.isFinite(merged.sidebarWidthPx)
    ? Math.min(360, Math.max(200, Math.round(merged.sidebarWidthPx)))
    : DEFAULT_APP_STATE.sidebarWidthPx;

  for (const [projectPath, profile] of Object.entries(merged.projectProfiles)) {
    const technologiesCandidate = (profile as unknown as { technologies?: unknown }).technologies;
    const runsCandidate = (profile as unknown as { runs?: unknown }).runs;
    const normalizedRuns = Array.isArray(runsCandidate)
      ? runsCandidate.map((run, index) => {
          const candidate = run as {
            id?: unknown;
            projectId?: unknown;
          } & AppShellState['projectProfiles'][string]['runs'][number];
          const baseId =
            typeof candidate.id === 'string' && candidate.id.trim().length > 0
              ? candidate.id
              : `run-${projectPath}-${index + 1}`;
          return {
            ...candidate,
            id: baseId,
            projectId:
              typeof candidate.projectId === 'string' && candidate.projectId
                ? candidate.projectId
                : projectPath,
          };
        })
      : [];
    const uniqueRuns = normalizedRuns.map((run, index) => {
      let nextId = run.id;
      let suffix = 1;
      while (normalizedRuns.slice(0, index).some((entry) => entry.id === nextId)) {
        suffix += 1;
        nextId = `${run.id}-${suffix}`;
      }
      return nextId === run.id ? run : { ...run, id: nextId };
    });

    merged.projectProfiles[projectPath] = {
      ...profile,
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      agents: Array.isArray(profile.agents) ? profile.agents : [],
      technologies: Array.isArray(technologiesCandidate) ? technologiesCandidate : [],
      runs: uniqueRuns,
    };

    const selectedRunId = merged.selectedRunByProject[projectPath];
    if (selectedRunId && !uniqueRuns.some((run) => run.id === selectedRunId)) {
      merged.selectedRunByProject[projectPath] = uniqueRuns[0]?.id ?? '';
    }
  }

  const normalizedManualSessions = merged.assistantWorkspace.manualSessions.flatMap((session) => {
    if (!session || typeof session !== 'object') return [];
    const scope = normalizeAssistantScope(session.scope ?? (session as { mode?: string }).mode);
    if (!scope) return [];
    const id = typeof session.id === 'string' ? session.id.trim() : '';
    if (!id) return [];
    const title = typeof session.title === 'string' && session.title.trim()
      ? session.title.trim()
      : 'Untitled chat';
    const createdAtMs = Number.isFinite(session.createdAtMs) ? Number(session.createdAtMs) : Date.now();
    const updatedAtMs = Number.isFinite(session.updatedAtMs) ? Number(session.updatedAtMs) : createdAtMs;
    return [{ id, title, scope, createdAtMs, updatedAtMs }];
  });
  merged.assistantWorkspace.manualSessions = normalizedManualSessions;

  (['all', 'work', 'finance', 'social', 'health', 'chats', 'mail'] as AssistantScope[]).forEach((scope) => {
    const selected = merged.assistantWorkspace.selectedSessionIdByScope[scope];
    merged.assistantWorkspace.selectedSessionIdByScope[scope] =
      typeof selected === 'string' && selected.trim().length > 0
        ? selected
        : globalAssistantSessionId(scope);
  });

  if (!normalizeAssistantScope(merged.assistantWorkspace.activeScope)) {
    merged.assistantWorkspace.activeScope = 'all';
  }

  const bookmarkedProjectPaths = merged.projectPaths.filter((projectPath) => {
    const profile = merged.projectProfiles[projectPath];
    const bookmarkedOverride = merged.projectBookmarks[projectPath];
    const bookmarked = typeof bookmarkedOverride === 'boolean' ? bookmarkedOverride : Boolean(profile?.isBookmarked);
    return bookmarked;
  });

  merged.projectPaths = bookmarkedProjectPaths;
  merged.selectedProjectPath = bookmarkedProjectPaths.includes(merged.selectedProjectPath)
    ? merged.selectedProjectPath
    : bookmarkedProjectPaths[0] ?? '';
  merged.selectedRunByProject = Object.fromEntries(
    Object.entries(merged.selectedRunByProject).filter(([projectPath]) =>
      bookmarkedProjectPaths.includes(projectPath),
    ),
  );

  return merged;
}

export function usePersistedAppState() {
  const [appState, setAppState] = useAtom(appShellStateAtom);
  const [hydrated, setHydrated] = useAtom(appShellHydratedAtom);
  const hasLoadedRef = useRef(false);
  const serializedRef = useRef('');

  const loadStateQuery = useQuery({
    queryKey: ['one-shot', 'app-state'],
    queryFn: async () => {
      const rawState = await window.appShell.getAppState();
      return mergeState(rawState);
    },
  });

  const saveStateMutation = useMutation({
    mutationKey: ['one-shot', 'app-state-save'],
    mutationFn: async (nextState: AppShellState) => {
      await window.appShell.setAppState(nextState as unknown as Record<string, unknown>);
    },
  });

  useEffect(() => {
    if (!loadStateQuery.data || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    setAppState(loadStateQuery.data);
    setHydrated(true);
  }, [loadStateQuery.data, setAppState, setHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify(appState);
    if (serializedRef.current === serialized) return;
    serializedRef.current = serialized;

    const timer = window.setTimeout(() => {
      saveStateMutation.mutate(appState);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [appState, hydrated, saveStateMutation]);

  return useMemo(
    () => ({
      appState,
      setAppState,
      hydrated,
      loading: loadStateQuery.isLoading && !hydrated,
    }),
    [appState, setAppState, hydrated, loadStateQuery.isLoading],
  );
}
