import { createServer } from "node:http";
import { loadEnv } from "../shared/config.js";
import { createPgPool } from "../shared/pg.js";
import { createRedis } from "../shared/redis.js";
import { createS3 } from "../shared/s3.js";
import { startInboundWorker } from "./inbound-worker.js";
import { startOutboundWorker } from "./outbound-worker.js";
import { logError, logEvent } from "../shared/logger.js";
import { initPluginRegistry } from "../channels/plugin-registry.js";

async function main() {
  const env = loadEnv();
  const service = "gateway-workers";

  initPluginRegistry();

  const pg = createPgPool(env);
  const redis = createRedis(env);
  const s3 = createS3(env);

  const inbound = startInboundWorker({ env, redis, pg });
  const outbound = startOutboundWorker({ env, pg, s3 });

  inbound.on("completed", (job) => {
    logEvent(service, "inbound.completed", {
      jobId: job.id,
      tenantId: job.data.tenantId,
    });
  });

  outbound.on("completed", (job) => {
    logEvent(service, "outbound.completed", {
      jobId: job.id,
      tenantId: job.data.tenantId,
      channelId: job.data.channelId,
    });
  });

  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      service,
      machineId: env.MACHINE_ID,
    }));
  });

  server.listen(env.PORT, () => {
    logEvent(service, "server.started", {
      port: env.PORT,
      machineId: env.MACHINE_ID,
    });
  });
}

void main().catch((error) => {
  logError("gateway-workers", "server.crash", error);
  process.exit(1);
});
