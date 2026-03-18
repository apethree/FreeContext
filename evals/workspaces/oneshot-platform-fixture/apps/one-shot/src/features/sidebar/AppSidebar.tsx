import { GlobeBox } from "@/vendor/geist-icons";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Sortable } from "@/components/ui/sortable";
import { SETTINGS_SECTIONS } from "@/features/app/constants";
import { defaultProjectProfile } from "@/features/app/defaults";
import { MODE_CONFIG, type ModeNavItem } from "@/features/app/modeConfig";
import type {
  AppMode,
  AssistantManualSession,
  AssistantScope,
  SettingsSection,
  SidebarModeSelection,
} from "@/features/app/types";
import type { ShellSection } from "@/features/app/shellRoutes";
import type { ProjectTreeAction } from "@/features/sidebar/useProjectTreeActions";
import type { ProjectTreeState } from "@/features/sidebar/useProjectTreeState";
import type { AssistantChannelSession } from "@/features/assistant-chat/useAssistantWorkspaceStore";
import { OneShotLogo } from "@/features/app/OneShotLogo";
import { ModeSwitcher } from "@/features/sidebar/ModeSwitcher";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import {
  Activity01Icon,
  Add01Icon,
  AiBookIcon,
  AiSearch02Icon,
  Archive,
  ArrowLeft,
  BellRing,
  BotMessageSquare,
  CircleUserRound,
  CreditCard,
  Delete02Icon,
  Edit01Icon,
  FolderOpen,
  GitFork,
  Github,
  Home01Icon,
  InboxIcon,
  ListFilter,
  LogOut,
  MailAdd01Icon,
  Message01Icon,
  MonitorCog,
  ServerStackIcon,
  Settings,
  SquarePen,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { ProjectItem } from "@/features/sidebar/ProjectItem";
import { sortProjectPaths } from "@/features/sidebar/sidebarHelpers";

type AppSidebarProps = {
  section: ShellSection;
  isPaid: boolean;
  activeMode: AppMode;
  settingsSection: SettingsSection;
  projectTree: ProjectTreeState;
  sidebarWidthPx: number;
  onSidebarWidthChange: (nextWidthPx: number) => void;
  onProjectTreeAction: (action: ProjectTreeAction) => void;
  onCreateProject: () => void;
  onOpenExistingProject: () => Promise<void>;
  onConnectGithubProject: () => void;
  onSelectProjectPath: (projectPath: string, runId?: string) => void;
  onSwitchMode: (mode: AppMode) => void;
  onOpenSkills: () => void;
  onOpenTemplates: () => void;
  onOpenStyleLab: () => void;
  onOpenOneShot: () => void;
  onOpenOpenClawDemo: () => void;
  onOpenOpenClawHostedPhase: () => void;
  onOpenLive: () => void;
  onOpenAssistantChat: () => void;
  onOpenAssistantChatForMode: (mode: AppMode) => void;
  onOpenWebTest: () => void;
  onOpenGhostLayer: () => void;
  onOpenCloudInspector: () => void;
  onOpenModeHome: () => void;
  onOpenChatsInbox: () => void;
  onOpenChatsManageChannels: () => void;
  onOpenMailInbox: () => void;
  onOpenMailConnect: () => void;
  assistantGlobalSessionId: string;
  assistantActiveScope: AssistantScope;
  assistantSelectedSessionId: string;
  assistantManualSessions: AssistantManualSession[];
  assistantChannelSessions: AssistantChannelSession[];
  onAssistantSelectSession: (sessionId: string) => void;
  onAssistantCreateSession: () => string;
  onAssistantRenameSession: (sessionId: string, title: string) => void;
  onAssistantDeleteSession: (sessionId: string) => void;
  onOpenHome: () => void;
  onOpenSettings: (section?: string) => void;
  onSignOut: () => Promise<void>;
  isWebRuntime: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (nextOpen: boolean) => void;
};

function navItemIcon(item: ModeNavItem) {
  const cls = "h-[var(--app-icon-size)] w-[var(--app-icon-size)]";
  switch (item.iconKey) {
    case "skills":
      return <GlobeBox className={cls} />;
    case "templates":
      return <HugeiconsIcon icon={AiBookIcon} className={cls} />;
    case "style-lab":
      return <HugeiconsIcon icon={AiSearch02Icon} className={cls} />;
    case "oneshot":
      return <OneShotLogo className={cls} />;
    case "openclaw-demo":
      return <HugeiconsIcon icon={ServerStackIcon} className={cls} />;
    case "openclaw-hosted-phase":
      return <HugeiconsIcon icon={ListFilter} className={cls} />;
    case "assistant-chat":
      return <HugeiconsIcon icon={Message01Icon} className={cls} />;
    case "web-test":
      return <GlobeBox className={cls} />;
    case "ghost-layer":
      return <GlobeBox className={cls} />;
    case "cloud-inspector":
      return <HugeiconsIcon icon={MonitorCog} className={cls} />;
    case "chats-inbox":
      return <HugeiconsIcon icon={Message01Icon} className={cls} />;
    case "chats-manage-channels":
      return <HugeiconsIcon icon={WebhookIcon} className={cls} />;
    case "mail-inbox":
      return <HugeiconsIcon icon={InboxIcon} className={cls} />;
    case "mail-connect":
      return <HugeiconsIcon icon={MailAdd01Icon} className={cls} />;
    default:
      return <HugeiconsIcon icon={Settings} className={cls} />;
  }
}

function sectionIcon(section: SettingsSection) {
  switch (section) {
    case "General":
      return (
        <HugeiconsIcon
          icon={Settings}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Billing":
      return (
        <HugeiconsIcon
          icon={CreditCard}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Connect Accounts":
      return (
        <HugeiconsIcon
          icon={CircleUserRound}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Manage Channels":
      return (
        <HugeiconsIcon
          icon={WebhookIcon}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Archived projects":
      return (
        <HugeiconsIcon
          icon={Archive}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "MCP servers":
      return (
        <HugeiconsIcon
          icon={ServerStackIcon}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Git":
      return (
        <HugeiconsIcon
          icon={GitFork}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Environments":
      return (
        <HugeiconsIcon
          icon={MonitorCog}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Worktrees":
      return (
        <HugeiconsIcon
          icon={FolderOpen}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    case "Archived threads":
      return (
        <HugeiconsIcon
          icon={BellRing}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
    default:
      return (
        <HugeiconsIcon
          icon={Settings}
          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
        />
      );
  }
}

export function AppSidebar({
  section,
  isPaid,
  activeMode,
  settingsSection,
  projectTree,
  sidebarWidthPx,
  onSidebarWidthChange,
  onProjectTreeAction,
  onCreateProject,
  onOpenExistingProject,
  onConnectGithubProject,
  onSelectProjectPath,
  onSwitchMode,
  onOpenSkills,
  onOpenTemplates,
  onOpenStyleLab,
  onOpenOneShot,
  onOpenOpenClawDemo,
  onOpenOpenClawHostedPhase,
  onOpenLive,
  onOpenAssistantChat,
  onOpenAssistantChatForMode,
  onOpenWebTest,
  onOpenGhostLayer,
  onOpenCloudInspector,
  onOpenModeHome,
  onOpenChatsInbox,
  onOpenChatsManageChannels,
  onOpenMailInbox,
  onOpenMailConnect,
  assistantGlobalSessionId,
  assistantActiveScope,
  assistantSelectedSessionId,
  assistantManualSessions,
  assistantChannelSessions,
  onAssistantSelectSession,
  onAssistantCreateSession,
  onAssistantRenameSession,
  onAssistantDeleteSession,
  onOpenHome,
  onOpenSettings,
  onSignOut,
  isWebRuntime,
  searchOpen,
  onSearchOpenChange,
}: AppSidebarProps) {
  const actionIconClass =
    "h-[calc(var(--app-icon-size)*1.2)] w-[calc(var(--app-icon-size)*1.2)]";
  const folderToggleIconClass =
    "h-[calc(var(--app-icon-size)*1.25)] w-[calc(var(--app-icon-size)*1.25)]";
  const isSettings = section === "settings";
  const isGlobalAssistant = section === "global-assistant";
  const isLogsSection = section === "live";
  const activeModeConfig = MODE_CONFIG[activeMode];
  const modeSelection: SidebarModeSelection = isGlobalAssistant
    ? (assistantActiveScope === "all" ? "oneshot" : assistantActiveScope)
    : activeMode;

  const getModeNavAction = (itemId: string) => {
    if (itemId === "skills") return onOpenSkills;
    if (itemId === "templates") return onOpenTemplates;
    if (itemId === "style-lab") return onOpenStyleLab;
    if (itemId === "oneshot") return onOpenOneShot;
    if (itemId === "openclaw-demo") return onOpenOpenClawDemo;
    if (itemId === "openclaw-hosted-phase") return onOpenOpenClawHostedPhase;
    if (itemId === "assistant-chat") return onOpenAssistantChat;
    if (itemId === "web-test") return onOpenWebTest;
    if (itemId === "ghost-layer") return onOpenGhostLayer;
    if (itemId === "cloud-inspector") return onOpenCloudInspector;
    if (itemId === "chats-inbox") return onOpenChatsInbox;
    if (itemId === "chats-manage-channels") return onOpenChatsManageChannels;
    if (itemId === "mail-inbox") return onOpenMailInbox;
    if (itemId === "mail-connect") return onOpenMailConnect;
    return onOpenModeHome;
  };

  const handleModeSelection = (selection: SidebarModeSelection) => {
    if (selection === "oneshot") {
      onOpenAssistantChat();
      return;
    }
    onSwitchMode(selection);
  };

  const handleOpenModeChat = (selection: SidebarModeSelection) => {
    if (selection === "oneshot") {
      onOpenAssistantChat();
      return;
    }
    onOpenAssistantChatForMode(selection);
  };

  const sortedProjectPaths = sortProjectPaths(
    projectTree.projectPaths,
    projectTree.sortMode,
    projectTree.projectProfiles,
  ).filter((projectPath) => {
    const profile = projectTree.projectProfiles[projectPath];
    return !profile?.isArchived;
  });

  const renameManualSession = (session: AssistantManualSession) => {
    const nextTitle = window.prompt("Rename chat session", session.title)?.trim();
    if (!nextTitle) return;
    onAssistantRenameSession(session.id, nextTitle);
  };

  const deleteManualSession = (session: AssistantManualSession) => {
    const shouldDelete = window.confirm(`Delete "${session.title}"?`);
    if (!shouldDelete) return;
    onAssistantDeleteSession(session.id);
  };

  return (
    <Sidebar
      widthPx={sidebarWidthPx}
      minWidthPx={300}
      maxWidthPx={360}
      onResizeWidthPx={onSidebarWidthChange}
    >
      <SidebarContent className="pt-0">
        <div className="h-14 shrink-0" aria-hidden="true" />

        {isSettings ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => onOpenHome()}>
                    <HugeiconsIcon
                      icon={ArrowLeft}
                      className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                    />
                    <span>Back to app</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {SETTINGS_SECTIONS.map((section) => (
                  <SidebarMenuItem key={section}>
                    <SidebarMenuButton
                      isActive={settingsSection === section}
                      onClick={() => onOpenSettings(section)}
                    >
                      {sectionIcon(section)}
                      <span>{section}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : isGlobalAssistant ? (
          <SidebarGroup className="flex min-h-0 flex-1 flex-col">
            <SidebarGroupContent className="space-y-3">
              <SidebarMenu>
                <SidebarMenuItem>
                  <ModeSwitcher
                    selection={modeSelection}
                    onSelect={handleModeSelection}
                    onOpenModeChat={handleOpenModeChat}
                  />
                </SidebarMenuItem>
              </SidebarMenu>
              <div className="sidebar-glass-group mt-3 flex min-h-0 flex-1 flex-col">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isGlobalAssistant}
                      onClick={onOpenAssistantChat}
                    >
                      <HugeiconsIcon icon={BotMessageSquare} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                      <span className="flex w-full items-center justify-between gap-2">
                        <span>Global Assistant</span>
                        <span className="workspace-tag px-1.5 py-0 text-[10px]">Primary</span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>

                <div className="sidebar-glass-divider" />

                <div className="mt-2 flex min-h-0 flex-1 flex-col">
                  <SidebarGroupLabel className="group/dobby flex items-center gap-2 whitespace-nowrap px-1">
                    <span>Sessions</span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title="Start new chat"
                      className="ml-auto h-6 w-6 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      onClick={() => {
                        onAssistantCreateSession();
                      }}
                    >
                      <HugeiconsIcon icon={Add01Icon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                    </Button>
                  </SidebarGroupLabel>

                  <SidebarGroupContent className="min-h-0 flex-1">
                    <SidebarMenu className="h-full space-y-1 overflow-auto pr-1">
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={assistantSelectedSessionId === assistantGlobalSessionId}
                          onClick={() => onAssistantSelectSession(assistantGlobalSessionId)}
                        >
                          <HugeiconsIcon icon={BotMessageSquare} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                          <span className="truncate">Global ({assistantActiveScope === 'all' ? 'One Shot' : MODE_CONFIG[assistantActiveScope].label})</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      {assistantManualSessions.map((session) => (
                        <SidebarMenuItem key={session.id}>
                          <SidebarMenuButton
                            isActive={assistantSelectedSessionId === session.id}
                            onClick={() => onAssistantSelectSession(session.id)}
                          >
                            <HugeiconsIcon icon={Message01Icon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                            <span className="flex w-full items-center justify-between gap-1">
                              <span className="truncate">{session.title}</span>
                              <span className="inline-flex items-center gap-0.5">
                                <button
                                  type="button"
                                  className="workspace-mini-icon-btn"
                                  aria-label={`Rename ${session.title}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    renameManualSession(session);
                                  }}
                                >
                                  <HugeiconsIcon icon={Edit01Icon} className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  className="workspace-mini-icon-btn workspace-mini-icon-btn-danger"
                                  aria-label={`Delete ${session.title}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteManualSession(session);
                                  }}
                                >
                                  <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3" />
                                </button>
                              </span>
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}

                      {assistantChannelSessions.length > 0 ? (
                        <SidebarMenuItem>
                          <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                            Channel Sessions
                          </div>
                        </SidebarMenuItem>
                      ) : null}

                      {assistantChannelSessions.map((session) => (
                        <SidebarMenuItem key={session.id}>
                          <SidebarMenuButton
                            isActive={assistantSelectedSessionId === session.id}
                            onClick={() => onAssistantSelectSession(session.id)}
                          >
                            <HugeiconsIcon icon={WebhookIcon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="truncate">{session.label}</span>
                              <span className="workspace-tag px-1.5 py-0 text-[10px]">{session.channelId}</span>
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <SidebarGroup className="flex min-h-0 flex-1 flex-col">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <ModeSwitcher
                    selection={modeSelection}
                    onSelect={handleModeSelection}
                    onOpenModeChat={handleOpenModeChat}
                  />
                </SidebarMenuItem>
              </SidebarMenu>
              <div className="sidebar-glass-group mt-3">
                <SidebarMenu>
                  {isLogsSection ? (
                    <>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>
                          <HugeiconsIcon icon={Activity01Icon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                          <span>Logs Overview</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <HugeiconsIcon icon={AiSearch02Icon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                          <span>Gateway Events</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <HugeiconsIcon icon={Message01Icon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                          <span>Chat Pipeline</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </>
                  ) : activeModeConfig.navItems.filter((item) => !(isWebRuntime && item.desktopOnly)).map((item) => {
                    const onClick = getModeNavAction(item.id);
                    const isChatsInbox = item.id === "chats-inbox";
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={
                            (item.id === "skills" && section === "skills") ||
                            (item.id === "templates" && section === "templates") ||
                            (item.id === "style-lab" && section === "style-lab") ||
                            (item.id === "oneshot" && section === "oneshot") ||
                            (item.id === "openclaw-demo" && section === "openclaw-demo") ||
                            (item.id === "openclaw-hosted-phase" && section === "openclaw-hosted-phase") ||
                            (item.id === "web-test" && section === "web-test") ||
                            (item.id === "cloud-inspector" && section === "cloud-inspector") ||
                            (item.id === "chats-inbox" && section === "chats-inbox") ||
                            (item.id === "chats-manage-channels" && section === "chats-manage-channels") ||
                            (item.id === "mail-inbox" && section === "mail-inbox") ||
                            (item.id === "mail-connect" && section === "mail-connect")
                          }
                          onClick={onClick}
                        >
                          {navItemIcon(item)}
                          {isChatsInbox ? (
                            <span className="flex w-full items-center justify-between gap-2">
                              <span>{item.label}</span>
                              <span className="workspace-tag px-1.5 py-0 text-[10px]">[5]</span>
                            </span>
                          ) : (
                            <span>{item.label}</span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </div>
            </SidebarGroupContent>

            {activeModeConfig.showHarnesses ? (
              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <SidebarGroupLabel className="group/dobby flex items-center gap-2 whitespace-nowrap">
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <span>Harnesses</span>
                    {isPaid ? (
                      <span className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                        Pro
                      </span>
                    ) : null}
                  </div>
                  <div className="ml-auto shrink-0 flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          title="Quick actions"
                          className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                          <HugeiconsIcon
                            icon={SquarePen}
                            className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          className="gap-2 whitespace-nowrap text-responsive-xs"
                          onSelect={onCreateProject}
                        >
                          <HugeiconsIcon
                            icon={SquarePen}
                            className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                          />
                          Create project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 whitespace-nowrap text-responsive-xs"
                          onSelect={() => {
                            void onOpenExistingProject();
                          }}
                        >
                          <HugeiconsIcon
                            icon={FolderOpen}
                            className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                          />
                          Open existing project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 whitespace-nowrap text-responsive-xs"
                          onSelect={onConnectGithubProject}
                        >
                          <HugeiconsIcon
                            icon={Github}
                            className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                          />
                          Connect GitHub project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          title="Sort projects"
                          className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                          <HugeiconsIcon
                            icon={ListFilter}
                            className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          className="whitespace-nowrap text-responsive-xs"
                          onSelect={() =>
                            onProjectTreeAction({
                              type: "sort.set",
                              mode: "created",
                            })
                          }
                        >
                          Sort by creation
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="whitespace-nowrap text-responsive-xs"
                          onSelect={() =>
                            onProjectTreeAction({
                              type: "sort.set",
                              mode: "name",
                            })
                          }
                        >
                          Sort by name
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="whitespace-nowrap text-responsive-xs"
                          onSelect={() =>
                            onProjectTreeAction({
                              type: "sort.set",
                              mode: "manual",
                            })
                          }
                        >
                          Sort manually
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </SidebarGroupLabel>

                <SidebarGroupContent className="min-h-0 flex-1">
                  <SidebarMenu className="h-full space-y-1 overflow-auto pr-1">
                    <Sortable
                      value={sortedProjectPaths}
                      getItemValue={(item) => item}
                      onValueChange={(nextProjectPaths) =>
                        onProjectTreeAction({
                          type: "projects.reorder",
                          orderedProjectPaths: nextProjectPaths,
                        })
                      }
                      className="space-y-1"
                    >
                      {sortedProjectPaths.map((projectPath, index) => (
                        <ProjectItem
                          key={projectPath}
                          index={index}
                          projectPath={projectPath}
                          profile={
                            projectTree.projectProfiles[projectPath] ??
                            defaultProjectProfile(projectPath)
                          }
                          isSelected={
                            projectTree.selectedProjectPath === projectPath &&
                            section === "project"
                          }
                          selectedRunId={
                            projectTree.selectedRunByProject[projectPath]
                          }
                          actionIconClass={actionIconClass}
                          folderToggleIconClass={folderToggleIconClass}
                          onSelectProject={onSelectProjectPath}
                          onProjectTreeAction={onProjectTreeAction}
                        />
                      ))}
                    </Sortable>
                  </SidebarMenu>
                </SidebarGroupContent>
              </div>
            ) : null}
          </SidebarGroup>
        )}
      </SidebarContent>

      <CommandDialog
        open={searchOpen}
        onOpenChange={onSearchOpenChange}
        title="Search Workspace"
        description="Jump to pages and mode sections."
        className="sm:max-w-[520px]"
      >
        <CommandInput placeholder="Search pages and actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Primary">
            <CommandItem
              onSelect={() => {
                onSearchOpenChange(false);
                onOpenHome();
              }}
            >
              <HugeiconsIcon icon={Home01Icon} className="h-4 w-4" />
              Home
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onSearchOpenChange(false);
                onOpenLive();
              }}
            >
              <HugeiconsIcon icon={Activity01Icon} className="h-4 w-4" />
              Logs
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onSearchOpenChange(false);
                onOpenSettings();
              }}
            >
              <HugeiconsIcon icon={Settings} className="h-4 w-4" />
              Settings
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onSearchOpenChange(false);
                void onSignOut();
              }}
            >
              <HugeiconsIcon icon={LogOut} className="h-4 w-4" />
              Log out
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={`${activeModeConfig.label} mode`}>
            {activeModeConfig.navItems.map((item) => (
              <CommandItem
                key={`search-${item.id}`}
                onSelect={() => {
                  onSearchOpenChange(false);
                  getModeNavAction(item.id)();
                }}
              >
                {navItemIcon(item)}
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <SidebarFooter>
        <div className="sidebar-utility-tabs">
          <Button
            type="button"
            variant="ghost"
            className="sidebar-utility-settings-btn w-full"
            data-active={section === "settings" ? "true" : "false"}
            aria-pressed={section === "settings"}
            onClick={() => onOpenSettings()}
          >
            <HugeiconsIcon icon={Settings} className="h-3.5 w-3.5" />
            <span>Settings</span>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
