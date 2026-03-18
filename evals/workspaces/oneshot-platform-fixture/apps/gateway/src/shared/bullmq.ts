import type { RedisOptions } from "ioredis";

export function parseRedisUrlToBullmqOptions(rawUrl: string): RedisOptions {
  const parsed = new URL(rawUrl);
  const port = parsed.port ? Number(parsed.port) : 6379;
  const db = parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;

  return {
    host: parsed.hostname,
    port: Number.isFinite(port) ? port : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
