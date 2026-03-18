export type GatewayTokenKind = "oauth" | "api-key";

export type GatewayTokenSyncRequestMeta = {
  opId?: string;
  source?: string;
};

export type GatewayTokenSyncPayload = {
  provider: string;
  token: string;
  tokenKind: GatewayTokenKind;
  email?: string;
  piProviderId?: string;
  oauthProviderId?: string;
  refreshToken?: string;
  expiresAtMs?: number;
  accountId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
} & GatewayTokenSyncRequestMeta;

export type GatewayTokenSyncPullRequest = {
  provider: string;
} & GatewayTokenSyncRequestMeta;

export type GatewayTokenSyncDeleteRequest = {
  provider: string;
} & GatewayTokenSyncRequestMeta;

export type GatewayProviderProbeRequest = {
  provider: string;
  model?: string;
} & GatewayTokenSyncRequestMeta;

export type GatewayTokenSyncPushResult = {
  pushed: boolean;
  reason?: string;
  opId?: string;
  verified?: boolean;
  hasToken?: boolean;
  tokenKind?: GatewayTokenKind | null;
  fingerprint?: string | null;
  updatedAtMs?: number | null;
};

export type GatewayTokenSyncPullResult = {
  ok: boolean;
  reason?: string;
  opId?: string;
  provider?: string;
  hasToken: boolean;
  token: string | null;
  email?: string | null;
  piProviderId?: string | null;
  oauthProviderId?: string | null;
  refreshToken?: string | null;
  expiresAtMs?: number | null;
  accountId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
  updatedAtMs?: number | null;
  tokenKind?: GatewayTokenKind | null;
  fingerprint?: string | null;
};

export type GatewayTokenSyncDeleteResult = {
  deleted: boolean;
  reason?: string;
  opId?: string;
  provider?: string;
  verified?: boolean;
  hasToken?: boolean;
  updatedAtMs?: number | null;
};

export type GatewayProviderProbeResult = {
  ok: boolean;
  capable: boolean;
  reason?: string;
  errorCode?: string | null;
  opId?: string;
  provider?: string;
  model?: string;
  latencyMs?: number | null;
};

const CLOUD_PROVIDER_ALIASES: Record<string, string> = {
  "openai-codex": "openai",
  claude: "anthropic",
  "gemini-cli": "gemini",
  "google-gemini-cli": "gemini",
};

export function normalizeCloudProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return "";
  return CLOUD_PROVIDER_ALIASES[normalized] ?? normalized;
}

export function normalizeOAuthProviderId(provider: string): string | null {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "openai" || normalized === "openai-codex") return "openai-codex";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "gemini" || normalized === "gemini-cli" || normalized === "google-gemini-cli") {
    return "google-gemini-cli";
  }
  return null;
}

export function normalizePiProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "claude") return "anthropic";
  if (normalized === "openai-codex") return "openai";
  if (normalized === "gemini" || normalized === "gemini-cli" || normalized === "google-gemini-cli") {
    return "google";
  }
  if (normalized === "moonshot") return "kimi-coding";
  return normalized;
}

export function createTokenSyncOpId(prefix = "toksync"): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof globalCrypto?.randomUUID === "function") {
    return `${prefix}-${globalCrypto.randomUUID()}`;
  }
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomSuffix}`;
}

export function buildApiKeyTokenSyncPayload(
  provider: string,
  token: string,
  meta?: GatewayTokenSyncRequestMeta,
): GatewayTokenSyncPayload {
  const normalizedProvider = normalizeCloudProvider(provider);
  return {
    provider: normalizedProvider,
    token: token.trim(),
    tokenKind: "api-key",
    ...(meta?.opId ? { opId: meta.opId } : {}),
    ...(meta?.source ? { source: meta.source } : {}),
  };
}
