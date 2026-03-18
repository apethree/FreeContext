import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_CONNECTED_ACCOUNTS_STATE,
  type ConnectedAccountsState,
  type ChatProviderSelection,
} from '@/features/settings/connectedAccountsTypes';
import type { EnvMap } from '@/features/settings/types';

const USER_KEY_PREFIX = 'oneshot.user.';

type UserSettings = {
  envDraft: EnvMap;
  connectedAccounts: ConnectedAccountsState;
};

const DEFAULT_USER_SETTINGS: UserSettings = {
  envDraft: {},
  connectedAccounts: DEFAULT_CONNECTED_ACCOUNTS_STATE,
};

function normalizeUserSettings(raw: unknown): UserSettings {
  const next = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const envDraft =
    next.envDraft && typeof next.envDraft === 'object'
      ? Object.fromEntries(
          Object.entries(next.envDraft as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value ?? ''),
          ]),
        )
      : {};

  const connected = next.connectedAccounts && typeof next.connectedAccounts === 'object'
    ? (next.connectedAccounts as Record<string, unknown>)
    : {};

  const secretsRaw = connected.secrets && typeof connected.secrets === 'object'
    ? (connected.secrets as Record<string, unknown>)
    : {};

  const apiKeys =
    secretsRaw.apiKeys && typeof secretsRaw.apiKeys === 'object'
      ? Object.fromEntries(
          Object.entries(secretsRaw.apiKeys as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value ?? ''),
          ]),
        )
      : {};

  const proxyTokens =
    secretsRaw.proxyTokens && typeof secretsRaw.proxyTokens === 'object'
      ? Object.fromEntries(
          Object.entries(secretsRaw.proxyTokens as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value ?? ''),
          ]),
        )
      : {};

  const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const normalizeChatProvider = (value: unknown): ChatProviderSelection => {
    const normalized = normalizeString(value);
    if (!normalized) return DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatProvider;
    if (normalized === 'auto' || normalized === 'proxy') return normalized;
    if (normalized.startsWith('api:') || normalized.startsWith('proxy:')) {
      return normalized as ChatProviderSelection;
    }
    return DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatProvider;
  };

  const proxyProfiles: ConnectedAccountsState['proxyProfiles'] = Array.isArray(connected.proxyProfiles)
    ? (connected.proxyProfiles as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const record = entry as Record<string, unknown>;
          const id = normalizeString(record.id);
          if (!id) return null;
          return {
            id,
            name: normalizeString(record.name) || 'Proxy',
            baseUrl: normalizeString(record.baseUrl),
            enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
          };
        })
        .filter((value): value is ConnectedAccountsState['proxyProfiles'][number] => Boolean(value))
    : [];

  const activeProxyProfileIdCandidate = normalizeString(connected.activeProxyProfileId);
  const activeProxyProfileId = proxyProfiles.some((profile) => profile.id === activeProxyProfileIdCandidate)
    ? activeProxyProfileIdCandidate
    : '';

  const connectedAccounts: ConnectedAccountsState = {
    ...DEFAULT_CONNECTED_ACCOUNTS_STATE,
    ...connected,
    proxyProfiles,
    activeProxyProfileId,
    defaultChatProvider: normalizeChatProvider(connected.defaultChatProvider),
    defaultChatModel: normalizeString(connected.defaultChatModel),
    secrets: {
      ...DEFAULT_CONNECTED_ACCOUNTS_STATE.secrets,
      apiKeys: apiKeys as ConnectedAccountsState['secrets']['apiKeys'],
      proxyTokens: proxyTokens as ConnectedAccountsState['secrets']['proxyTokens'],
    },
  };

  return { envDraft, connectedAccounts };
}

/**
 * `tenantId` is the Clerk org ID (or user ID for personal tenants).
 * Pass it alongside `userId` so the sync engine scopes ops by identity.
 */
export function useUserSettings(userId: string | null | undefined, tenantId?: string | null) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<number | null>(null);
  const lastSerializedRef = useRef<string>('');
  const hydratedRef = useRef<string | null>(null);
  // Keep a ref to the latest loadQuery data so login effect doesn't re-run on data changes.
  const loadQueryDataRef = useRef<UserSettings>(DEFAULT_USER_SETTINGS);

  const userKey = useMemo(
    () => `${USER_KEY_PREFIX}${(userId || 'anonymous')}.settings`,
    [userId],
  );

  const queryKey = useMemo(() => ['one-shot', 'user-settings', userKey], [userKey]);

  const loadQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await window.appShell.getSetting(userKey);
      return normalizeUserSettings(raw);
    },
    initialData: DEFAULT_USER_SETTINGS,
  });

  loadQueryDataRef.current = loadQuery.data;

  const saveMutation = useMutation({
    mutationKey: ['one-shot', 'user-settings-save', userKey],
    mutationFn: async (next: UserSettings) => {
      await window.appShell.setSetting(userKey, next as unknown as Record<string, unknown>);
    },
  });

  const schedulePersist = useCallback((next: UserSettings) => {
    const serialized = JSON.stringify(next);
    if (lastSerializedRef.current === serialized) return;
    lastSerializedRef.current = serialized;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      saveMutation.mutate(next);
    }, 180);
  }, [saveMutation]);

  const persistNow = useCallback((next: UserSettings) => {
    const serialized = JSON.stringify(next);
    if (lastSerializedRef.current === serialized) return;
    lastSerializedRef.current = serialized;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    saveMutation.mutate(next);
  }, [saveMutation]);

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // On userId/tenantId change: keep the main process aligned with the active user
  // so local profile paths and cloud auth use the correct identity.
  useEffect(() => {
    if (!userId) {
      hydratedRef.current = null;
      return;
    }
    const identityKey = `${userId}:${tenantId ?? ''}`;
    if (hydratedRef.current === identityKey) return;
    hydratedRef.current = identityKey;

    void window.appShell.pipelineSetActiveUser({
      userId,
      tenantId: tenantId ?? userId,
    }).catch(() => {
      // Best-effort — local openclaw profile path setup.
    });
  }, [userId, tenantId]);

  const setEnvDraft = useCallback((updater: EnvMap | ((previous: EnvMap) => EnvMap)) => {
    queryClient.setQueryData<UserSettings>(queryKey, (previous) => {
      const base = previous ?? DEFAULT_USER_SETTINGS;
      const nextEnv = typeof updater === 'function' ? updater(base.envDraft) : updater;
      const nextSettings = { ...base, envDraft: nextEnv };
      schedulePersist(nextSettings);
      return nextSettings;
    });
  }, [queryClient, queryKey, schedulePersist]);

  const setConnectedAccounts = useCallback(
    (
      updater:
        | ConnectedAccountsState
        | ((previous: ConnectedAccountsState) => ConnectedAccountsState),
    ) => {
      queryClient.setQueryData<UserSettings>(queryKey, (previous) => {
        const base = previous ?? DEFAULT_USER_SETTINGS;
        const nextAccounts =
          typeof updater === 'function' ? updater(base.connectedAccounts) : updater;
        const nextSettings = { ...base, connectedAccounts: nextAccounts };
        persistNow(nextSettings);
        return nextSettings;
      });
    },
    [persistNow, queryClient, queryKey],
  );

  return {
    loading: loadQuery.isLoading,
    envDraft: loadQuery.data.envDraft,
    connectedAccounts: loadQuery.data.connectedAccounts,
    setEnvDraft,
    setConnectedAccounts,
    userKey,
    refetch: loadQuery.refetch,
  };
}
