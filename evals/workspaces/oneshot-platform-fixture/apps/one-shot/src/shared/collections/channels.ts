import { type Collection, createCollection } from '@tanstack/react-db';
import { type ElectricCollectionUtils, electricCollectionOptions } from '@tanstack/electric-db-collection';
import { syncFetchJson, SYNC_BASE_URL } from '@/shared/collections/config';

export type ChannelCollectionItem = {
  tenant_id: string;
  id: string;
  type: string;
  config?: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: number | null;
};

export type ChannelsCollection = Collection<
  ChannelCollectionItem,
  string,
  ElectricCollectionUtils<ChannelCollectionItem>,
  never,
  ChannelCollectionItem
>;

function toChannelPayload(item: ChannelCollectionItem) {
  return {
    channelId: item.id,
    type: item.type,
    config: item.config ?? {},
    isActive: item.is_active,
  };
}

export function createChannelsCollection(collectionId: string, getToken: () => string): ChannelsCollection {
  return createCollection(
    electricCollectionOptions<ChannelCollectionItem>({
      id: collectionId,
      shapeOptions: {
        url: `${SYNC_BASE_URL}/sync/shapes/channels`,
        headers: {
          authorization: () => {
            const token = getToken().trim();
            return token ? `Bearer ${token}` : '';
          },
        },
      },
      getKey: (item) => item.id,
      onInsert: async ({ transaction }) => {
        const channel = transaction.mutations[0]?.modified;
        if (!channel) return;
        await syncFetchJson('/api/channels', getToken, {
          method: 'POST',
          body: JSON.stringify(toChannelPayload(channel)),
        });
      },
      onUpdate: async ({ transaction }) => {
        const channel = transaction.mutations[0]?.modified;
        if (!channel) return;
        await syncFetchJson('/api/channels', getToken, {
          method: 'POST',
          body: JSON.stringify(toChannelPayload(channel)),
        });
      },
      onDelete: async ({ transaction }) => {
        const channel = transaction.mutations[0]?.original;
        if (!channel) return;
        await syncFetchJson(`/api/channels/${encodeURIComponent(channel.id)}`, getToken, {
          method: 'DELETE',
        });
      },
    }),
  ) as unknown as ChannelsCollection;
}
