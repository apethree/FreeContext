import { type Collection, createCollection } from '@tanstack/react-db';
import { type ElectricCollectionUtils, electricCollectionOptions } from '@tanstack/electric-db-collection';
import type { HookRouteAction } from '@/gateway/hookOpsTypes';
import { syncFetchJson, SYNC_BASE_URL } from '@/shared/collections/config';

export type HookRouteCollectionItem = {
  tenant_id: string;
  name: string;
  action: HookRouteAction;
  enabled: boolean;
  token_hash?: string | null;
  config_json?: Record<string, unknown> | null;
  created_at_ms?: number | null;
  updated_at_ms?: number | null;
  token?: string;
};

export type HookRoutesCollection = Collection<
  HookRouteCollectionItem,
  string,
  ElectricCollectionUtils<HookRouteCollectionItem>,
  never,
  HookRouteCollectionItem
>;

function toHookRoutePayload(item: HookRouteCollectionItem) {
  return {
    name: item.name,
    action: item.action,
    enabled: item.enabled,
    ...(item.token?.trim() ? { token: item.token.trim() } : {}),
    ...(!item.token?.trim() && item.token_hash ? { tokenHash: item.token_hash } : {}),
    config: item.config_json ?? {},
  };
}

export function createHookRoutesCollection(collectionId: string, getToken: () => string): HookRoutesCollection {
  return createCollection(
    electricCollectionOptions<HookRouteCollectionItem>({
      id: collectionId,
      shapeOptions: {
        url: `${SYNC_BASE_URL}/sync/shapes/hook-routes`,
        headers: {
          authorization: () => {
            const token = getToken().trim();
            return token ? `Bearer ${token}` : '';
          },
        },
      },
      getKey: (item) => item.name,
      onInsert: async ({ transaction }) => {
        const route = transaction.mutations[0]?.modified;
        if (!route) return;
        await syncFetchJson('/api/hooks/routes', getToken, {
          method: 'POST',
          body: JSON.stringify(toHookRoutePayload(route)),
        });
      },
      onUpdate: async ({ transaction }) => {
        const route = transaction.mutations[0]?.modified;
        if (!route) return;
        await syncFetchJson('/api/hooks/routes', getToken, {
          method: 'POST',
          body: JSON.stringify(toHookRoutePayload(route)),
        });
      },
      onDelete: async ({ transaction }) => {
        const route = transaction.mutations[0]?.original;
        if (!route) return;
        await syncFetchJson(`/api/hooks/routes/${encodeURIComponent(route.name)}`, getToken, {
          method: 'DELETE',
        });
      },
    }),
  ) as unknown as HookRoutesCollection;
}
