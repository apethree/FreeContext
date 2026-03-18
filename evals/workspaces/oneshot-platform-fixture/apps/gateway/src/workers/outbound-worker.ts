import { Worker, type Job } from "bullmq";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import type { GatewayEnv } from "../shared/config.js";
import type { OutboundJob } from "../shared/types.js";
import { getJsonObject } from "../shared/s3.js";
import { logError, logEvent } from "../shared/logger.js";
import { parseRedisUrlToBullmqOptions } from "../shared/bullmq.js";
import { hasPlugin, dispatchPlugin } from "../channels/plugin-registry.js";

type ChannelRow = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
};

type StoredPayload = {
  channelId: string;
  channelType: string;
  targetId: string;
  payload?: unknown;
};

async function loadChannel(pg: Pool, tenantId: string, channelId: string): Promise<ChannelRow | null> {
  const result = await pg.query<{
    id: string;
    type: string;
    config: unknown;
    is_active: boolean;
  }>(
    `SELECT id, type, config, is_active FROM channels WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, channelId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    config: (typeof row.config === "object" && row.config ? row.config : {}) as Record<string, unknown>,
    is_active: Boolean(row.is_active),
  };
}

async function deliverViaWebhook(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`webhook delivery failed: ${res.status}`);
  }
}

export function startOutboundWorker(input: {
  env: GatewayEnv;
  pg: Pool;
  s3: S3Client;
}): Worker<OutboundJob, void, string> {
  const { env, pg, s3 } = input;
  const bullConnection = parseRedisUrlToBullmqOptions(env.REDIS_URL);

  return new Worker<OutboundJob, void, string>(
    env.BULLMQ_OUTBOUND_QUEUE,
    async (job: Job<OutboundJob>) => {
      const payload = job.data;
      let resolved = payload;

      if (payload.payloadRef) {
        const stored = await getJsonObject<StoredPayload>(s3, env.S3_BUCKET, payload.payloadRef);
        if (stored) {
          resolved = {
            ...payload,
            channelId: stored.channelId,
            channelType: stored.channelType,
            targetId: stored.targetId,
            payload: typeof payload.payload === "undefined" ? stored.payload : payload.payload,
          };
        }
      }

      await pg.query(
        `UPDATE jobs SET status = 'processing', updated_at = $2 WHERE id = $1`,
        [resolved.id, Date.now()],
      );

      const channel = await loadChannel(pg, resolved.tenantId, resolved.channelId);
      if (!channel || !channel.is_active) {
        throw new Error("channel not found or inactive");
      }

      const type = channel.type.toLowerCase();
      if (type === "webhook") {
        const url = typeof channel.config.url === "string" ? channel.config.url : "";
        if (!url) throw new Error("webhook config missing url");
        await deliverViaWebhook(url, {
          id: resolved.id,
          tenantId: resolved.tenantId,
          channelType: resolved.channelType,
          targetId: resolved.targetId,
          payload: resolved.payload ?? {},
        });
      } else if (hasPlugin(type)) {
        const result = await dispatchPlugin(type, "send", {
          tenantId: resolved.tenantId,
          channelId: resolved.channelId,
          channelType: type,
          targetId: resolved.targetId,
          payload: resolved.payload,
          idempotencyKey: resolved.idempotencyKey,
          config: channel.config,
        });
        if (!result.ok) throw new Error(result.error ?? "plugin send failed");
      } else {
        throw new Error(`no delivery handler for channel type: ${type}`);
      }

      await pg.query(
        `UPDATE jobs SET status = 'completed', updated_at = $2 WHERE id = $1`,
        [resolved.id, Date.now()],
      );

      logEvent("gateway-workers", "outbound.delivered", {
        tenantId: resolved.tenantId,
        channelId: resolved.channelId,
        channelType: type,
        jobId: job.id,
      });
    },
    {
      connection: bullConnection,
      prefix: env.BULLMQ_PREFIX,
      concurrency: 10,
    },
  ).on("failed", async (job, err) => {
    if (!job) {
      logError("gateway-workers", "outbound.failed.nojob", err);
      return;
    }

    const failed = job.attemptsMade >= 4;
    await pg.query(
      `UPDATE jobs
       SET status = $2,
           attempt = attempt + 1,
           updated_at = $3,
           last_error = $4
       WHERE id = $1`,
      [job.data.id, failed ? "failed" : "retrying", Date.now(), (err instanceof Error ? err.message : String(err)).slice(0, 512)],
    );

    logError("gateway-workers", "outbound.failed", err, {
      tenantId: job.data.tenantId,
      channelId: job.data.channelId,
      attemptsMade: job.attemptsMade,
      failed,
    });
  });
}
