import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SERVICE_NAME: z.enum(["gateway-realtime", "gateway-api", "gateway-workers"]).default("gateway-realtime"),
  PORT: z.coerce.number().int().positive().default(8080),

  CLERK_JWKS_URL: z.string().url(),
  CLERK_ISSUER: z.string().min(1),
  ELECTRIC_URL: z.string().url().default("http://127.0.0.1:3000"),
  CORS_ALLOWED_ORIGINS: z.string().default(
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175",
  ),

  INTERNAL_WORKER_BEARER_TOKEN: z.string().default(""),
  INTERNAL_DELIVERY_SECRET: z.string().min(16),
  OPENCLAW_HOOKS_TOKEN: z.string().default(""),
  OPENCLAW_HOOKS_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(262_144),
  OPENCLAW_HOOKS_AUTH_FAIL_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  OPENCLAW_HOOKS_AUTH_FAIL_LIMIT: z.coerce.number().int().positive().default(20),
  OPENCLAW_HOOKS_TRANSFORMS_DIR: z.string().default(""),

  REDIS_URL: z.string().min(1),
  PG_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),

  TENANT_TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(1),

  BULLMQ_PREFIX: z.string().default("gateway"),
  BULLMQ_INBOUND_QUEUE: z.string().default("inbound"),
  BULLMQ_OUTBOUND_QUEUE: z.string().default("outbound"),
  REALTIME_INTERNAL_APP: z.string().default("capzero-gateway-realtime"),

  OWNER_LEASE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  OWNER_HEARTBEAT_MS: z.coerce.number().int().positive().default(60_000),
  OWNER_IDLE_GRACE_MS: z.coerce.number().int().positive().default(60_000),

  MACHINE_ID: z.string().default(process.env.FLY_MACHINE_ID || process.env.HOSTNAME || "local-machine"),
});

export type GatewayEnv = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): GatewayEnv {
  return EnvSchema.parse(raw);
}
