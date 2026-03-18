import { Redis } from "ioredis";
import type { GatewayEnv } from "./config.js";

export function createRedis(env: GatewayEnv): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}
