import { type Collection, createCollection } from '@tanstack/react-db';
import { type ElectricCollectionUtils, electricCollectionOptions } from '@tanstack/electric-db-collection';
import { syncFetchJson, SYNC_BASE_URL } from '@/shared/collections/config';

export type HookAgentCollectionItem = {
  tenant_id: string;
  agent_id: string;
  enabled: boolean;
  config_json?: Record<string, unknown> | null;
  created_at_ms?: number | null;
  updated_at_ms?: number | null;
};

export type HookAgentsCollection = Collection<
  HookAgentCollectionItem,
  string,
  ElectricCollectionUtils<HookAgentCollectionItem>,
  never,
  HookAgentCollectionItem
>;

function toHookAgentPayload(item: HookAgentCollectionItem) {
  return {
    agentId: item.agent_id,
    enabled: item.enabled,
    config: item.config_json ?? {},
  };
}

export function createHookAgentsCollection(collectionId: string, getToken: () => string): HookAgentsCollection {
  return createCollection(
    electricCollectionOptions<HookAgentCollectionItem>({
      id: collectionId,
      shapeOptions: {
        url: `${SYNC_BASE_URL}/sync/shapes/hook-agents`,
        headers: {
          authorization: () => {
            const token = getToken().trim();
            return token ? `Bearer ${token}` : '';
          },
        },
      },
      getKey: (item) => item.agent_id,
      onInsert: async ({ transaction }) => {
        const agent = transaction.mutations[0]?.modified;
        if (!agent) return;
        await syncFetchJson('/api/hooks/agents', getToken, {
          method: 'POST',
          body: JSON.stringify(toHookAgentPayload(agent)),
        });
      },
      onUpdate: async ({ transaction }) => {
        const agent = transaction.mutations[0]?.modified;
        if (!agent) return;
        await syncFetchJson('/api/hooks/agents', getToken, {
          method: 'POST',
          body: JSON.stringify(toHookAgentPayload(agent)),
        });
      },
      onDelete: async ({ transaction }) => {
        const agent = transaction.mutations[0]?.original;
        if (!agent) return;
        await syncFetchJson(`/api/hooks/agents/${encodeURIComponent(agent.agent_id)}`, getToken, {
          method: 'DELETE',
        });
      },
    }),
  ) as unknown as HookAgentsCollection;
}
