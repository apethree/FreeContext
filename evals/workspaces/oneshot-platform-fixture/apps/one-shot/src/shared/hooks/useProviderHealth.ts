import { useQuery } from '@tanstack/react-query';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';
import { fetchSyncJson } from '@/shared/collections/http';
import type { CloudProviderProbeResponse } from '@/shared/collections/types';
import { useCredential } from '@/shared/hooks/useCredentials';

export type ProviderHealth = {
  hasCredential: boolean;
  tokenKind: 'oauth' | 'api-key' | null;
  email: string | null;
  readiness: 'unknown' | 'checking' | 'ready' | 'blocked' | 'error';
  readinessReason: string;
  local: boolean;
  cloud: boolean;
  healed: boolean;
  checkedAtMs: number | null;
};

const DEFAULT_PROVIDER_HEALTH: ProviderHealth = {
  hasCredential: false,
  tokenKind: null,
  email: null,
  readiness: 'unknown',
  readinessReason: '',
  local: false,
  cloud: false,
  healed: false,
  checkedAtMs: null,
};

export function useProviderHealth(provider: string): ProviderHealth {
  const credential = useCredential(provider);
  const { getAuthToken } = useSyncCollections();
  const normalizedProvider = provider.trim().toLowerCase();

  const readinessQuery = useQuery({
    queryKey: ['one-shot', 'provider-health', normalizedProvider, Number(credential?.updated_at_ms ?? 0)],
    enabled: Boolean(credential),
    queryFn: async () => await fetchSyncJson<CloudProviderProbeResponse>(
      getAuthToken,
      `/api/credentials/${encodeURIComponent(normalizedProvider)}/probe`,
    ),
    staleTime: 5_000,
    retry: false,
  });

  if (!credential) {
    return DEFAULT_PROVIDER_HEALTH;
  }

  if (readinessQuery.isLoading) {
    return {
      hasCredential: true,
      tokenKind: credential.token_kind ?? null,
      email: credential.email ?? null,
      readiness: 'checking',
      readinessReason: '',
      local: false,
      cloud: false,
      healed: false,
      checkedAtMs: null,
    };
  }

  if (readinessQuery.isError) {
    return {
      hasCredential: true,
      tokenKind: credential.token_kind ?? null,
      email: credential.email ?? null,
      readiness: 'error',
      readinessReason: readinessQuery.error instanceof Error ? readinessQuery.error.message : String(readinessQuery.error),
      local: false,
      cloud: false,
      healed: false,
      checkedAtMs: Date.now(),
    };
  }

  const readiness = readinessQuery.data;
  return {
    hasCredential: true,
    tokenKind: credential.token_kind ?? null,
    email: credential.email ?? null,
    readiness: readiness?.ready ? 'ready' : 'blocked',
    readinessReason: readiness?.reason ?? '',
    local: false,
    cloud: Boolean(readiness?.ready),
    healed: false,
    checkedAtMs: typeof readiness?.checkedAtMs === 'number' ? readiness.checkedAtMs : Date.now(),
  };
}
