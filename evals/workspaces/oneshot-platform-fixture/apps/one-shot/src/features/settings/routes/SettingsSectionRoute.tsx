import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SETTINGS_SECTIONS } from '@/features/app/constants';
import type { SettingsSection } from '@/features/app/types';
import { useAppShellContext } from '@/features/app/AppShellContext';
import { ArchivedProjectsSettingsRoute } from '@/features/settings/routes/ArchivedProjectsSettingsRoute';
import { BillingSettingsRoute } from '@/features/settings/routes/BillingSettingsRoute';
import { ConnectAccountsSettingsRoute } from '@/features/settings/routes/ConnectAccountsSettingsRoute';
import { GeneralSettingsRoute } from '@/features/settings/routes/GeneralSettingsRoute';
import { HookRoutesSettingsRoute } from '@/features/settings/routes/HookRoutesSettingsRoute';
import { PlaceholderSettingsRoute } from '@/features/settings/routes/PlaceholderSettingsRoute';
import { WorktreesSettingsRoute } from '@/features/settings/routes/WorktreesSettingsRoute';
import { ChatsManageChannelsPage } from '@/features/chats/ChatsManageChannelsPage';

const SECTION_PLACEHOLDERS: Record<string, { summary: string; actions: Array<{ label: string; value: string }> }> = {
  'MCP servers': {
    summary: 'Inspect and manage MCP server registrations used by local skills.',
    actions: [
      { label: 'Server registry', value: 'Not connected in one-shot migration phase.' },
      { label: 'Diagnostics', value: 'Health checks and restart actions arrive in backend parity.' },
    ],
  },
  Git: {
    summary: 'Repository automation and commit policy controls for project workflows.',
    actions: [
      { label: 'Default branch policy', value: 'main (read-only for now)' },
      { label: 'Auto-commit controls', value: 'Disabled until managed execution is wired.' },
    ],
  },
  Environments: {
    summary: 'Define environment variables and runtime profiles per workspace.',
    actions: [
      { label: 'Default runtime', value: 'Local machine runtime (active)' },
      { label: 'Profile sync', value: 'Deferred to cloud-sync backend phase.' },
    ],
  },
  Worktrees: {
    summary: 'Worktree management for parallel implementation streams.',
    actions: [
      { label: 'Auto-create worktree', value: 'Not enabled in local-only mode.' },
      { label: 'Cleanup policy', value: 'Manual cleanup currently required.' },
    ],
  },
  'Archived threads': {
    summary: 'Conversation history and retention controls.',
    actions: [
      { label: 'Retention', value: 'Stored locally in one-shot app state.' },
      { label: 'Restore', value: 'Thread restore UI is queued for next migration pass.' },
    ],
  },
};

function normalizeSection(raw: string | undefined, fallback: SettingsSection): SettingsSection {
  if (!raw) return fallback;
  const decoded = decodeURIComponent(raw);
  if (SETTINGS_SECTIONS.includes(decoded as SettingsSection)) {
    return decoded as SettingsSection;
  }
  return fallback;
}

function encodeSectionPath(section: SettingsSection): string {
  return `/home/settings/${encodeURIComponent(section)}`;
}

export function SettingsSectionRoute() {
  const navigate = useNavigate();
  const { section } = useParams();
  const { appState, setAppState } = useAppShellContext();

  const activeSection = useMemo(
    () => normalizeSection(section, appState.settingsSection),
    [appState.settingsSection, section],
  );

  useEffect(() => {
    if (!section) {
      navigate(encodeSectionPath(activeSection), { replace: true });
      return;
    }
    const decoded = decodeURIComponent(section);
    if (decoded !== activeSection) {
      navigate(encodeSectionPath(activeSection), { replace: true });
    }
  }, [activeSection, navigate, section]);

  useEffect(() => {
    if (appState.settingsSection === activeSection) {
      return;
    }
    setAppState((previous) => ({ ...previous, settingsSection: activeSection }));
  }, [activeSection, appState.settingsSection, setAppState]);

  if (activeSection === 'General') {
    return <GeneralSettingsRoute />;
  }
  if (activeSection === 'Billing') {
    return <BillingSettingsRoute />;
  }
  if (activeSection === 'Connect Accounts') {
    return <ConnectAccountsSettingsRoute />;
  }
  if (activeSection === 'Manage Channels') {
    return <ChatsManageChannelsPage />;
  }
  if (activeSection === 'Hook Routes') {
    return <HookRoutesSettingsRoute />;
  }
  if (activeSection === 'Archived projects') {
    return <ArchivedProjectsSettingsRoute />;
  }
  if (activeSection === 'Worktrees') {
    return <WorktreesSettingsRoute />;
  }

  const placeholder = SECTION_PLACEHOLDERS[activeSection] || {
    summary: 'This settings section is ready for app-specific controls.',
    actions: [{ label: 'Status', value: 'Coming soon' }],
  };
  return (
    <PlaceholderSettingsRoute
      title={activeSection}
      summary={placeholder.summary}
      actions={placeholder.actions}
    />
  );
}
