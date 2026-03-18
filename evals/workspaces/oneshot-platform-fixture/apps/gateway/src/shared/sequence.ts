import type { Redis } from "ioredis";
import { redisKeys } from "./redis-keys.js";

export async function nextSessionSeq(redis: Redis, tenantId: string, sessionId: string): Promise<number> {
  return await redis.incr(redisKeys.sessionSeq(tenantId, sessionId));
}

export async function nextEventSeq(redis: Redis, tenantId: string): Promise<number> {
  return await redis.incr(redisKeys.eventSeq(tenantId));
}
