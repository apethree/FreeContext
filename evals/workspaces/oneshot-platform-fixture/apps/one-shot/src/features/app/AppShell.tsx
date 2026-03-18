import { SignedIn, SignedOut, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import {
  createDefaultCreateProjectDraft,
  createRun,
  defaultProjectProfile,
  generateCreateLaunchId,
  safeProjectName,
} from '@/features/app/defaults';
import { createWorkspaceSnapshot, workspaceSnapshotKey } from '@/features/project-workspace/mockData';
import { usePersistedAppState } from '@/features/app/usePersistedAppState';
import type { AppMode, OpenTarget, SettingsSection } from '@/features/app/types';
import { DevLogViewer } from '@/features/dev/DevLogViewer';
import { logUiEvent } from '@/lib/observability';
import { AppSidebar } from '@/features/sidebar/AppSidebar';
import { useProjectTreeActions } from '@/features/sidebar/useProjectTreeActions';
import { useProjectTreeState } from '@/features/sidebar/useProjectTreeState';
import { AppTopBarRow } from '@/features/app/AppTopBarRow';
import { EmbeddedTerminal } from '@/features/terminal/EmbeddedTerminal';
import type { AppShellContextValue } from '@/features/app/AppShellContext';
import { resolveShellView } from '@/features/app/shellRoutes';
import { MODE_CONFIG } from '@/features/app/modeConfig';
import { getAppCapabilities } from '@/lib/appCapabilities';
import { useAssistantWorkspaceStore } from '@/features/assistant-chat/useAssistantWorkspaceStore';
import { SyncCollectionsProvider } from '@/shared/collections/SyncCollectionsProvider';
import { useChannels } from '@/shared/hooks/useChannels';

type SyncedChannel = {
  id: string;
  type: string;
  is_active?: boolean | null;
};

function ChannelSync({
  onChannels,
}: {
  onChannels: (channels: SyncedChannel[]) => void;
}) {
  const channels = useChannels() as SyncedChannel[];

  useEffect(() => {
    onChannels(channels);
  }, [channels, onChannels]);

  return null;
}

export function AppShell() {
  const { appState, setAppState, hydrated } = usePersistedAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { orgId, getToken } = useAuth();
  const activePipelineIdentityRef = useRef<string | null>(null);
  const shellView = useMemo(() => resolveShellView(location.pathname), [location.pathname]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncedChannels, setSyncedChannels] = useState<SyncedChannel[]>();
  const capabilities = useMemo(() => getAppCapabilities(), []);
  const isWebRuntime = capabilities.platform === 'web';
  const activeProjectPath = shellView.projectPath || appState.selectedProjectPath;
  const selectedProjectName =
    appState.projectProfiles[activeProjectPath]?.displayName ||
    safeProjectName(activeProjectPath || '');
  const assistantScope = appState.assistantWorkspace.activeScope;
  const assistantScopeTitle = assistantScope === 'all'
    ? 'One Shot Assistant'
    : `${MODE_CONFIG[assistantScope].label} Assistant`;
  const pageTitle = shellView.section === 'project'
    ? selectedProjectName || 'Project'
    : shellView.section === 'global-assistant'
      ? assistantScopeTitle
      : shellView.pageTitle;

  const onOpenHome = useCallback(() => {
    navigate('/home');
    setAppState((previous) => ({
      ...previous,
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onOpenSkills = useCallback(() => {
    navigate('/home/skills');
    setAppState((previous) => ({
      ...previous,
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onOpenTemplates = useCallback(() => {
    navigate('/home/templates');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenStyleLab = useCallback(() => {
    navigate('/home/style-lab');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenOneShot = useCallback(() => {
    navigate('/home/one-shot');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenOpenClawDemo = useCallback(() => {
    navigate('/home/openclaw-demo');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenOpenClawHostedPhase = useCallback(() => {
    navigate('/home/openclaw-hosted-phase');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenLive = useCallback(() => {
    navigate('/home/live');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenAssistantChat = useCallback(() => {
    navigate('/home/global-assistant');
    setAppState((previous) => ({
      ...previous,
      selectedProjectPath: '',
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        activeScope: 'all',
      },
    }));
  }, [navigate, setAppState]);

  const onOpenAssistantChatForMode = useCallback((mode: AppMode) => {
    navigate('/home/global-assistant');
    setAppState((previous) => ({
      ...previous,
      activeMode: mode,
      lastMode: mode,
      selectedProjectPath: '',
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        activeScope: mode,
      },
    }));
  }, [navigate, setAppState]);

  const onOpenWebTest = useCallback(() => {
    navigate('/home/web-test');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenGhostLayer = useCallback(() => {
    navigate('/home/ghost-layer');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onOpenCloudInspector = useCallback(() => {
    navigate('/home/cloud-inspector');
    setAppState((previous) => ({ ...previous, selectedProjectPath: '' }));
  }, [navigate, setAppState]);

  const onCreateProject = useCallback(() => {
    navigate('/home/create');
    setAppState((previous) => ({
      ...previous,
      createLaunchId: generateCreateLaunchId(),
      createProjectDraft: createDefaultCreateProjectDraft(),
    }));
  }, [navigate, setAppState]);

  const onOpenSettings = useCallback(
    (section?: string) => {
      const nextSection = (section as SettingsSection | undefined) || appState.settingsSection;
      navigate(`/home/settings/${encodeURIComponent(nextSection)}`);
      setAppState((previous) => ({
        ...previous,
        settingsSection: nextSection,
      }));
    },
    [appState.settingsSection, navigate, setAppState],
  );

  const onOpenProject = useCallback(
    (projectPath: string, runId?: string) => {
      const nextPath = `/home/project/${encodeURIComponent(projectPath)}${runId ? `/${runId}` : ''}`;
      navigate(nextPath);
      setAppState((previous) => {
        const profile =
          previous.projectProfiles[projectPath] ?? defaultProjectProfile(projectPath);
        const nextProfiles = {
          ...previous.projectProfiles,
          [projectPath]: profile,
        };
        const selectedRunId =
          runId || previous.selectedRunByProject[projectPath] || profile.runs[0]?.id || '';
        const key = selectedRunId ? workspaceSnapshotKey(projectPath, selectedRunId) : '';
        return {
          ...previous,
          selectedProjectPath: projectPath,
          projectPaths: previous.projectPaths.includes(projectPath)
            ? previous.projectPaths
            : [...previous.projectPaths, projectPath],
          projectProfiles: nextProfiles,
          selectedRunByProject: runId
            ? { ...previous.selectedRunByProject, [projectPath]: runId }
            : previous.selectedRunByProject,
          projectWorkspaces:
            selectedRunId && !previous.projectWorkspaces[key]
              ? {
                  ...previous.projectWorkspaces,
                  [key]: createWorkspaceSnapshot(projectPath, selectedRunId, profile.displayName),
                }
              : previous.projectWorkspaces,
        };
      });
    },
    [navigate, setAppState],
  );

  const getPreferredClerkToken = useCallback(async () => {
    let token: string | null = null;
    try {
      token = await getToken({ template: 'openclaw' });
    } catch {
      token = null;
    }
    if (token) return token;
    try {
      return await getToken();
    } catch {
      return null;
    }
  }, [getToken]);

  const onCreateProjectFromDraft = useCallback(
    (draft: AppShellContextValue['appState']['createProjectDraft']) => {
      const cleanedName = draft.projectName.trim();
      if (!cleanedName) return;
      const slug = cleanedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const projectPath = `~/Projects/${slug || 'one-shot-project'}`;
      const nextRun = createRun(projectPath, 'Initial run');
      const workspaceKey = workspaceSnapshotKey(projectPath, nextRun.id);

      navigate(`/home/project/${encodeURIComponent(projectPath)}/${nextRun.id}`);
      setAppState((previous) => {
        const previousProfile =
          previous.projectProfiles[projectPath] ?? defaultProjectProfile(projectPath);
        const nextProfile = {
          ...previousProfile,
          displayName: cleanedName,
          skills: Array.from(new Set(draft.selectedSkills)),
          agents: Array.from(new Set(draft.selectedAgents)),
          technologies: Array.from(new Set(draft.selectedTechnologies)),
          updatedAt: new Date().toISOString(),
          runs: [nextRun, ...previousProfile.runs.filter((run) => run.id !== nextRun.id)],
          isExpanded: true,
        };
        const workspace = createWorkspaceSnapshot(projectPath, nextRun.id, cleanedName);
        workspace.appSpec.summary =
          draft.projectDescription.trim() || workspace.appSpec.summary;

        return {
          ...previous,
          selectedProjectPath: projectPath,
          projectPaths: previous.projectPaths.includes(projectPath)
            ? previous.projectPaths
            : [projectPath, ...previous.projectPaths],
          projectProfiles: {
            ...previous.projectProfiles,
            [projectPath]: nextProfile,
          },
          selectedRunByProject: {
            ...previous.selectedRunByProject,
            [projectPath]: nextRun.id,
          },
          projectWorkspaces: {
            ...previous.projectWorkspaces,
            [workspaceKey]: workspace,
          },
          createProjectDraft: {
            ...createDefaultCreateProjectDraft(),
            progressMessage: `Created ${cleanedName}`,
          },
          createLaunchId: generateCreateLaunchId(),
        };
      });
    },
    [navigate, setAppState],
  );

  const onOpenExistingProject = useCallback(async () => {
    const selected = await window.appShell.openProjectDialog();
    if (!selected) return;

    setAppState((previous) => {
      const alreadyExists = previous.projectPaths.includes(selected);
      const profile = previous.projectProfiles[selected] ?? defaultProjectProfile(selected);
      const nextPaths = alreadyExists ? previous.projectPaths : [...previous.projectPaths, selected];
      const nextRunId = profile.runs[0]?.id ?? createRun(selected).id;
      const workspaceKey = workspaceSnapshotKey(selected, nextRunId);
      return {
        ...previous,
        selectedProjectPath: selected,
        projectPaths: nextPaths,
        projectProfiles: {
          ...previous.projectProfiles,
          [selected]: profile,
        },
        selectedRunByProject: {
          ...previous.selectedRunByProject,
          [selected]: previous.selectedRunByProject[selected] || nextRunId,
        },
        projectWorkspaces: previous.projectWorkspaces[workspaceKey]
          ? previous.projectWorkspaces
          : {
              ...previous.projectWorkspaces,
              [workspaceKey]: createWorkspaceSnapshot(selected, nextRunId, profile.displayName),
            },
      };
    });
    navigate(`/home/project/${encodeURIComponent(selected)}`);
  }, [navigate, setAppState]);

  // Ensure main-process pipeline identity is initialized for every signed-in
  // session (not only when Settings is opened), so cloud preflight can pass.
  useEffect(() => {
    const userId = user?.id ?? null;
    if (!userId) {
      activePipelineIdentityRef.current = null;
      return;
    }

    const tenantId = orgId ?? userId;
    const identityKey = `${userId}:${tenantId}`;
    if (activePipelineIdentityRef.current === identityKey) return;
    activePipelineIdentityRef.current = identityKey;

    let cancelled = false;
    void (async () => {
      try {
        const clerkToken = await getPreferredClerkToken();
        if (cancelled) return;
        await window.appShell.pipelineSetActiveUser({
          userId,
          tenantId,
          ...(clerkToken ? { clerkToken } : {}),
        });
      } catch {
        // Best-effort initialization; preflight status will surface failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getPreferredClerkToken, orgId, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const push = async () => {
      try {
        const token = await getPreferredClerkToken();
        if (token) await window.appShell.pipelinePushClerkToken({ token });
      } catch { /* best-effort */ }
    };
    const id = setInterval(() => void push(), 50_000);
    return () => clearInterval(id);
  }, [getPreferredClerkToken, user?.id]);

  const onSelectOpenTarget = useCallback(
    async (target: OpenTarget) => {
      const projectPath = appState.selectedProjectPath || appState.projectPaths[0];
      await window.appShell.openProjectTarget({
        target,
        ...(projectPath ? { projectPath } : {}),
      });
    },
    [appState.projectPaths, appState.selectedProjectPath],
  );

  const onOpenTerminal = useCallback(() => {
    setAppState((previous) => ({
      ...previous,
      terminalOpen: !previous.terminalOpen,
    }));
  }, [setAppState]);

  const onOpenModeHome = useCallback(() => {
    navigate(`/home/mode/${appState.activeMode}`);
    setAppState((previous) => ({
      ...previous,
      selectedProjectPath: '',
    }));
  }, [appState.activeMode, navigate, setAppState]);

  const onOpenChatsInbox = useCallback(() => {
    navigate('/home/mode/chats/inbox');
    setAppState((previous) => ({
      ...previous,
      activeMode: 'chats',
      lastMode: 'chats',
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onOpenChatsManageChannels = useCallback(() => {
    navigate(`/home/settings/${encodeURIComponent('Manage Channels')}`);
    setAppState((previous) => ({
      ...previous,
      settingsSection: 'Manage Channels',
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onOpenMailInbox = useCallback(() => {
    navigate('/home/mode/mail/inbox');
    setAppState((previous) => ({
      ...previous,
      activeMode: 'mail',
      lastMode: 'mail',
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onOpenMailConnect = useCallback(() => {
    navigate('/home/mode/mail/connect-mail');
    setAppState((previous) => ({
      ...previous,
      activeMode: 'mail',
      lastMode: 'mail',
      selectedProjectPath: '',
    }));
  }, [navigate, setAppState]);

  const onSwitchMode = useCallback((mode: AppMode) => {
    setAppState((previous) => ({
      ...previous,
      activeMode: mode,
      lastMode: mode,
      selectedProjectPath: '',
      assistantWorkspace: {
        ...previous.assistantWorkspace,
        activeScope: mode,
      },
    }));
    navigate(`/home/mode/${mode}`);
  }, [navigate, setAppState]);

  const onSetActiveMode = useCallback((mode: AppMode) => {
    setAppState((previous) => ({
      ...previous,
      activeMode: mode,
      lastMode: mode,
    }));
  }, [setAppState]);

  const onSignOut = useCallback(async () => {
    await signOut({ redirectUrl: '/#/auth' });
  }, [signOut]);
  const projectTree = useProjectTreeState({ appState, shellView });
  const projectTreeActions = useProjectTreeActions({ setAppState });
  const assistantWorkspace = useAssistantWorkspaceStore({
    appState,
    activeMode: appState.activeMode,
    setAppState,
    channels: syncedChannels,
  });
  const syncUserId = user?.id ?? '';
  const syncTenantId = orgId ?? syncUserId;

  useEffect(() => {
    if (syncUserId && syncTenantId) return;
    setSyncedChannels(undefined);
  }, [syncTenantId, syncUserId]);

  const contextValue = useMemo<AppShellContextValue>(
    () => ({
      appState,
      pageTitle,
      selectedProjectName,
      setAppState,
      assistantWorkspace,
      onOpenHome,
      onOpenSkills,
      onOpenTemplates,
      onOpenStyleLab,
      onOpenOneShot,
      onOpenOpenClawDemo,
      onOpenOpenClawHostedPhase,
      onOpenLive,
      onOpenAssistantChat,
      onCreateProject,
      onOpenSettings,
      onOpenProject,
      onCreateProjectFromDraft,
      onOpenExistingProject,
      onSelectOpenTarget,
      onOpenTerminal,
      onOpenModeHome,
      onSetActiveMode,
      onSwitchMode,
      onSignOut,
    }),
    [
      appState,
      pageTitle,
      selectedProjectName,
      setAppState,
      assistantWorkspace,
      onOpenHome,
      onOpenSkills,
      onOpenTemplates,
      onOpenStyleLab,
      onOpenOneShot,
      onOpenOpenClawDemo,
      onOpenOpenClawHostedPhase,
      onOpenLive,
      onOpenAssistantChat,
      onCreateProject,
      onOpenSettings,
      onOpenProject,
      onCreateProjectFromDraft,
      onOpenExistingProject,
      onSelectOpenTarget,
      onOpenTerminal,
      onOpenModeHome,
      onSetActiveMode,
      onSwitchMode,
      onSignOut,
    ],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!shellView.mode) return;
    if (shellView.mode === appState.activeMode) return;
    setAppState((previous) => ({
      ...previous,
      activeMode: shellView.mode as AppMode,
      lastMode: shellView.mode as AppMode,
    }));
  }, [appState.activeMode, hydrated, setAppState, shellView.mode]);

  useEffect(() => {
    if (!hydrated) return;
    if (shellView.section !== 'project' || !shellView.projectPath) return;

    const projectPath = shellView.projectPath;
    const runIdFromRoute = shellView.runId;
    setAppState((previous) => {
      const existingProfile = previous.projectProfiles[projectPath];
      const profile = existingProfile ?? defaultProjectProfile(projectPath);
      const selectedRunId = runIdFromRoute || previous.selectedRunByProject[projectPath] || profile.runs[0]?.id || '';
      const nextProjectPaths = previous.projectPaths.includes(projectPath)
        ? previous.projectPaths
        : [...previous.projectPaths, projectPath];
      const nextSelectedRuns =
        selectedRunId && previous.selectedRunByProject[projectPath] !== selectedRunId
          ? { ...previous.selectedRunByProject, [projectPath]: selectedRunId }
          : previous.selectedRunByProject;
      const nextProfiles = existingProfile
        ? previous.projectProfiles
        : { ...previous.projectProfiles, [projectPath]: profile };

      if (
        previous.selectedProjectPath === projectPath &&
        nextProjectPaths === previous.projectPaths &&
        nextSelectedRuns === previous.selectedRunByProject &&
        nextProfiles === previous.projectProfiles
      ) {
        return previous;
      }

      return {
        ...previous,
        selectedProjectPath: projectPath,
        projectPaths: nextProjectPaths,
        selectedRunByProject: nextSelectedRuns,
        projectProfiles: nextProfiles,
      };
    });
  }, [hydrated, setAppState, shellView.projectPath, shellView.runId, shellView.section]);

  const terminalCwd = activeProjectPath || appState.projectPaths[0] || '';

  useEffect(() => {
    logUiEvent({
      domain: 'ui.navigation',
      action: 'route_change',
      status: 'success',
      data: { pathname: location.pathname },
    });
  }, [location.pathname]);

  useEffect(() => {
    const unsubscribe = window.appShell.onMenuCommand?.((command) => {
      logUiEvent({
        domain: 'ui.menu',
        action: command.type,
        status: 'success',
        data: command.type === 'navigate' ? { path: command.path } : { projectPath: command.projectPath },
      });
      if (command.type === 'navigate') {
        navigate(command.path);
        return;
      }
      if (command.type === 'open-project') {
        onOpenProject(command.projectPath);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, onOpenProject]);

  useEffect(() => {
    let mounted = true;
    void window.appShell.getSetting('oneshot.settings.machine').then((raw) => {
      if (!mounted || !raw || typeof raw !== 'object') {
        return;
      }
      const candidate = (raw as { fontSize?: unknown }).fontSize;
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return;
      }
      const fontSize = Math.min(16, Math.max(12, Math.round(candidate)));
      document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
    }).catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <SignedOut>
        <Navigate to="/auth" replace />
      </SignedOut>
      <SignedIn>
        {syncUserId && syncTenantId ? (
          <SyncCollectionsProvider
            userId={syncUserId}
            tenantId={syncTenantId}
            getAuthToken={getPreferredClerkToken}
          >
            <ChannelSync onChannels={setSyncedChannels} />
            <SidebarProvider
              open={!appState.sidebarCollapsed}
              onOpenChange={(open) =>
                setAppState((previous) => ({
                  ...previous,
                  sidebarCollapsed: !open,
                }))
              }
            >
              <div className="relative flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
                <AppTopBarRow
                  pageTitle={pageTitle}
                  activeMode={appState.activeMode}
                  section={shellView.section}
                  collapsed={appState.sidebarCollapsed}
                  isWebRuntime={isWebRuntime}
                  selectedEditor={appState.selectedEditor}
                  onSelectEditor={(target) =>
                    setAppState((previous) => ({
                      ...previous,
                      selectedEditor: target,
                    }))
                  }
                  onToggleSidebar={() =>
                    setAppState((previous) => ({ ...previous, sidebarCollapsed: !previous.sidebarCollapsed }))
                  }
                  onOpenTarget={onSelectOpenTarget}
                  onOpenTerminal={onOpenTerminal}
                  onOpenSearch={() => setSearchOpen(true)}
                />

                <AppSidebar
                  section={shellView.section}
                  isPaid={false}
                  activeMode={appState.activeMode}
                  settingsSection={shellView.settingsSection || appState.settingsSection}
                  projectTree={projectTree}
                  sidebarWidthPx={appState.sidebarWidthPx}
                  onSidebarWidthChange={(nextWidthPx) =>
                    setAppState((previous) => ({ ...previous, sidebarWidthPx: nextWidthPx }))
                  }
                  onProjectTreeAction={projectTreeActions.dispatch}
                  onCreateProject={onCreateProject}
                  onOpenExistingProject={onOpenExistingProject}
                  onConnectGithubProject={() => onOpenSettings('Connect Accounts')}
                  onSelectProjectPath={onOpenProject}
                  onSwitchMode={onSwitchMode}
                  onOpenHome={onOpenHome}
                  onOpenSkills={onOpenSkills}
                  onOpenTemplates={onOpenTemplates}
                  onOpenStyleLab={onOpenStyleLab}
                  onOpenOneShot={onOpenOneShot}
                  onOpenOpenClawDemo={onOpenOpenClawDemo}
                  onOpenOpenClawHostedPhase={onOpenOpenClawHostedPhase}
                  onOpenLive={onOpenLive}
                  onOpenAssistantChat={onOpenAssistantChat}
                  onOpenAssistantChatForMode={onOpenAssistantChatForMode}
                  onOpenWebTest={onOpenWebTest}
                  onOpenGhostLayer={onOpenGhostLayer}
                  onOpenCloudInspector={onOpenCloudInspector}
                  onOpenModeHome={onOpenModeHome}
                  onOpenChatsInbox={onOpenChatsInbox}
                  onOpenChatsManageChannels={onOpenChatsManageChannels}
                  onOpenMailInbox={onOpenMailInbox}
                  onOpenMailConnect={onOpenMailConnect}
                  assistantGlobalSessionId={assistantWorkspace.globalSessionId}
                  assistantActiveScope={assistantWorkspace.activeScope}
                  assistantSelectedSessionId={assistantWorkspace.selectedSessionId}
                  assistantManualSessions={assistantWorkspace.manualSessions}
                  assistantChannelSessions={assistantWorkspace.channelSessions}
                  onAssistantSelectSession={assistantWorkspace.selectSession}
                  onAssistantCreateSession={assistantWorkspace.createManualSession}
                  onAssistantRenameSession={assistantWorkspace.renameManualSession}
                  onAssistantDeleteSession={assistantWorkspace.deleteManualSession}
                  onOpenSettings={onOpenSettings}
                  onSignOut={onSignOut}
                  isWebRuntime={isWebRuntime}
                  searchOpen={searchOpen}
                  onSearchOpenChange={setSearchOpen}
                />

                <SidebarInset>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="h-16 shrink-0" aria-hidden="true" />

                    <div className="min-h-0 flex flex-1 flex-col gap-3 px-4 pb-4 pt-0">
                      {appState.terminalOpen ? (
                        <div className="grid min-h-0 h-full flex-1 grid-rows-[minmax(0,1fr)_220px] gap-3">
                          <div className="app-scroll-host min-h-0">
                            <Outlet context={contextValue} />
                          </div>
                          <div className="min-h-0">
                            <EmbeddedTerminal cwd={terminalCwd} visible={appState.terminalOpen} />
                          </div>
                        </div>
                      ) : (
                        <div className="app-scroll-host min-h-0 flex-1">
                          <Outlet context={contextValue} />
                        </div>
                      )}
                    </div>
                  </div>
                </SidebarInset>
              </div>
            </SidebarProvider>
          </SyncCollectionsProvider>
        ) : null}
      </SignedIn>
      <DevLogViewer />
    </>
  );
}
