import { fetchSyncJson } from '@/shared/collections/http';
import type { SyncTokenGetter } from '@/shared/collections/config';
import type { CloudProviderProbeResponse, LocalProviderReadyResult } from '@/shared/collections/types';

export type ProviderPreflightResult = {
  ready: boolean;
  local: boolean;
  cloud: boolean;
  reason?: string;
  blockedBy: 'not-connected' | 'no-token' | 'no-cloud-token';
};

async function probeCloudProvider(
  getToken: SyncTokenGetter,
  provider: string,
  options?: { model?: string; capabilityProbe?: boolean },
) {
  const params = new URLSearchParams();
  if (options?.model?.trim()) {
    params.set('model', options.model.trim());
  }
  if (options?.capabilityProbe) {
    params.set('capabilityProbe', 'true');
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return await fetchSyncJson<CloudProviderProbeResponse>(
    getToken,
    `/api/credentials/${encodeURIComponent(provider)}/probe${suffix}`,
  );
}

async function probeLocalProvider(
  provider: string,
  options?: { model?: string; capabilityProbe?: boolean },
) {
  return await window.appShell.pipelineCheckLocalProviderReady({
    provider,
    ...(options?.capabilityProbe ? { capabilityProbe: true } : {}),
    ...(options?.model?.trim() ? { model: options.model.trim() } : {}),
  }) as LocalProviderReadyResult;
}

export async function ensureProviderPreflight(
  getToken: SyncTokenGetter,
  payload: {
    provider: string;
    runtime: 'local' | 'cloud' | 'auto';
    capabilityProbe?: boolean;
    model?: string;
    localRuntimeAvailable: boolean;
  },
): Promise<ProviderPreflightResult> {
  const provider = payload.provider.trim();
  const options = {
    capabilityProbe: payload.capabilityProbe === true,
    ...(payload.model?.trim() ? { model: payload.model.trim() } : {}),
  };

  if (payload.runtime === 'local') {
    const local = payload.localRuntimeAvailable
      ? await probeLocalProvider(provider, options)
      : { ready: false, local: false, reason: 'local runtime is not available' };
    return {
      ready: Boolean(local.ready),
      local: Boolean(local.ready),
      cloud: false,
      reason: local.reason,
      blockedBy: local.reason?.toLowerCase().includes('runtime') ? 'not-connected' : 'no-token',
    };
  }

  if (payload.runtime === 'cloud') {
    try {
      const cloud = await probeCloudProvider(getToken, provider, options);
      return {
        ready: Boolean(cloud.ready),
        local: false,
        cloud: Boolean(cloud.ready),
        reason: cloud.reason,
        blockedBy: cloud.reason?.toLowerCase().includes('connect') ? 'not-connected' : 'no-token',
      };
    } catch (error) {
      return {
        ready: false,
        local: false,
        cloud: false,
        reason: error instanceof Error ? error.message : String(error),
        blockedBy: 'not-connected',
      };
    }
  }

  const [local, cloud] = await Promise.all([
    payload.localRuntimeAvailable
      ? probeLocalProvider(provider, options)
      : Promise.resolve({ ready: false, local: false, reason: 'local runtime is not available' } as LocalProviderReadyResult),
    probeCloudProvider(getToken, provider, options).catch((error) => ({
      ok: false,
      ready: false,
      reason: error instanceof Error ? error.message : String(error),
    } as CloudProviderProbeResponse)),
  ]);

  if (local.ready) {
    return {
      ready: true,
      local: true,
      cloud: Boolean(cloud.ready),
      blockedBy: 'no-token',
    };
  }

  if (cloud.ready) {
    return {
      ready: true,
      local: false,
      cloud: true,
      blockedBy: 'no-token',
    };
  }

  const reason = cloud.reason || local.reason || 'provider not ready';
  const blockedBy = reason.toLowerCase().includes('connect') || reason.toLowerCase().includes('runtime')
    ? 'not-connected'
    : (local.local ? 'no-cloud-token' : 'no-token');

  return {
    ready: false,
    local: false,
    cloud: false,
    reason,
    blockedBy,
  };
}
