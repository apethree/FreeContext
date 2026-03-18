import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EnvMap, EntitlementTier, BillingPlanResponse, ProjectSyncStatus } from '@/features/settings/types';
import {
  DEFAULT_CONNECTED_ACCOUNTS_STATE,
  type ApiProviderId,
  type ConnectedAccountsState,
  type ConnectedAccountsSecrets,
  type ChatProviderSelection,
  type OauthProviderId,
  type ProxyProfileMeta,
} from '@/features/settings/connectedAccountsTypes';

const MACHINE_KEY = 'oneshot.settings.machine';
const USER_KEY_PREFIX = 'oneshot.user.';

const DEFAULT_WORKSPACE_ROOT = '~/.capzero';

type MachineSettings = {
  fontSize: number;
  workspaceRoot: string;
};

type UserSettings = {
  envDraft: EnvMap;
  connectedAccounts: ConnectedAccountsState;
};

type PersistedMachine = Partial<MachineSettings>;
type PersistedUser = Partial<UserSettings>;

function normalizeMachine(raw: unknown): MachineSettings {
  const next = (raw && typeof raw === 'object' ? (raw as PersistedMachine) : {}) ?? {};
  const fontSize = typeof next.fontSize === 'number' && Number.isFinite(next.fontSize)
    ? Math.min(16, Math.max(12, Math.round(next.fontSize)))
    : 13;
  const workspaceRoot = typeof next.workspaceRoot === 'string' && next.workspaceRoot.trim()
    ? next.workspaceRoot.trim()
    : DEFAULT_WORKSPACE_ROOT;
  return { fontSize, workspaceRoot };
}

function normalizeUser(raw: unknown): UserSettings {
  const next = (raw && typeof raw === 'object' ? (raw as PersistedUser) : {}) ?? {};
  const envDraft =
    next.envDraft && typeof next.envDraft === 'object'
      ? Object.fromEntries(
          Object.entries(next.envDraft as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
        )
      : {};

  const connectedRaw =
    (next as unknown as { connectedAccounts?: unknown }).connectedAccounts;

  const normalizeProvider = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
  };

  const normalizeChatProvider = (value: unknown): ChatProviderSelection => {
    if (typeof value !== 'string') {
      return DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatProvider;
    }
    const normalized = value.trim();
    if (!normalized) {
      return DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatProvider;
    }
    if (normalized === 'auto' || normalized === 'proxy') {
      return normalized;
    }
    if (normalized.startsWith('api:') || normalized.startsWith('proxy:')) {
      return normalized as ChatProviderSelection;
    }
    return DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatProvider;
  };

  const secretsRaw = (connectedRaw && typeof connectedRaw === 'object')
    ? (connectedRaw as { secrets?: unknown }).secrets
    : undefined;

  const secrets: ConnectedAccountsSecrets = {
    apiKeys:
      secretsRaw && typeof secretsRaw === 'object' && (secretsRaw as { apiKeys?: unknown }).apiKeys && typeof (secretsRaw as { apiKeys?: unknown }).apiKeys === 'object'
        ? Object.fromEntries(
            Object.entries((secretsRaw as { apiKeys: Record<string, unknown> }).apiKeys).map(([key, value]) => [
              key,
              String(value ?? ''),
            ]),
          ) as ConnectedAccountsSecrets['apiKeys']
        : {},
    proxyTokens:
      secretsRaw && typeof secretsRaw === 'object' && (secretsRaw as { proxyTokens?: unknown }).proxyTokens && typeof (secretsRaw as { proxyTokens?: unknown }).proxyTokens === 'object'
        ? Object.fromEntries(
            Object.entries((secretsRaw as { proxyTokens: Record<string, unknown> }).proxyTokens).map(([key, value]) => [
              key,
              String(value ?? ''),
            ]),
          )
        : {},
  };

  const proxyProfiles: ProxyProfileMeta[] = Array.isArray(
    (connectedRaw as Record<string, unknown> | null)?.proxyProfiles,
  )
    ? (connectedRaw as { proxyProfiles: unknown[] }).proxyProfiles
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const record = entry as Record<string, unknown>;
          const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
          if (!id) return null;
          const name =
            typeof record.name === 'string' && record.name.trim()
              ? record.name.trim()
              : 'Proxy';
          const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
          const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
          return { id, name, baseUrl, enabled } satisfies ProxyProfileMeta;
        })
        .filter((value): value is ProxyProfileMeta => Boolean(value))
    : [];

  const activeProxyProfileIdCandidate =
    typeof (connectedRaw as Record<string, unknown> | null)?.activeProxyProfileId === 'string'
      ? String((connectedRaw as { activeProxyProfileId: unknown }).activeProxyProfileId).trim()
      : '';

  const activeProxyProfileId = proxyProfiles.some((entry) => entry.id === activeProxyProfileIdCandidate)
    ? activeProxyProfileIdCandidate
    : '';

  const connectedAccounts: ConnectedAccountsState = {
    defaultApiProvider: normalizeProvider<ApiProviderId>(
      (connectedRaw as Record<string, unknown> | null)?.defaultApiProvider,
      ['openai', 'anthropic', 'gemini', 'xai', 'moonshot', 'minimax', 'zai'] as const,
      DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultApiProvider,
    ),
    defaultOauthProvider: normalizeProvider<OauthProviderId>(
      (connectedRaw as Record<string, unknown> | null)?.defaultOauthProvider,
      ['claude', 'openai', 'gemini'] as const,
      DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultOauthProvider,
    ),
    defaultChatProvider: normalizeChatProvider(
      (connectedRaw as Record<string, unknown> | null)?.defaultChatProvider,
    ),
    defaultChatModel:
      typeof (connectedRaw as Record<string, unknown> | null)?.defaultChatModel === 'string'
        ? String((connectedRaw as { defaultChatModel: unknown }).defaultChatModel).trim()
        : DEFAULT_CONNECTED_ACCOUNTS_STATE.defaultChatModel,
    secrets,
    proxyProfiles,
    activeProxyProfileId,
  };

  return { envDraft, connectedAccounts };
}

export function useLocalSettings(userId: string | null | undefined) {
  const [machine, setMachine] = useState<MachineSettings>({
    fontSize: 13,
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  });
  const [user, setUser] = useState<UserSettings>({
    envDraft: {},
    connectedAccounts: DEFAULT_CONNECTED_ACCOUNTS_STATE,
  });
  const [loading, setLoading] = useState(true);

  const userKey = useMemo(
    () => `${USER_KEY_PREFIX}${userId || 'anonymous'}.settings`,
    [userId],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [machineRaw, userRaw] = await Promise.all([
        window.appShell.getSetting(MACHINE_KEY),
        window.appShell.getSetting(userKey),
      ]);

      if (!mounted) return;
      setMachine(normalizeMachine(machineRaw));
      setUser(normalizeUser(userRaw));
      setLoading(false);
    })().catch(() => {
      if (!mounted) return;
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [userKey]);

  const persistTimersRef = useRef<{ machine?: number; user?: number }>({});

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${machine.fontSize}px`);
  }, [machine.fontSize]);

  useEffect(() => {
    window.clearTimeout(persistTimersRef.current.machine);
    persistTimersRef.current.machine = window.setTimeout(() => {
      void window.appShell.setSetting(MACHINE_KEY, machine);
    }, 180);
  }, [machine]);

  useEffect(() => {
    window.clearTimeout(persistTimersRef.current.user);
    persistTimersRef.current.user = window.setTimeout(() => {
      void window.appShell.setSetting(userKey, user);
    }, 180);
  }, [user, userKey]);

  const setFontSize = useCallback((value: number) => {
    const nextSize = Math.min(16, Math.max(12, Math.round(value)));
    setMachine((previous) => ({ ...previous, fontSize: nextSize }));
  }, []);

  const setWorkspaceRoot = useCallback((value: string) => {
    const trimmed = value.trim() || DEFAULT_WORKSPACE_ROOT;
    setMachine((previous) => ({ ...previous, workspaceRoot: trimmed }));
  }, []);

  const setEnvDraft = useCallback((updater: EnvMap | ((previous: EnvMap) => EnvMap)) => {
    setUser((previous) => ({
      ...previous,
      envDraft: typeof updater === 'function' ? updater(previous.envDraft) : updater,
    }));
  }, []);

  const setConnectedAccounts = useCallback(
    (
      updater:
        | ConnectedAccountsState
        | ((previous: ConnectedAccountsState) => ConnectedAccountsState),
    ) => {
      setUser((previous) => ({
        ...previous,
        connectedAccounts:
          typeof updater === 'function' ? updater(previous.connectedAccounts) : updater,
      }));
    },
    [],
  );

  const entitlementTier: EntitlementTier = 'basic';
  const billingPlan: BillingPlanResponse | null = null;
  const projectSyncStatus: Record<string, ProjectSyncStatus> = {};

  return {
    loading,
    workspaceRoot: machine.workspaceRoot,
    fontSize: machine.fontSize,
    envDraft: user.envDraft,
    connectedAccounts: user.connectedAccounts,
    entitlementTier,
    billingPlan,
    projectSyncStatus,
    syncQueueDepth: 0,
    lastSyncError: null as string | null,
    lastSyncAt: null as string | null,
    syncDiagnostics: [] as Array<{ timestamp: string; outcome: 'ok' | 'error'; message: string }> ,
    syncFlushInFlight: false,
    setWorkspaceRoot,
    setFontSize,
    setEnvDraft,
    setConnectedAccounts,
  };
}
