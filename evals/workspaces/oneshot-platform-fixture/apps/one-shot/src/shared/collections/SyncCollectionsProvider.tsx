import { useQueryClient } from '@tanstack/react-query';
import { type PropsWithChildren, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authProfilesQueryKey } from '@/features/settings/hooks/useAuthProfiles';
import { createChannelsCollection } from '@/shared/collections/channels';
import { createCredentialsCollection } from '@/shared/collections/credentials';
import { createHookAgentsCollection } from '@/shared/collections/hookAgents';
import { createHookRoutesCollection } from '@/shared/collections/hookRoutes';
import { useAllCredentials } from '@/shared/hooks/useCredentials';

type SyncCollectionsContextValue = {
  getAuthToken: () => Promise<string | null>;
  getCachedAuthToken: () => string;
  credentialsCollection: ReturnType<typeof createCredentialsCollection>;
  channelsCollection: ReturnType<typeof createChannelsCollection>;
  hookRoutesCollection: ReturnType<typeof createHookRoutesCollection>;
  hookAgentsCollection: ReturnType<typeof createHookAgentsCollection>;
};

const SyncCollectionsContext = createContext<SyncCollectionsContextValue | null>(null);

type SyncCollectionsProviderProps = PropsWithChildren<{
  userId: string;
  tenantId: string;
  getAuthToken: () => Promise<string | null>;
}>;

function DesktopCredentialCacheBridge() {
  const queryClient = useQueryClient();
  const { getCachedAuthToken } = useSyncCollections();
  const credentials = useAllCredentials();
  const previousByProviderRef = useRef<Map<string, number>>(new Map());
  const syncedTokenRef = useRef('');
  const isDesktopRuntime = window.appShell.getCapabilities().platform === 'desktop';

  useEffect(() => {
    if (!isDesktopRuntime) {
      previousByProviderRef.current = new Map();
      syncedTokenRef.current = '';
      return;
    }

    const clerkToken = getCachedAuthToken().trim();
    if (!clerkToken) {
      return;
    }

    if (syncedTokenRef.current !== clerkToken) {
      syncedTokenRef.current = clerkToken;
      void window.appShell.pipelinePushClerkToken({ token: clerkToken }).catch(() => {
        // Best-effort sync for main-process secret fetches.
      });
    }

    const nextByProvider = new Map<string, number>();
    const refreshes: Promise<unknown>[] = [];
    const deletedProviders = new Set(previousByProviderRef.current.keys());

    for (const credential of credentials) {
      deletedProviders.delete(credential.provider);
      const updatedAtMs = credential.updated_at_ms != null ? Number(credential.updated_at_ms) : Date.now();
      nextByProvider.set(credential.provider, updatedAtMs);

      // Ignore optimistic credential writes carrying local-only secret fields.
      if (typeof credential.token === 'string' && credential.token.trim()) {
        continue;
      }

      const previousUpdatedAtMs = previousByProviderRef.current.get(credential.provider);
      if (previousUpdatedAtMs === updatedAtMs) {
        continue;
      }

      refreshes.push(
        window.appShell.pipelineRefreshLocalCredentialCache({ provider: credential.provider })
          .finally(() => queryClient.invalidateQueries({ queryKey: authProfilesQueryKey })),
      );
    }

    for (const provider of deletedProviders) {
      refreshes.push(
        window.appShell.pipelineRemoveLocalCredentialCache({ provider })
          .finally(() => queryClient.invalidateQueries({ queryKey: authProfilesQueryKey })),
      );
    }

    previousByProviderRef.current = nextByProvider;
    void Promise.allSettled(refreshes);
  }, [credentials, getCachedAuthToken, isDesktopRuntime, queryClient]);

  return null;
}

export function SyncCollectionsProvider({
  children,
  userId,
  tenantId,
  getAuthToken,
}: SyncCollectionsProviderProps) {
  const tokenRef = useRef('');
  const [ready, setReady] = useState(false);
  const identityKey = `${tenantId}:${userId}`;
  const [mainReady, setMainReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refreshToken = async () => {
      try {
        const token = (await getAuthToken())?.trim() ?? '';
        if (cancelled) return;
        tokenRef.current = token;
        setReady(Boolean(token));
      } catch {
        if (cancelled) return;
        tokenRef.current = '';
        setReady(false);
      }
    };

    void refreshToken();
    const intervalId = window.setInterval(() => {
      void refreshToken();
    }, 50_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getAuthToken, identityKey]);

  useEffect(() => {
    let cancelled = false;

    const initializeMainIdentity = async () => {
      const token = tokenRef.current.trim();
      if (!token) {
        if (!cancelled) {
          setMainReady(false);
        }
        return;
      }

      try {
        await window.appShell.pipelineSetActiveUser({
          userId,
          tenantId,
          clerkToken: token,
        });
        if (!cancelled) {
          setMainReady(true);
        }
      } catch {
        if (!cancelled) {
          setMainReady(false);
        }
      }
    };

    void initializeMainIdentity();

    return () => {
      cancelled = true;
    };
  }, [identityKey, ready, tenantId, userId]);

  const collections = useMemo(() => {
    if (!ready || !mainReady) return null;

    return {
      credentialsCollection: createCredentialsCollection(`credentials:${identityKey}`, () => tokenRef.current),
      channelsCollection: createChannelsCollection(`channels:${identityKey}`, () => tokenRef.current),
      hookRoutesCollection: createHookRoutesCollection(`hook-routes:${identityKey}`, () => tokenRef.current),
      hookAgentsCollection: createHookAgentsCollection(`hook-agents:${identityKey}`, () => tokenRef.current),
    };
  }, [identityKey, mainReady, ready]);

  useEffect(() => {
    if (!collections) return;

    collections.credentialsCollection.preload();
    collections.channelsCollection.preload();
    collections.hookRoutesCollection.preload();
    collections.hookAgentsCollection.preload();
  }, [collections]);

  const value = useMemo<SyncCollectionsContextValue | null>(() => {
    if (!collections) return null;

    return {
      getAuthToken,
      getCachedAuthToken: () => tokenRef.current,
      ...collections,
    };
  }, [collections, getAuthToken]);

  if (!value) {
    return null;
  }

  return (
    <SyncCollectionsContext.Provider value={value}>
      <DesktopCredentialCacheBridge />
      {children}
    </SyncCollectionsContext.Provider>
  );
}

export function useSyncCollections() {
  const context = useContext(SyncCollectionsContext);
  if (!context) {
    throw new Error('SyncCollectionsProvider is required');
  }
  return context;
}
