import { eq } from '@tanstack/db';
import { useLiveQuery } from '@tanstack/react-db';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';

export function useCredentialsCollection() {
  return useSyncCollections().credentialsCollection;
}

export function useAllCredentials() {
  const collection = useCredentialsCollection();
  const { data = [] } = useLiveQuery((q) => q.from({ credentials: collection }));
  return data;
}

export function useCredential(provider: string) {
  const collection = useCredentialsCollection();
  const normalizedProvider = provider.trim().toLowerCase();
  const { data } = useLiveQuery(
    (q) => q
      .from({ credentials: collection })
      .where(({ credentials }) => eq(credentials.provider, normalizedProvider))
      .findOne(),
    [collection, normalizedProvider],
  );
  return data;
}
