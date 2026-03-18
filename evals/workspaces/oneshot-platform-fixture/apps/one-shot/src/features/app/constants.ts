import type { OpenTarget, SettingsSection } from '@/features/app/types';

export const SETTINGS_SECTIONS: SettingsSection[] = [
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

export const OPEN_TARGETS: Array<{
  id: OpenTarget;
  label: string;
  iconSrc: string;
}> = [
  { id: 'vscode', label: 'VS Code', iconSrc: '/editor-icons/vscode_logo.png' },
  { id: 'cursor', label: 'Cursor', iconSrc: '/editor-icons/cursor_logo.png' },
  { id: 'zed', label: 'Zed', iconSrc: '/editor-icons/zed_logo.png' },
  { id: 'finder', label: 'Finder', iconSrc: '/editor-icons/finder_icon.png' },
  { id: 'ghostty', label: 'Ghostty', iconSrc: '/editor-icons/ghostty_logo.png' },
];
