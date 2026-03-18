import type { Redis } from "ioredis";
import type { Pool } from "pg";
import type { TokenKind, TokenRecord } from "./types.js";
import { decryptTenantSecret, encryptTenantSecret, fingerprintToken } from "./token-crypto.js";
import { redisKeys } from "./redis-keys.js";

type TokenRow = {
  tenant_id: string;
  user_id: string;
  provider: string;
  token_kind: TokenKind;
  token_enc: string;
  refresh_token_enc: string | null;
  email: string | null;
  pi_provider_id: string | null;
  oauth_provider_id: string | null;
  expires_at_ms: number | null;
  account_id: string | null;
  project_id: string | null;
  metadata_json: unknown;
  updated_at_ms: number;
};

function normalizeProvider(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === "openai-codex") return "openai";
  if (p === "claude") return "anthropic";
  if (p === "gemini-cli" || p === "google-gemini-cli") return "gemini";
  return p;
}

function fromRow(row: TokenRow, masterKeyBase64: string): TokenRecord {
  const token = decryptTenantSecret(masterKeyBase64, row.tenant_id, row.token_enc);
  const refreshToken = row.refresh_token_enc
    ? decryptTenantSecret(masterKeyBase64, row.tenant_id, row.refresh_token_enc)
    : undefined;

  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    provider: row.provider,
    token,
    tokenKind: row.token_kind,
    updatedAtMs: row.updated_at_ms,
    ...(row.email ? { email: row.email } : {}),
    ...(row.pi_provider_id ? { piProviderId: row.pi_provider_id } : {}),
    ...(row.oauth_provider_id ? { oauthProviderId: row.oauth_provider_id } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof row.expires_at_ms === "number" ? { expiresAtMs: row.expires_at_ms } : {}),
    ...(row.account_id ? { accountId: row.account_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.metadata_json && typeof row.metadata_json === "object" ? { metadata: row.metadata_json as Record<string, unknown> } : {}),
  };
}

export class TokenVault {
  constructor(
    private readonly pg: Pool,
    private readonly redis: Redis,
    private readonly masterKeyBase64: string,
  ) {}

  private cacheKey(tenantId: string, userId: string, provider: string): string {
    return redisKeys.tokenCache(tenantId, userId, normalizeProvider(provider));
  }

  private validateRecord(record: TokenRecord): void {
    if (record.tokenKind !== "oauth" && record.tokenKind !== "api-key") {
      throw new Error("tokenKind must be oauth or api-key");
    }
    if (record.tokenKind === "oauth" && (!record.oauthProviderId || record.oauthProviderId.trim().length === 0)) {
      throw new Error("oauth tokens require oauthProviderId");
    }
    if (record.oauthProviderId === "google-gemini-cli" && (!record.projectId || record.projectId.trim().length === 0)) {
      throw new Error("google-gemini-cli oauth tokens require projectId");
    }
  }

  async put(record: TokenRecord): Promise<{ verified: boolean; fingerprint: string; updatedAtMs: number; reason?: string }> {
    this.validateRecord(record);

    const tenantId = record.tenantId;
    const userId = record.userId;
    const provider = normalizeProvider(record.provider);
    const now = Date.now();

    const tokenEnc = encryptTenantSecret(this.masterKeyBase64, tenantId, record.token);
    const refreshEnc = record.refreshToken
      ? encryptTenantSecret(this.masterKeyBase64, tenantId, record.refreshToken)
      : null;

    await this.pg.query(
      `INSERT INTO token_records (
         tenant_id, user_id, provider, token_kind, token_enc, refresh_token_enc,
         email, pi_provider_id, oauth_provider_id, expires_at_ms, account_id, project_id,
         metadata_json, updated_at_ms
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14
       )
       ON CONFLICT (tenant_id, user_id, provider)
       DO UPDATE SET
         token_kind = EXCLUDED.token_kind,
         token_enc = EXCLUDED.token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         email = EXCLUDED.email,
         pi_provider_id = EXCLUDED.pi_provider_id,
         oauth_provider_id = EXCLUDED.oauth_provider_id,
         expires_at_ms = EXCLUDED.expires_at_ms,
         account_id = EXCLUDED.account_id,
         project_id = EXCLUDED.project_id,
         metadata_json = EXCLUDED.metadata_json,
         updated_at_ms = EXCLUDED.updated_at_ms`,
      [
        tenantId,
        userId,
        provider,
        record.tokenKind,
        tokenEnc,
        refreshEnc,
        record.email ?? null,
        record.piProviderId ?? null,
        record.oauthProviderId ?? null,
        record.expiresAtMs ?? null,
        record.accountId ?? null,
        record.projectId ?? null,
        JSON.stringify(record.metadata ?? {}),
        now,
      ],
    );

    const cacheKey = this.cacheKey(tenantId, userId, provider);
    await this.redis.set(cacheKey, JSON.stringify({
      ...record,
      provider,
      updatedAtMs: now,
    }), "EX", 300);

    const persisted = await this.get(tenantId, userId, provider);
    const expectedFingerprint = fingerprintToken(record.token);
    const persistedFingerprint = persisted ? fingerprintToken(persisted.token) : "";

    const verified = Boolean(
      persisted &&
      persisted.tokenKind === record.tokenKind &&
      persistedFingerprint === expectedFingerprint,
    );

    return {
      verified,
      fingerprint: persistedFingerprint || expectedFingerprint,
      updatedAtMs: persisted?.updatedAtMs ?? now,
      ...(verified ? {} : { reason: "persisted state mismatch after write" }),
    };
  }

  async get(tenantId: string, userId: string, provider: string): Promise<TokenRecord | null> {
    const normalizedProvider = normalizeProvider(provider);
    const cacheKey = this.cacheKey(tenantId, userId, normalizedProvider);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as TokenRecord;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const result = await this.pg.query<TokenRow>(
      `SELECT tenant_id, user_id, provider, token_kind, token_enc, refresh_token_enc,
              email, pi_provider_id, oauth_provider_id, expires_at_ms, account_id, project_id,
              metadata_json, updated_at_ms
       FROM token_records
       WHERE tenant_id = $1 AND user_id = $2 AND provider = $3
       LIMIT 1`,
      [tenantId, userId, normalizedProvider],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const record = fromRow(row, this.masterKeyBase64);
    await this.redis.set(cacheKey, JSON.stringify(record), "EX", 300);
    return record;
  }

  async delete(tenantId: string, userId: string, provider: string): Promise<{ verified: boolean; updatedAtMs: number; reason?: string }> {
    const normalizedProvider = normalizeProvider(provider);

    await this.pg.query(
      `DELETE FROM token_records WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`,
      [tenantId, userId, normalizedProvider],
    );

    await this.redis.del(this.cacheKey(tenantId, userId, normalizedProvider));

    const check = await this.get(tenantId, userId, normalizedProvider);
    const verified = check === null;
    const updatedAtMs = Date.now();

    return {
      verified,
      updatedAtMs,
      ...(verified ? {} : { reason: "token still present after delete" }),
    };
  }
}
