import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { redisKeys } from "./redis-keys.js";

export async function reserveFastIdempotency(
  redis: Redis,
  tenantId: string,
  key: string,
  ttlSeconds = 3600,
): Promise<boolean> {
  const result = await redis.set(redisKeys.fastIdempotency(tenantId, key), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function reserveDurableIdempotency(
  pg: Pool,
  tenantId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const result = await pg.query(
    `INSERT INTO message_idempotency (tenant_id, session_id, idempotency_key, created_at_ms)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, session_id, idempotency_key) DO NOTHING`,
    [tenantId, sessionId, idempotencyKey, Date.now()],
  );
  return (result.rowCount ?? 0) > 0;
}
