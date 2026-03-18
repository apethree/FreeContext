import type { GatewayTokenKind, GatewayTokenSyncPayload } from '@/gateway/tokenSyncTypes';
import type { HookAgentRecord, HookRouteRecord } from '@/gateway/hookOpsTypes';

export type SyncedCredentialRecord = GatewayTokenSyncPayload & {
  tenantId: string;
  userId: string;
  updatedAtMs: number;
  metadataJson?: Record<string, unknown> | null;
  token?: string;
  refreshToken?: string;
};

export type SyncedChannelRecord = {
  tenantId: string;
  id: string;
  type: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: number;
};

export type SyncedHookRouteRecord = HookRouteRecord;

export type SyncedHookAgentRecord = HookAgentRecord;

export type CloudProviderProbeResponse = {
  ok: boolean;
  ready: boolean;
  capable?: boolean;
  reason?: string;
  provider?: string;
  model?: string | null;
  latencyMs?: number | null;
  checkedAtMs?: number | null;
};

export type LocalAuthProfilePayload =
  | {
      type: 'token';
      provider: string;
      token: string;
    }
  | {
      type: 'oauth';
      provider: string;
      access: string;
      refresh: string;
      expires: number;
      email?: string;
      [key: string]: unknown;
    };

export type LocalProviderReadyResult = {
  ready: boolean;
  reason?: string;
  local: boolean;
  capabilityChecked?: boolean;
};

export function normalizeCredentialRecord(
  record: SyncedCredentialRecord,
): GatewayTokenSyncPayload {
  return {
    provider: record.provider,
    token: record.token ?? '',
    tokenKind: record.tokenKind as GatewayTokenKind,
    ...(record.email ? { email: record.email } : {}),
    ...(record.piProviderId ? { piProviderId: record.piProviderId } : {}),
    ...(record.oauthProviderId ? { oauthProviderId: record.oauthProviderId } : {}),
    ...(record.refreshToken ? { refreshToken: record.refreshToken } : {}),
    ...(typeof record.expiresAtMs === 'number' ? { expiresAtMs: record.expiresAtMs } : {}),
    ...(record.accountId ? { accountId: record.accountId } : {}),
    ...(record.projectId ? { projectId: record.projectId } : {}),
    ...(record.metadataJson && typeof record.metadataJson === 'object' ? { metadata: record.metadataJson } : {}),
  };
}
