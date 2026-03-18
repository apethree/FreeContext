import { useLiveQuery } from '@tanstack/react-db';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';

export function useHookRoutesCollection() {
  return useSyncCollections().hookRoutesCollection;
}

export function useHookRoutes() {
  const collection = useHookRoutesCollection();
  const { data = [] } = useLiveQuery((q) => q.from({ routes: collection }));
  return data;
}
