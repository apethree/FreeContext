import { createHmac } from "node:crypto";
import type { Job } from "bullmq";
import { Worker } from "bullmq";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import type { GatewayEnv } from "../shared/config.js";
import { redisKeys } from "../shared/redis-keys.js";
import { addInboundBacklog } from "../shared/inbound-backlog.js";
import { logError, logEvent } from "../shared/logger.js";
import type { InboundJob } from "../shared/types.js";
import { parseRedisUrlToBullmqOptions } from "../shared/bullmq.js";
import { hasPlugin, dispatchPlugin } from "../channels/plugin-registry.js";

function signDelivery(secret: string, tenantId: string, eventId: string): string {
  return createHmac("sha256", secret).update(`${tenantId}:${eventId}`).digest("hex");
}

function realtimeInternalUrl(env: GatewayEnv, machineId: string): string {
  return `http://${machineId}.vm.${env.REALTIME_INTERNAL_APP}.internal:8080/internal/deliver`;
}

export function startInboundWorker(input: {
  env: GatewayEnv;
  redis: Redis;
  pg: Pool;
}): Worker<InboundJob, void, string> {
  const { env, redis, pg } = input;
  const bullConnection = parseRedisUrlToBullmqOptions(env.REDIS_URL);

  return new Worker<InboundJob, void, string>(
    env.BULLMQ_INBOUND_QUEUE,
    async (job: Job<InboundJob>) => {
      const payload = job.data;
      const ownerRaw = await redis.get(redisKeys.tenantOwner(payload.tenantId));

      if (!ownerRaw) {
        await addInboundBacklog(pg, {
          tenantId: payload.tenantId,
          eventId: payload.id,
          eventType: payload.eventType,
          payloadRef: payload.payloadRef ?? null,
          payloadJson: payload.payload ?? {},
        });

        logEvent("gateway-workers", "inbound.backlogged", {
          tenantId: payload.tenantId,
          eventId: payload.id,
          eventType: payload.eventType,
          jobId: job.id,
        });
        return;
      }

      const owner = JSON.parse(ownerRaw) as { ownerId?: string };
      const ownerId = typeof owner.ownerId === "string" ? owner.ownerId : "";
      if (!ownerId) {
        await addInboundBacklog(pg, {
          tenantId: payload.tenantId,
          eventId: payload.id,
          eventType: payload.eventType,
          payloadRef: payload.payloadRef ?? null,
          payloadJson: payload.payload ?? {},
        });
        return;
      }

      const url = realtimeInternalUrl(env, ownerId);
      const signature = signDelivery(env.INTERNAL_DELIVERY_SECRET, payload.tenantId, payload.id);

      let deliveryPayload = payload.payload ?? {};
      const channelType = payload.source;
      if (hasPlugin(channelType)) {
        try {
          const channel = await pg.query<{ id: string; config: unknown }>(
            `SELECT id, config FROM channels WHERE tenant_id = $1 AND type = $2 AND is_active = true LIMIT 1`,
            [payload.tenantId, channelType],
          );
          if (channel.rows[0]) {
            const config = (typeof channel.rows[0].config === "object" && channel.rows[0].config
              ? channel.rows[0].config
              : {}) as Record<string, unknown>;
            const normalized = await dispatchPlugin(channelType, "normalizeInbound", {
              tenantId: payload.tenantId,
              channelId: channel.rows[0].id,
              channelType,
              eventType: payload.eventType,
              source: payload.source,
              sourceEventId: payload.sourceEventId,
              payload: payload.payload,
              config,
            });
            if (normalized.ok) {
              deliveryPayload = {
                ...((typeof payload.payload === "object" && payload.payload) || {}),
                _normalized: true,
                text: normalized.text,
                senderId: normalized.senderId,
                senderName: normalized.senderName,
              };
            }
          }
        } catch (err) {
          logEvent("gateway-workers", "inbound.normalize-warning", {
            tenantId: payload.tenantId,
            source: channelType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openclaw-delivery": signature,
        },
        body: JSON.stringify({
          tenantId: payload.tenantId,
          eventId: payload.id,
          event: payload.eventType,
          payload: deliveryPayload,
        }),
      });

      if (!response.ok) {
        throw new Error(`deliver failed: ${response.status}`);
      }

      logEvent("gateway-workers", "inbound.delivered", {
        tenantId: payload.tenantId,
        ownerId,
        eventId: payload.id,
      });
    },
    {
      connection: bullConnection,
      prefix: env.BULLMQ_PREFIX,
      concurrency: 20,
    },
  ).on("failed", (_job, err) => {
    logError("gateway-workers", "inbound.failed", err);
  });
}
