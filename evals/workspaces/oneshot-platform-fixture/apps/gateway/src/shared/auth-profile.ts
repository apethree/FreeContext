import type { TokenRecord } from "./types.js";

export type TokenAuthProfile = {
  type: "token";
  provider: string;
  token: string;
};

export type OAuthAuthProfile = {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  piProviderId?: string;
  oauthProviderId?: string;
  accountId?: string;
  projectId?: string;
  [key: string]: unknown;
};

export type LocalAuthProfile = TokenAuthProfile | OAuthAuthProfile;

function asPlainObject(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

export function buildLocalAuthProfile(record: TokenRecord): LocalAuthProfile {
  const provider = record.provider.trim().toLowerCase();

  if (record.tokenKind === "api-key") {
    return {
      type: "token",
      provider,
      token: record.token,
    };
  }

  return {
    ...asPlainObject(record.metadata),
    type: "oauth",
    provider,
    access: record.token,
    refresh: record.refreshToken ?? "",
    expires: typeof record.expiresAtMs === "number" ? record.expiresAtMs : 0,
    ...(record.email ? { email: record.email } : {}),
    ...(record.piProviderId ? { piProviderId: record.piProviderId } : {}),
    ...(record.oauthProviderId ? { oauthProviderId: record.oauthProviderId } : {}),
    ...(record.accountId ? { accountId: record.accountId } : {}),
    ...(record.projectId ? { projectId: record.projectId } : {}),
  };
}
