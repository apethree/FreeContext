import { useLiveQuery } from '@tanstack/react-db';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';

export function useHookAgentsCollection() {
  return useSyncCollections().hookAgentsCollection;
}

export function useHookAgents() {
  const collection = useHookAgentsCollection();
  const { data = [] } = useLiveQuery((q) => q.from({ agents: collection }));
  return data;
}
