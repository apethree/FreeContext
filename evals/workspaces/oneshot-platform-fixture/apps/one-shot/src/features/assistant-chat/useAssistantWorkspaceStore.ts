import { useCallback, useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { globalAssistantSessionId } from '@/features/app/defaults';
import type {
  AppMode,
  AppShellState,
  AssistantManualSession,
  AssistantScope,
} from '@/features/app/types';
import { CHANNEL_CATALOG } from '@/features/chats/channelCatalog';

export type AssistantChannelSession = {
  id: string;
  channelId: string;
  type: string;
  label: string;
};

type SyncedChannel = {
  id: string;
  type: string;
  is_active?: boolean | null;
};

type UseAssistantWorkspaceStoreOptions = {
  appState: AppShellState;
  activeMode: AppMode;
  setAppState: Dispatch<SetStateAction<AppShellState>>;
  channels?: SyncedChannel[];
};

type UseAssistantWorkspaceStoreResult = {
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

function nextManualSessionTitle(
  sessions: AssistantManualSession[],
  scope: AssistantScope,
): string {
  const base = 'Chat';
  const count = sessions.filter((session) => session.scope === scope).length;
  return `${base} ${count + 1}`;
}

function resolveChannelLabel(type: string, channelId: string): string {
  const match = CHANNEL_CATALOG.find((entry) => entry.id === type);
  if (match) return match.label;
  return type || channelId;
}

export function useAssistantWorkspaceStore({
  appState,
  activeMode,
  setAppState,
  channels,
}: UseAssistantWorkspaceStoreOptions): UseAssistantWorkspaceStoreResult {
  const activeScope = appState.assistantWorkspace.activeScope;
  const globalSessionId = useMemo(() => globalAssistantSessionId(activeScope), [activeScope]);
  const channelsLoaded = channels !== undefined;
  const channelSessions = useMemo(
    () => (channels ?? [])
      .filter((channel) => channel.is_active !== false)
      .map((channel) => ({
        id: `channel:${channel.id}`,
        channelId: channel.id,
        type: channel.type,
        label: resolveChannelLabel(channel.type, channel.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [channels],
  );

  const manualSessions = useMemo(
    () => {
      const sessions = appState.assistantWorkspace.manualSessions;
      if (activeScope === 'all') {
        return sessions.slice().sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      }
      return sessions
        .filter((session) => session.scope === activeScope)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    },
    [activeScope, appState.assistantWorkspace.manualSessions],
  );

  const selectedSessionId = useMemo(() => {
    const selected = appState.assistantWorkspace.selectedSessionIdByScope[activeScope];
    if (typeof selected !== 'string' || !selected.trim()) {
      return globalSessionId;
    }
    if (selected === globalSessionId) return selected;
    if (selected.startsWith('assistant:manual:')) {
      return manualSessions.some((session) => session.id === selected)
        ? selected
        : globalSessionId;
    }
    if (selected.startsWith('channel:')) {
      if (!channelsLoaded) return selected;
      return channelSessions.some((session) => session.id === selected)
        ? selected
        : globalSessionId;
    }
    return globalSessionId;
  }, [
    activeScope,
    appState.assistantWorkspace.selectedSessionIdByScope,
    channelsLoaded,
    channelSessions,
    globalSessionId,
    manualSessions,
  ]);

  useEffect(() => {
    const selected = appState.assistantWorkspace.selectedSessionIdByScope[activeScope];
    if (selected === selectedSessionId) return;
    setAppState((previous) => ({
      ...previous,
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        selectedSessionIdByScope: {
          ...previous.assistantWorkspace.selectedSessionIdByScope,
          [activeScope]: selectedSessionId,
        },
      },
    }));
  }, [
    activeScope,
    appState.assistantWorkspace.selectedSessionIdByScope,
    selectedSessionId,
    setAppState,
  ]);

  useEffect(() => {
    if (activeScope !== 'all') return;
    if (activeMode === appState.activeMode) return;
    // Keep scope and app mode aligned when scoped mode pages are active.
    setAppState((previous) => ({
      ...previous,
      activeMode,
    }));
  }, [activeMode, activeScope, appState.activeMode, setAppState]);

  const setActiveScope = useCallback((scope: AssistantScope) => {
    setAppState((previous) => ({
      ...previous,
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        activeScope: scope,
      },
    }));
  }, [setAppState]);

  const setDrawer = useCallback((
    kind: AppShellState['assistantWorkspace']['drawer']['kind'],
    modeFilter?: AssistantScope,
  ) => {
    setAppState((previous) => ({
      ...previous,
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        drawer: {
          kind,
          modeFilter: modeFilter ?? previous.assistantWorkspace.drawer.modeFilter,
        },
      },
    }));
  }, [setAppState]);

  const closeDrawer = useCallback(() => {
    setDrawer('none');
  }, [setDrawer]);

  const selectSession = useCallback(
    (sessionId: string) => {
      setAppState((previous) => ({
        ...previous,
        assistantWorkspace: {
          ...previous.assistantWorkspace,
          selectedSessionIdByScope: {
            ...previous.assistantWorkspace.selectedSessionIdByScope,
            [previous.assistantWorkspace.activeScope]: sessionId,
          },
        },
      }));
    },
    [setAppState],
  );

  const createManualSession = useCallback(() => {
    const scope = activeScope;
    const sessionId = `assistant:manual:${scope}:${crypto.randomUUID()}`;
    const timestamp = Date.now();
    setAppState((previous) => {
      const nextSession: AssistantManualSession = {
        id: sessionId,
        title: nextManualSessionTitle(previous.assistantWorkspace.manualSessions, scope),
        scope,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
      };
      return {
        ...previous,
        assistantWorkspace: {
          ...previous.assistantWorkspace,
          manualSessions: [nextSession, ...previous.assistantWorkspace.manualSessions],
          selectedSessionIdByScope: {
            ...previous.assistantWorkspace.selectedSessionIdByScope,
            [scope]: sessionId,
          },
        },
      };
    });
    return sessionId;
  }, [activeScope, setAppState]);

  const renameManualSession = useCallback(
    (sessionId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      setAppState((previous) => {
        let didChange = false;
        const nextSessions = previous.assistantWorkspace.manualSessions.map((session) => {
          if (session.id !== sessionId) return session;
          didChange = true;
          if (session.title === nextTitle) return session;
          return {
            ...session,
            title: nextTitle,
            updatedAtMs: Date.now(),
          };
        });
        if (!didChange) return previous;
        return {
          ...previous,
          assistantWorkspace: {
            ...previous.assistantWorkspace,
            manualSessions: nextSessions,
          },
        };
      });
    },
    [setAppState],
  );

  const deleteManualSession = useCallback(
    (sessionId: string) => {
      setAppState((previous) => {
        const exists = previous.assistantWorkspace.manualSessions.some((session) => session.id === sessionId);
        if (!exists) return previous;

        const nextSelectedByScope = { ...previous.assistantWorkspace.selectedSessionIdByScope };
        (['all', 'work', 'finance', 'social', 'health', 'chats', 'mail'] as AssistantScope[]).forEach((scope) => {
          if (nextSelectedByScope[scope] === sessionId) {
            nextSelectedByScope[scope] = globalAssistantSessionId(scope);
          }
        });

        return {
          ...previous,
          assistantWorkspace: {
            ...previous.assistantWorkspace,
            manualSessions: previous.assistantWorkspace.manualSessions.filter(
              (session) => session.id !== sessionId,
            ),
            selectedSessionIdByScope: nextSelectedByScope,
          },
        };
      });
    },
    [setAppState],
  );

  return {
    activeScope,
    globalSessionId,
    selectedSessionId,
    manualSessions,
    channelSessions,
    drawerKind: appState.assistantWorkspace.drawer.kind,
    drawerModeFilter: appState.assistantWorkspace.drawer.modeFilter,
    setActiveScope,
    setDrawer,
    closeDrawer,
    selectSession,
    createManualSession,
    renameManualSession,
    deleteManualSession,
  };
}
