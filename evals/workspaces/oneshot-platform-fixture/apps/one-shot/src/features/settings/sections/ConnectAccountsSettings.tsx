import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Trash2 } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type ApiProviderId,
  type ConnectedAccountsState,
  type OauthProviderId,
} from '@/features/settings/connectedAccountsTypes';
import {
  MANAGED_OAUTH_PROVIDERS,
  OAUTH_PROVIDER_META,
} from '@/features/settings/oauthProviderMappings';
import {
  authProfilesQueryKey,
  type LocalAuthProfile,
  useAuthProfiles,
} from '@/features/settings/hooks/useAuthProfiles';
import { useCredentialsCollection } from '@/shared/hooks/useCredentials';
import { type ProviderHealth, useProviderHealth } from '@/shared/hooks/useProviderHealth';

type ProviderConnectionStatus = 'active' | 'error' | 'disconnected' | 'deleting';

type ProviderHealthState = {
  status: ProviderConnectionStatus;
  detail: string;
  checkedAtMs: number;
};

type ConnectAccountsSettingsProps = {
  connectedAccounts: ConnectedAccountsState;
  onConnectedAccountsChange: (
    updater:
      | ConnectedAccountsState
      | ((prev: ConnectedAccountsState) => ConnectedAccountsState),
  ) => void;
};

type ApiProviderRow = {
  id: ApiProviderId;
  label: string;
};

type OAuthStatus = 'idle' | 'starting' | 'awaiting_auth' | 'awaiting_input' | 'completing' | 'completed' | 'failed';
type OAuthRuntimeState = {
  sessionId: string;
  status: OAuthStatus;
  detail: string;
  authUrl: string;
  instructions: string;
  promptMessage: string;
  promptPlaceholder: string;
  promptAllowEmpty: boolean;
  inputValue: string;
  openedAuthUrl: string;
  isBusy: boolean;
  error: string;
};

const API_PROVIDERS: ApiProviderRow[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'xai', label: 'X.AI' },
  { id: 'moonshot', label: 'Moonshot' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'zai', label: 'Z.AI' },
];

const OAUTH_TERMINAL_STATUSES = new Set<OAuthStatus>(['completed', 'failed', 'idle']);

function createOAuthRuntimeState(): Record<OauthProviderId, OAuthRuntimeState> {
  return {
    openai: {
      sessionId: '',
      status: 'idle',
      detail: '',
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
      isBusy: false,
      error: '',
    },
    claude: {
      sessionId: '',
      status: 'idle',
      detail: '',
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
      isBusy: false,
      error: '',
    },
    gemini: {
      sessionId: '',
      status: 'idle',
      detail: '',
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
      isBusy: false,
      error: '',
    },
  };
}

function oauthStatusClass(status: OAuthStatus, healthStatus: ProviderConnectionStatus) {
  if (status === 'failed') return 'text-red-500';
  if (status === 'starting' || status === 'awaiting_auth' || status === 'awaiting_input' || status === 'completing') return 'text-amber-600';
  if (healthStatus === 'active' || status === 'completed') return 'text-emerald-600';
  if (healthStatus === 'error') return 'text-red-500';
  return 'text-muted-foreground';
}

function maskSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'Not set';
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function oauthProviderAliases(provider: OauthProviderId): string[] {
  if (provider === 'openai') return ['openai', 'openai-codex'];
  if (provider === 'claude') return ['claude', 'anthropic'];
  return ['gemini', 'gemini-cli', 'google-gemini-cli'];
}

function managedProviderFromApi(provider: ApiProviderId): OauthProviderId | null {
  if (provider === 'openai') return 'openai';
  if (provider === 'anthropic') return 'claude';
  if (provider === 'gemini') return 'gemini';
  return null;
}

function deriveProfileEmail(profile: LocalAuthProfile): string | null {
  if (profile.email && profile.email.trim().length > 0) return profile.email.trim();
  const idx = profile.profileId.indexOf(':');
  if (idx < 0) return null;
  const suffix = profile.profileId.slice(idx + 1).trim();
  if (!suffix || suffix === 'default' || suffix === 'manual') return null;
  return suffix;
}

function formatConnectedLabel(providerLabel: string, connectedIdentity: string | null) {
  return connectedIdentity || providerLabel;
}

function providerHealthToConnectionState(entry: ProviderHealth, cloudConnected: boolean): ProviderHealthState {
  const now = Date.now();
  if (!entry.hasCredential) {
    return {
      status: 'disconnected',
      detail: cloudConnected ? 'No cloud credentials found.' : 'Cloud gateway not connected.',
      checkedAtMs: now,
    };
  }
  if (entry.readiness === 'ready') {
    return {
      status: 'active',
      detail: 'Provider is ready.',
      checkedAtMs: entry.checkedAtMs ?? now,
    };
  }
  if (entry.readiness === 'blocked' || entry.readiness === 'error') {
    const reason = entry.readinessReason || 'Provider check failed.';
    const disconnected = reason.toLowerCase().includes('no cloud token')
      || reason.toLowerCase().includes('no token')
      || reason.toLowerCase().includes('not connected');
    return {
      status: disconnected ? 'disconnected' : 'error',
      detail: reason,
      checkedAtMs: entry.checkedAtMs ?? now,
    };
  }
  return {
    status: 'disconnected',
    detail: cloudConnected ? 'Cloud credentials detected. Readiness pending.' : 'Cloud gateway not connected.',
    checkedAtMs: entry.checkedAtMs ?? now,
  };
}

function isOAuthFlowActive(runtime: OAuthRuntimeState) {
  return runtime.isBusy || runtime.status === 'starting' || runtime.status === 'awaiting_auth' || runtime.status === 'awaiting_input' || runtime.status === 'completing';
}

function isStateMismatchDetail(value: string) {
  return value.trim().toLowerCase().includes('state mismatch');
}

function normalizeOAuthDetail(value: string, providerLabel: string) {
  if (isStateMismatchDetail(value)) {
    return `${providerLabel} sign-in expired. Start again to open a fresh browser step.`;
  }
  return value;
}

function providerActionClass(status: ProviderConnectionStatus, expanded: boolean) {
  if (status === 'active') {
    return expanded
      ? 'border border-emerald-500/30 bg-emerald-500/12 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] hover:bg-emerald-500/16 dark:text-emerald-200'
      : 'border border-emerald-500/25 bg-emerald-500/14 text-emerald-700 shadow-[0_8px_24px_rgba(16,185,129,0.12),inset_0_1px_0_rgba(255,255,255,0.5)] hover:bg-emerald-500/18 dark:text-emerald-200';
  }
  if (status === 'error') {
    return 'border border-amber-500/30 bg-amber-500/12 text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] hover:bg-amber-500/16 dark:text-amber-200';
  }
  if (status === 'deleting') {
    return 'border border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-200';
  }
  return 'border border-sky-500/25 bg-sky-500/14 text-sky-700 shadow-[0_8px_24px_rgba(59,130,246,0.12),inset_0_1px_0_rgba(255,255,255,0.5)] hover:bg-sky-500/18 dark:text-sky-200';
}

function cardBorderClass(status: ProviderConnectionStatus, expanded: boolean) {
  if (status === 'active') {
    return expanded ? 'border-emerald-400/55 bg-emerald-500/[0.04]' : 'border-border/80';
  }
  if (status === 'error') {
    return expanded ? 'border-amber-400/50 bg-amber-500/[0.04]' : 'border-border/80';
  }
  return expanded ? 'border-blue-400/50 bg-blue-500/[0.04]' : 'border-border/80';
}

export function ConnectAccountsSettings({
  connectedAccounts,
  onConnectedAccountsChange,
}: ConnectAccountsSettingsProps) {
  const { orgId, userId } = useAuth();
  const queryClient = useQueryClient();
  const credentialsCollection = useCredentialsCollection();
  const capabilities = window.appShell.getCapabilities();
  const isDesktopRuntime = capabilities.platform === 'desktop';
  const tenantId = orgId ?? userId ?? '';
  const effectiveUserId = userId ?? '';
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [apiDialogProvider, setApiDialogProvider] = useState<ApiProviderId>('openai');
  const [apiDialogValue, setApiDialogValue] = useState('');
  const [oauthRuntime, setOauthRuntime] = useState<Record<OauthProviderId, OAuthRuntimeState>>(createOAuthRuntimeState);
  const [providerHealthOverrides, setProviderHealthOverrides] = useState<Partial<Record<OauthProviderId, ProviderHealthState>>>({});
  const [cloudConnected, setCloudConnected] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<OauthProviderId | null>(null);
  const [addProviderSelection, setAddProviderSelection] = useState<OauthProviderId | ''>('');
  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<OauthProviderId | null>(null);
  const pollTimersRef = useRef<Partial<Record<OauthProviderId, number>>>({});
  const pollInFlightRef = useRef<Record<OauthProviderId, boolean>>({
    openai: false,
    claude: false,
    gemini: false,
  });
  const oauthRuntimeRef = useRef(oauthRuntime);
  const lastCloudConnectedRef = useRef<boolean | null>(null);
  const openaiHealth = useProviderHealth('openai');
  const anthropicHealth = useProviderHealth('anthropic');
  const geminiHealth = useProviderHealth('gemini');

  oauthRuntimeRef.current = oauthRuntime;
  const { data: authProfiles = [] } = useAuthProfiles();
  const providerHealthQueries = useMemo(
    () => ({
      openai: { data: providerHealthOverrides.openai ?? providerHealthToConnectionState(openaiHealth, cloudConnected) },
      claude: { data: providerHealthOverrides.claude ?? providerHealthToConnectionState(anthropicHealth, cloudConnected) },
      gemini: { data: providerHealthOverrides.gemini ?? providerHealthToConnectionState(geminiHealth, cloudConnected) },
    }),
    [anthropicHealth, cloudConnected, geminiHealth, openaiHealth, providerHealthOverrides],
  );

  const apiProvidersWithKeys = useMemo(
    () => API_PROVIDERS.filter((provider) => (connectedAccounts.secrets.apiKeys[provider.id] || '').trim().length > 0),
    [connectedAccounts.secrets.apiKeys],
  );

  useEffect(() => {
    let active = true;
    void window.appShell.gatewayGetState().then((snapshot) => {
      if (!active) return;
      const next = snapshot.connectionStatus === 'connected' && snapshot.connectionScope === 'cloud';
      setCloudConnected(next);
      lastCloudConnectedRef.current = next;
    }).catch(() => {
      if (!active) return;
      setCloudConnected(false);
      lastCloudConnectedRef.current = false;
    });

    const unsubscribe = window.appShell.onGatewayState((snapshot) => {
      const next = snapshot.connectionStatus === 'connected' && snapshot.connectionScope === 'cloud';
      setCloudConnected(next);
      lastCloudConnectedRef.current = next;
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  const invalidateAccountQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: authProfilesQueryKey }),
    ]);
  }, [queryClient]);

  const setProviderHealthQueryState = useCallback((provider: OauthProviderId, next: ProviderHealthState) => {
    setProviderHealthOverrides((previous) => ({
      ...previous,
      [provider]: next,
    }));
  }, []);

  const clearProviderHealthOverride = useCallback((provider: OauthProviderId) => {
    setProviderHealthOverrides((previous) => {
      if (!(provider in previous)) return previous;
      const next = { ...previous };
      delete next[provider];
      return next;
    });
  }, []);

  const updateOauthRuntime = useCallback((
    provider: OauthProviderId,
    updater: (previous: OAuthRuntimeState) => OAuthRuntimeState,
  ) => {
    setOauthRuntime((previous) => ({
      ...previous,
      [provider]: updater(previous[provider]),
    }));
  }, []);

  const stopPolling = useCallback((provider: OauthProviderId) => {
    const timer = pollTimersRef.current[provider];
    if (!timer) return;
    window.clearInterval(timer);
    delete pollTimersRef.current[provider];
    pollInFlightRef.current[provider] = false;
  }, []);

  useEffect(() => {
    for (const provider of MANAGED_OAUTH_PROVIDERS) {
      const runtime = oauthRuntime[provider.id];
      const override = providerHealthOverrides[provider.id];
      if (!override) continue;
      if (override.status === 'deleting') continue;
      if (isOAuthFlowActive(runtime)) continue;
      clearProviderHealthOverride(provider.id);
    }
  }, [clearProviderHealthOverride, oauthRuntime, providerHealthOverrides, openaiHealth.checkedAtMs, anthropicHealth.checkedAtMs, geminiHealth.checkedAtMs]);

  const tryOpenAuthUrl = useCallback(async (provider: OauthProviderId, authUrl: string) => {
    if (!isDesktopRuntime || !authUrl) return;
    const current = oauthRuntimeRef.current[provider];
    if (current.openedAuthUrl === authUrl) return;
    try {
      await window.appShell.openExternalUrl(authUrl);
      updateOauthRuntime(provider, (previous) => ({ ...previous, openedAuthUrl: authUrl }));
    } catch (error) {
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        error: String(error),
      }));
    }
  }, [isDesktopRuntime, updateOauthRuntime]);

  const pollStatusOnce = useCallback(async (provider: OauthProviderId, sessionId: string) => {
    if (!sessionId || pollInFlightRef.current[provider]) return;
    pollInFlightRef.current[provider] = true;
    try {
      const response = await window.appShell.pipelineOAuthStatus({ sessionId });
      if (!response.found) {
        stopPolling(provider);
        updateOauthRuntime(provider, (previous) => ({
          ...previous,
          status: 'failed',
          detail: 'OAuth session not found.',
          isBusy: false,
          error: 'OAuth session not found.',
        }));
        return;
      }

      const status = (response.status ?? 'awaiting_auth') as OAuthStatus;
      const authUrl = response.authUrl ?? '';
      const instructions = response.instructions ?? '';
      const promptMessage = response.promptMessage ?? '';
      const promptPlaceholder = response.promptPlaceholder ?? '';
      const promptAllowEmpty = Boolean(response.promptAllowEmpty);
      const detail = normalizeOAuthDetail(response.detail ?? '', OAUTH_PROVIDER_META[provider].label);

      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        sessionId: response.sessionId ?? previous.sessionId,
        status,
        authUrl: status === 'failed' && isStateMismatchDetail(response.detail ?? '')
          ? ''
          : (authUrl || previous.authUrl),
        instructions: instructions || previous.instructions,
        promptMessage: promptMessage || previous.promptMessage,
        promptPlaceholder: promptPlaceholder || previous.promptPlaceholder,
        promptAllowEmpty,
        detail,
        error: status === 'failed' ? detail : '',
        isBusy: !OAUTH_TERMINAL_STATUSES.has(status),
        openedAuthUrl: status === 'failed' && isStateMismatchDetail(response.detail ?? '')
          ? ''
          : previous.openedAuthUrl,
      }));

      if (authUrl) {
        await tryOpenAuthUrl(provider, authUrl);
      }
      if (status === 'completed') {
        setProviderHealthQueryState(provider, {
          status: 'active',
          detail: `${OAUTH_PROVIDER_META[provider].label} connected successfully.`,
          checkedAtMs: Date.now(),
        });
        await invalidateAccountQueries();
      }
      if (OAUTH_TERMINAL_STATUSES.has(status)) {
        stopPolling(provider);
      }
    } catch (error) {
      stopPolling(provider);
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        status: 'failed',
        detail: normalizeOAuthDetail(String(error), OAUTH_PROVIDER_META[provider].label),
        isBusy: false,
        error: normalizeOAuthDetail(String(error), OAUTH_PROVIDER_META[provider].label),
        authUrl: isStateMismatchDetail(String(error)) ? '' : previous.authUrl,
        openedAuthUrl: isStateMismatchDetail(String(error)) ? '' : previous.openedAuthUrl,
      }));
    } finally {
      pollInFlightRef.current[provider] = false;
    }
  }, [invalidateAccountQueries, setProviderHealthQueryState, stopPolling, tryOpenAuthUrl, updateOauthRuntime]);

  const startPolling = useCallback((provider: OauthProviderId, sessionId: string) => {
    if (!sessionId) return;
    stopPolling(provider);
    void pollStatusOnce(provider, sessionId);
    const timer = window.setInterval(() => {
      void pollStatusOnce(provider, sessionId);
    }, 1000);
    pollTimersRef.current[provider] = timer;
  }, [pollStatusOnce, stopPolling]);

  useEffect(() => {
    return () => {
      for (const provider of MANAGED_OAUTH_PROVIDERS) {
        stopPolling(provider.id);
      }
    };
  }, [stopPolling]);

  const saveApiKey = async () => {
    const value = apiDialogValue.trim();
    if (!value) return;
    onConnectedAccountsChange((previous) => ({
      ...previous,
      secrets: {
        ...previous.secrets,
        apiKeys: {
          ...previous.secrets.apiKeys,
          [apiDialogProvider]: value,
        },
      },
    }));
    try {
      if (!tenantId || !effectiveUserId) {
        throw new Error('missing authenticated identity');
      }
      const existing = credentialsCollection.state.get(apiDialogProvider);
      const tx = existing
        ? credentialsCollection.update(apiDialogProvider, (draft) => {
          draft.tenant_id = tenantId;
          draft.user_id = effectiveUserId;
          draft.provider = apiDialogProvider;
          draft.token_kind = 'api-key';
          draft.token = value;
          draft.email = null;
          draft.pi_provider_id = null;
          draft.oauth_provider_id = null;
          draft.expires_at_ms = null;
          draft.account_id = null;
          draft.project_id = null;
          draft.metadata_json = null;
          draft.refresh_token = undefined;
          draft.updated_at_ms = Date.now();
        })
        : credentialsCollection.insert({
          tenant_id: tenantId,
          user_id: effectiveUserId,
          provider: apiDialogProvider,
          token_kind: 'api-key',
          token: value,
          updated_at_ms: Date.now(),
        });
      await tx.isPersisted.promise;
    } catch (error) {
      const managedProvider = managedProviderFromApi(apiDialogProvider);
      if (managedProvider) {
        setProviderHealthQueryState(managedProvider, {
          status: 'error',
          detail: `Credential save failed: ${String(error)}`,
          checkedAtMs: Date.now(),
        });
      }
    } finally {
      setApiDialogOpen(false);
      setApiDialogValue('');
      await invalidateAccountQueries();
    }
  };

  const startOAuth = useCallback(async (provider: OauthProviderId) => {
    if (!isDesktopRuntime) {
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        status: 'failed',
        detail: 'OAuth launch is available only in desktop runtime.',
        error: 'Desktop-only OAuth launch.',
      }));
      return;
    }

    stopPolling(provider);
    const previousSessionId = oauthRuntimeRef.current[provider].sessionId.trim();
    if (previousSessionId) {
      await window.appShell.pipelineOAuthCancel({ sessionId: previousSessionId }).catch(() => undefined);
    }

    const mapping = OAUTH_PROVIDER_META[provider];
    updateOauthRuntime(provider, (previous) => ({
      ...previous,
      status: 'starting',
      detail: `Starting ${mapping.label} OAuth...`,
      error: '',
      isBusy: true,
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
    }));

    try {
      const result = await window.appShell.pipelineLaunchProviderOAuth({ provider: mapping.launchProvider });
      const status = (result.status ?? 'starting') as OAuthStatus;
      const authUrl = result.authUrl ?? '';
      const instructions = result.instructions ?? '';
      const promptMessage = result.promptMessage ?? '';
      const promptPlaceholder = result.promptPlaceholder ?? '';
      const promptAllowEmpty = Boolean(result.promptAllowEmpty);

      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        sessionId: result.sessionId,
        status,
        detail: normalizeOAuthDetail(result.detail, mapping.label),
        authUrl,
        instructions,
        promptMessage,
        promptPlaceholder,
        promptAllowEmpty,
        error: status === 'failed' ? normalizeOAuthDetail(result.detail, mapping.label) : '',
        isBusy: !OAUTH_TERMINAL_STATUSES.has(status),
      }));

      if (status === 'completed') {
        setProviderHealthQueryState(provider, {
          status: 'active',
          detail: `${mapping.label} connected successfully.`,
          checkedAtMs: Date.now(),
        });
        await invalidateAccountQueries();
      }

      if (authUrl) {
        await tryOpenAuthUrl(provider, authUrl);
      }
      if (!OAUTH_TERMINAL_STATUSES.has(status)) {
        startPolling(provider, result.sessionId);
      } else {
        await invalidateAccountQueries();
      }
    } catch (error) {
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        status: 'failed',
        detail: normalizeOAuthDetail(String(error), mapping.label),
        error: normalizeOAuthDetail(String(error), mapping.label),
        isBusy: false,
        authUrl: isStateMismatchDetail(String(error)) ? '' : previous.authUrl,
        openedAuthUrl: isStateMismatchDetail(String(error)) ? '' : previous.openedAuthUrl,
      }));
    }
  }, [invalidateAccountQueries, isDesktopRuntime, setProviderHealthQueryState, startPolling, stopPolling, tryOpenAuthUrl, updateOauthRuntime]);

  const handlePrimaryAction = useCallback(async (
    providerId: OauthProviderId,
    healthStatus: ProviderConnectionStatus,
  ) => {
    if (expandedProvider === providerId) {
      const current = oauthRuntimeRef.current[providerId];
      if (healthStatus === 'active' && !isOAuthFlowActive(current)) {
        setExpandedProvider(null);
        return;
      }
      stopPolling(providerId);
      const sessionId = current.sessionId.trim();
      if (sessionId) {
        await window.appShell.pipelineOAuthCancel({ sessionId }).catch(() => undefined);
      }
      updateOauthRuntime(providerId, () => ({
        sessionId: '',
        status: 'idle',
        detail: '',
        authUrl: '',
        instructions: '',
        promptMessage: '',
        promptPlaceholder: '',
        promptAllowEmpty: false,
        inputValue: '',
        openedAuthUrl: '',
        isBusy: false,
        error: '',
      }));
      setExpandedProvider(null);
      await invalidateAccountQueries();
      return;
    }
    setExpandedProvider(providerId);
    if (healthStatus !== 'active') {
      await startOAuth(providerId);
    }
  }, [expandedProvider, invalidateAccountQueries, startOAuth, stopPolling, updateOauthRuntime]);

  const submitOAuthInput = useCallback(async (provider: OauthProviderId) => {
    if (!isDesktopRuntime) return;
    const current = oauthRuntimeRef.current[provider];
    const sessionId = current.sessionId.trim();
    const rawInput = current.inputValue;
    const trimmedInput = rawInput.trim();
    if (!sessionId || (!current.promptAllowEmpty && !trimmedInput)) return;

    updateOauthRuntime(provider, (previous) => ({
      ...previous,
      isBusy: true,
      error: '',
      detail: 'Submitting OAuth input...',
    }));

    try {
      await window.appShell.pipelineOAuthSubmitInput({
        sessionId,
        inputValue: current.promptAllowEmpty ? rawInput : trimmedInput,
      });
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        inputValue: '',
        detail: 'OAuth input submitted. Verifying...',
      }));
      await pollStatusOnce(provider, sessionId);
      const latest = oauthRuntimeRef.current[provider];
      if (!OAUTH_TERMINAL_STATUSES.has(latest.status)) {
        startPolling(provider, sessionId);
      }
    } catch (error) {
      updateOauthRuntime(provider, (previous) => ({
        ...previous,
        status: 'failed',
        detail: normalizeOAuthDetail(String(error), OAUTH_PROVIDER_META[provider].label),
        error: normalizeOAuthDetail(String(error), OAUTH_PROVIDER_META[provider].label),
        isBusy: false,
      }));
    } finally {
      const latest = oauthRuntimeRef.current[provider];
      if (OAUTH_TERMINAL_STATUSES.has(latest.status)) {
        updateOauthRuntime(provider, (previous) => ({ ...previous, isBusy: false }));
      }
      await invalidateAccountQueries();
    }
  }, [invalidateAccountQueries, isDesktopRuntime, pollStatusOnce, startPolling, updateOauthRuntime]);

  const removeProviderCredentials = useCallback(async (provider: OauthProviderId) => {
    const mapping = OAUTH_PROVIDER_META[provider];

    // 1. Immediately show "Disconnecting…" status
    setProviderHealthQueryState(provider, {
      status: 'deleting',
      detail: 'Disconnecting…',
      checkedAtMs: Date.now(),
    });

    // 2. Clear local state — always succeeds
    stopPolling(provider);
    onConnectedAccountsChange((previous) => ({
      ...previous,
      secrets: {
        ...previous.secrets,
        apiKeys: {
          ...previous.secrets.apiKeys,
          [mapping.cloudProvider]: '',
        },
      },
    }));

    const now = Date.now();
    let finalHealth: ProviderHealthState = {
      status: 'disconnected',
      detail: `${mapping.label} credentials removed.`,
      checkedAtMs: now,
    };

    // 3. Delete from the synced collection. Desktop cache cleanup follows from the live collection change.
    try {
      if (credentialsCollection.state.has(mapping.cloudProvider)) {
        const tx = credentialsCollection.delete(mapping.cloudProvider);
        await tx.isPersisted.promise;
      }
    } catch (error) {
      finalHealth = {
        status: 'error',
        detail: `${mapping.label} credential removal failed: ${String(error)}`,
        checkedAtMs: Date.now(),
      };
    }

    await queryClient.invalidateQueries({ queryKey: authProfilesQueryKey });

    // 4. Reset oauth runtime to idle
    updateOauthRuntime(provider, () => ({
      sessionId: '',
      status: 'idle',
      detail: `${mapping.label} credentials removed.`,
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
      isBusy: false,
      error: '',
    }));

    // 5. Set final health based on the synced delete result
    setProviderHealthQueryState(provider, finalHealth);
    void invalidateAccountQueries();

    // 6. Close the popover
    setDeleteConfirmProvider(null);
  }, [credentialsCollection, invalidateAccountQueries, onConnectedAccountsChange, queryClient, setProviderHealthQueryState, stopPolling, updateOauthRuntime]);

  const onAddProvider = useCallback(async (provider: OauthProviderId) => {
    setAddProviderSelection(provider);
    setExpandedProvider(provider);
    await startOAuth(provider);
    window.setTimeout(() => setAddProviderSelection(''), 0);
  }, [startOAuth]);

  const closeAndResetProviderFlow = useCallback(async (provider: OauthProviderId) => {
    stopPolling(provider);
    const sessionId = oauthRuntimeRef.current[provider].sessionId.trim();
    if (sessionId) {
      await window.appShell.pipelineOAuthCancel({ sessionId }).catch(() => undefined);
    }
    updateOauthRuntime(provider, () => ({
      sessionId: '',
      status: 'idle',
      detail: '',
      authUrl: '',
      instructions: '',
      promptMessage: '',
      promptPlaceholder: '',
      promptAllowEmpty: false,
      inputValue: '',
      openedAuthUrl: '',
      isBusy: false,
      error: '',
    }));
    setExpandedProvider((current) => (current === provider ? null : current));
    await invalidateAccountQueries();
  }, [invalidateAccountQueries, stopPolling, updateOauthRuntime]);

  const providerProfileMap = useMemo<Record<OauthProviderId, LocalAuthProfile[]>>(() => {
    const mapped: Record<OauthProviderId, LocalAuthProfile[]> = {
      openai: [],
      claude: [],
      gemini: [],
    };
    for (const providerId of MANAGED_OAUTH_PROVIDERS.map((item) => item.id)) {
      const aliases = new Set(oauthProviderAliases(providerId));
      mapped[providerId] = authProfiles
        .filter((profile) => aliases.has(profile.provider.trim().toLowerCase()))
        .sort((a, b) => {
          const aOAuth = a.type === 'oauth' ? 1 : 0;
          const bOAuth = b.type === 'oauth' ? 1 : 0;
          if (aOAuth !== bOAuth) return bOAuth - aOAuth;
          const aExp = typeof a.expires === 'number' ? a.expires : 0;
          const bExp = typeof b.expires === 'number' ? b.expires : 0;
          return bExp - aExp;
        });
    }
    return mapped;
  }, [authProfiles]);

  return (
    <div className="w-full max-w-xl space-y-6 md:max-w-3xl 2xl:max-w-2xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Connected accounts</h3>
            <p className="text-xs text-muted-foreground">Pick a provider and finish the sign-in steps in your browser.</p>
          </div>
          <Select
            value={addProviderSelection || undefined}
            onValueChange={(value) => { void onAddProvider(value as OauthProviderId); }}
          >
            <SelectTrigger className="h-9 w-[190px] rounded-full bg-background text-xs">
              <SelectValue placeholder="+ Add account" />
            </SelectTrigger>
            <SelectContent>
              {MANAGED_OAUTH_PROVIDERS.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  Add {provider.label} account
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {MANAGED_OAUTH_PROVIDERS.map((provider) => {
            const runtime = oauthRuntime[provider.id];
            const expanded = expandedProvider === provider.id;
            const health = providerHealthQueries[provider.id].data ?? {
              status: 'disconnected' as ProviderConnectionStatus,
              detail: cloudConnected ? 'No cloud credentials found.' : 'Cloud gateway not connected.',
              checkedAtMs: Date.now(),
            };
            const profiles = providerProfileMap[provider.id] ?? [];
            const primaryProfile = profiles[0] ?? null;
            const hasConnectedProfile = Boolean(primaryProfile);
            const optimisticConnected = hasConnectedProfile || runtime.status === 'completed';
            const connectedIdentity = primaryProfile ? deriveProfileEmail(primaryProfile) : null;
            const connectedLabel = formatConnectedLabel(provider.label, connectedIdentity);
            const oauthMessage = runtime.error || runtime.detail || health.detail || provider.hint;
            const effectiveHealthStatus: ProviderConnectionStatus = runtime.status === 'completed'
              ? 'active'
              : health.status === 'error'
                ? 'error'
                : health.status === 'deleting'
                  ? 'deleting'
                  : optimisticConnected
                    ? 'active'
                    : health.status;
            const actionLabel = !optimisticConnected
              ? 'Connect'
              : runtime.isBusy
                ? 'Connecting…'
                : effectiveHealthStatus === 'active'
                  ? 'Connected'
                  : effectiveHealthStatus === 'error'
                    ? 'Reconnect'
                    : effectiveHealthStatus === 'deleting'
                      ? 'Disconnecting…'
                      : 'Connect';
            const canDelete = profiles.length > 1;
            const accessSummary = primaryProfile?.type === 'oauth' ? 'Subscription login' : 'Saved key';
            const sessionSummary = typeof primaryProfile?.expires === 'number'
              ? `Session expires ${new Date(primaryProfile.expires).toLocaleDateString()}`
              : 'Session available';
            const hasCompletedFlow = optimisticConnected || effectiveHealthStatus === 'active';
            const showPromptInput = runtime.status === 'awaiting_input'
              || runtime.promptMessage.trim().length > 0
              || runtime.inputValue.trim().length > 0;
            const browserButtonLabel = runtime.openedAuthUrl
              ? 'Open browser again'
              : 'Continue in browser';
            const promptLabel = runtime.promptMessage.trim() || 'Paste the code from your browser';
            const supportText = runtime.instructions.trim() || oauthMessage;
            const closeButtonLabel = health.status === 'active' && !isOAuthFlowActive(runtime) ? 'Close' : 'Cancel';
            const needsFreshRestart = runtime.status === 'failed' && isStateMismatchDetail(runtime.error || runtime.detail);

            return (
              <Card
                key={provider.id}
                className={`overflow-hidden border bg-card/70 p-0 shadow-none transition-colors ${cardBorderClass(effectiveHealthStatus, expanded)}`}
              >
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background">
                          <img
                            src={provider.logoSrc}
                            alt={`${provider.label} logo`}
                            className="h-4 w-4 object-contain"
                          />
                        </div>
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{connectedLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2">
                      <div className="w-[112px]">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={`h-8 w-full rounded-full px-3 text-[12px] font-semibold ${providerActionClass(effectiveHealthStatus, expanded)}`}
                          onClick={() => void handlePrimaryAction(provider.id, effectiveHealthStatus)}
                          disabled={runtime.isBusy && !expanded}
                        >
                          {actionLabel}
                        </Button>
                      </div>
                      <div className="w-[92px]" />
                      <div className="flex w-8 justify-end">
                        {canDelete ? (
                          <Popover
                            open={deleteConfirmProvider === provider.id}
                            onOpenChange={(open) => setDeleteConfirmProvider(open ? provider.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="h-8 w-8 text-red-500 hover:text-red-500"
                                title={`Delete ${provider.label}`}
                                disabled={runtime.isBusy}
                              >
                                <HugeiconsIcon icon={Trash2} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[220px]">
                              <p className="text-xs text-foreground">Delete this extra {provider.label} account?</p>
                              <div className="mt-3 flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setDeleteConfirmProvider(null)}
                                >
                                  No
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void removeProviderCredentials(provider.id)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="space-y-4 border-t border-border/60 pt-4">
                      {hasCompletedFlow ? (
                        <div className="flex flex-col gap-3 rounded-2xl bg-muted/20 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 pl-[42px]">
                            <p className="text-sm font-medium text-foreground">{connectedLabel}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{accessSummary}</span>
                              <span>{sessionSummary}</span>
                            </div>
                          </div>
                          <div className="grid w-[252px] grid-cols-[112px_1fr] gap-2 self-end sm:self-auto">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-[112px] rounded-full px-3"
                              onClick={() => void startOAuth(provider.id)}
                              disabled={runtime.isBusy && !runtime.authUrl}
                            >
                              Reconnect
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-[92px] justify-self-end rounded-full px-3"
                              onClick={() => setExpandedProvider((current) => (current === provider.id ? null : current))}
                            >
                              Close
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-semibold text-foreground">Connect {provider.label}</p>
                              <p className={`text-xs leading-relaxed ${oauthStatusClass(runtime.status, health.status)}`}>
                                {supportText}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-full px-3"
                              onClick={() => void closeAndResetProviderFlow(provider.id)}
                            >
                              {closeButtonLabel}
                            </Button>
                          </div>

                          <div className="mt-4 space-y-3">
                            <Button
                              type="button"
                              size="sm"
                              className="h-10 w-full rounded-2xl px-4 sm:w-auto"
                              onClick={() => {
                                if (runtime.authUrl) {
                                  void window.appShell.openExternalUrl(runtime.authUrl);
                                  return;
                                }
                                void startOAuth(provider.id);
                              }}
                              disabled={!runtime.authUrl && runtime.isBusy}
                            >
                              {needsFreshRestart ? 'Start again' : browserButtonLabel}
                            </Button>

                            {showPromptInput ? (
                              <div className="space-y-2 rounded-2xl bg-muted/35 p-3">
                                <p className="text-xs font-medium text-foreground">{promptLabel}</p>
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_132px]">
                                  <Input
                                    value={runtime.inputValue}
                                    onChange={(event) => updateOauthRuntime(provider.id, (previous) => ({
                                      ...previous,
                                      inputValue: event.target.value,
                                    }))}
                                    placeholder={runtime.promptPlaceholder || 'Enter code'}
                                    className="h-11 rounded-xl bg-background"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-11 rounded-xl"
                                    onClick={() => void submitOAuthInput(provider.id)}
                                    disabled={
                                      !isDesktopRuntime
                                      || runtime.status !== 'awaiting_input'
                                      || !runtime.sessionId
                                      || (!runtime.promptAllowEmpty && !runtime.inputValue.trim())
                                    }
                                  >
                                    Continue
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 border-t border-border/70 pt-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-medium">API keys</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-background px-3"
            onClick={() => {
              setApiDialogProvider(connectedAccounts.defaultApiProvider);
              setApiDialogValue('');
              setApiDialogOpen(true);
            }}
          >
            + Add key
          </Button>
        </div>

        {apiProvidersWithKeys.length > 0 ? (
          <div className="divide-y divide-border/70 rounded-xl bg-muted/20">
            {apiProvidersWithKeys.map((provider) => {
              const value = connectedAccounts.secrets.apiKeys[provider.id] || '';
              return (
                <div key={provider.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{provider.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{maskSecret(value)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {connectedAccounts.defaultApiProvider === provider.id ? (
                      <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">
                        <HugeiconsIcon icon={Star} className="mr-1 h-3 w-3" />
                        Default
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-4"
                      onClick={() => {
                        setApiDialogProvider(provider.id);
                        setApiDialogValue(value);
                        setApiDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <Dialog open={apiDialogOpen} onOpenChange={setApiDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save API key</DialogTitle>
            <DialogDescription>Stored locally for the signed-in user profile.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={apiDialogProvider} onValueChange={(next) => setApiDialogProvider(next as ApiProviderId)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>API key</Label>
              <Input value={apiDialogValue} onChange={(event) => setApiDialogValue(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApiDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => { void saveApiKey(); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
