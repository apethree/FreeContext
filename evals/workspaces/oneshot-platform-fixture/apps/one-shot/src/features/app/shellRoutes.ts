import { matchPath } from 'react-router-dom';
import { safeProjectName } from '@/features/app/defaults';
import { MODE_CONFIG } from '@/features/app/modeConfig';
import type { AppMode, SettingsSection } from '@/features/app/types';

export type ShellSection =
  | 'home'
  | 'skills'
  | 'templates'
  | 'style-lab'
  | 'oneshot'
  | 'openclaw-demo'
  | 'openclaw-hosted-phase'
  | 'live'
  | 'global-assistant'
  | 'web-test'
  | 'ghost-layer'
  | 'cloud-inspector'
  | 'chats-inbox'
  | 'chats-manage-channels'
  | 'mail-inbox'
  | 'mail-connect'
  | 'mode-home'
  | 'create'
  | 'project'
  | 'settings';

export type ShellView = {
  section: ShellSection;
  pageTitle: string;
  mode?: AppMode;
  projectPath?: string;
  runId?: string;
  settingsSection?: SettingsSection;
};

const VALID_SETTINGS_SECTIONS: SettingsSection[] = [
  'General',
  'Billing',
  'Connect Accounts',
  'Manage Channels',
  'Hook Routes',
  'Archived projects',
  'MCP servers',
  'Git',
  'Environments',
  'Worktrees',
  'Archived threads',
];

function normalizeSettingsSection(section?: string): SettingsSection {
  if (!section) return 'General';
  const decoded = decodeURIComponent(section);
  return VALID_SETTINGS_SECTIONS.includes(decoded as SettingsSection)
    ? (decoded as SettingsSection)
    : 'General';
}

function normalizeMode(mode?: string): AppMode | undefined {
  if (!mode) return undefined;
  if (mode === 'work' || mode === 'finance' || mode === 'social' || mode === 'health' || mode === 'chats' || mode === 'mail') {
    return mode;
  }
  if (mode === 'logistics') return 'social';
  if (mode === 'communication') return 'chats';
  return undefined;
}

export function resolveShellView(pathname: string): ShellView {
  const chatsInboxMatch = matchPath('/home/mode/chats/inbox', pathname);
  if (chatsInboxMatch) {
    return {
      section: 'chats-inbox',
      mode: 'chats',
      pageTitle: 'Inbox',
    };
  }

  const chatsManageMatch = matchPath('/home/mode/chats/manage-channels', pathname);
  if (chatsManageMatch) {
    return {
      section: 'chats-manage-channels',
      mode: 'chats',
      pageTitle: 'Manage Channels',
    };
  }

  const mailInboxMatch = matchPath('/home/mode/mail/inbox', pathname);
  if (mailInboxMatch) {
    return {
      section: 'mail-inbox',
      mode: 'mail',
      pageTitle: 'Inbox',
    };
  }

  const mailConnectMatch = matchPath('/home/mode/mail/connect-mail', pathname);
  if (mailConnectMatch) {
    return {
      section: 'mail-connect',
      mode: 'mail',
      pageTitle: 'Connect Mail',
    };
  }

  const modeMatch = matchPath('/home/mode/:mode', pathname);
  const matchedMode = normalizeMode(modeMatch?.params.mode);
  if (modeMatch?.params.mode && matchedMode) {
    return {
      section: 'mode-home',
      mode: matchedMode,
      pageTitle: MODE_CONFIG[matchedMode].label,
    };
  }

  const settingsMatch = matchPath('/home/settings/:section', pathname);
  if (pathname.startsWith('/home/settings')) {
    const settingsSection = normalizeSettingsSection(settingsMatch?.params.section);
    return {
      section: 'settings',
      settingsSection,
      pageTitle: settingsSection,
    };
  }

  const projectRunMatch = matchPath('/home/project/:projectId/:runId', pathname);
  if (projectRunMatch?.params.projectId) {
    const projectPath = decodeURIComponent(projectRunMatch.params.projectId);
    return {
      section: 'project',
      projectPath,
      runId: projectRunMatch.params.runId || undefined,
      pageTitle: safeProjectName(projectPath),
    };
  }

  const projectMatch = matchPath('/home/project/:projectId', pathname);
  if (projectMatch?.params.projectId) {
    const projectPath = decodeURIComponent(projectMatch.params.projectId);
    return {
      section: 'project',
      projectPath,
      pageTitle: safeProjectName(projectPath),
    };
  }

  if (pathname === '/home/skills') {
    return { section: 'skills', pageTitle: 'Skills' };
  }
  if (pathname === '/home/templates') {
    return { section: 'templates', pageTitle: 'Templates' };
  }
  if (pathname === '/home/style-lab') {
    return { section: 'style-lab', pageTitle: 'Style Lab' };
  }
  if (pathname === '/home/one-shot') {
    return { section: 'oneshot', pageTitle: 'One Shot' };
  }
  if (pathname === '/home/openclaw-demo') {
    return { section: 'openclaw-demo', pageTitle: 'OpenClaw Demo' };
  }
  if (pathname === '/home/openclaw-hosted-phase') {
    return { section: 'openclaw-hosted-phase', pageTitle: 'Hosted Phase Test' };
  }
  if (pathname === '/home/live') {
    return { section: 'live', pageTitle: 'Logs' };
  }
  if (pathname === '/home/global-assistant') {
    return { section: 'global-assistant', pageTitle: 'Global Assistant' };
  }
  if (pathname === '/home/web-test') {
    return { section: 'web-test', pageTitle: 'Web Test' };
  }
  if (pathname === '/home/ghost-layer') {
    return { section: 'ghost-layer', pageTitle: 'Ghost Layer' };
  }
  if (pathname === '/home/cloud-inspector') {
    return { section: 'cloud-inspector', pageTitle: 'Cloud Inspector' };
  }
  if (pathname === '/home/create') {
    return { section: 'create', pageTitle: 'Create Project' };
  }

  return { section: 'home', pageTitle: 'Home' };
}
