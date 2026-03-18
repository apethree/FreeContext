import { useLiveQuery } from '@tanstack/react-db';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';

export function useChannelsCollection() {
  return useSyncCollections().channelsCollection;
}

export function useChannels() {
  const collection = useChannelsCollection();
  const { data = [] } = useLiveQuery((q) => q.from({ channels: collection }));
  return data;
}
