import { type Collection, createCollection } from '@tanstack/react-db';
import { type ElectricCollectionUtils, electricCollectionOptions } from '@tanstack/electric-db-collection';
import type { GatewayTokenSyncPayload } from '@/gateway/tokenSyncTypes';
import { syncFetchJson, SYNC_BASE_URL } from '@/shared/collections/config';

export type CredentialCollectionItem = {
  tenant_id: string;
  user_id: string;
  provider: string;
  token_kind: 'oauth' | 'api-key';
  email?: string | null;
  pi_provider_id?: string | null;
  oauth_provider_id?: string | null;
  expires_at_ms?: number | null;
  account_id?: string | null;
  project_id?: string | null;
  metadata_json?: Record<string, unknown> | null;
  updated_at_ms?: number | null;
  token?: string;
  refresh_token?: string;
};

export type CredentialsCollection = Collection<
  CredentialCollectionItem,
  string,
  ElectricCollectionUtils<CredentialCollectionItem>,
  never,
  CredentialCollectionItem
>;

function toPushPayload(item: CredentialCollectionItem): GatewayTokenSyncPayload {
  const token = item.token?.trim() ?? '';
  if (!token) {
    throw new Error(`missing token for provider ${item.provider}`);
  }

  return {
    provider: item.provider,
    token,
    tokenKind: item.token_kind,
    ...(item.email ? { email: item.email } : {}),
    ...(item.pi_provider_id ? { piProviderId: item.pi_provider_id } : {}),
    ...(item.oauth_provider_id ? { oauthProviderId: item.oauth_provider_id } : {}),
    ...(item.refresh_token ? { refreshToken: item.refresh_token } : {}),
    ...(item.expires_at_ms != null ? { expiresAtMs: Number(item.expires_at_ms) } : {}),
    ...(item.account_id ? { accountId: item.account_id } : {}),
    ...(item.project_id ? { projectId: item.project_id } : {}),
    ...(item.metadata_json ? { metadata: item.metadata_json } : {}),
  };
}

export function createCredentialsCollection(collectionId: string, getToken: () => string): CredentialsCollection {
  return createCollection(
    electricCollectionOptions<CredentialCollectionItem>({
      id: collectionId,
      shapeOptions: {
        url: `${SYNC_BASE_URL}/sync/shapes/credentials`,
        headers: {
          authorization: () => {
            const token = getToken().trim();
            return token ? `Bearer ${token}` : '';
          },
        },
      },
      getKey: (item) => item.provider,
      onInsert: async ({ transaction }) => {
        const credential = transaction.mutations[0]?.modified;
        if (!credential) return;
        await syncFetchJson('/api/credentials/push', getToken, {
          method: 'POST',
          body: JSON.stringify(toPushPayload(credential)),
        });
      },
      onUpdate: async ({ transaction }) => {
        const credential = transaction.mutations[0]?.modified;
        if (!credential) return;
        await syncFetchJson('/api/credentials/push', getToken, {
          method: 'POST',
          body: JSON.stringify(toPushPayload(credential)),
        });
      },
      onDelete: async ({ transaction }) => {
        const credential = transaction.mutations[0]?.original;
        if (!credential) return;
        await syncFetchJson(`/api/credentials/${encodeURIComponent(credential.provider)}`, getToken, {
          method: 'DELETE',
        });
      },
    }),
  ) as unknown as CredentialsCollection;
}
