import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { logError } from "../shared/logger.js";
import type { GatewayEnv } from "../shared/config.js";
import type { ClientRequestAuth } from "./client-auth.js";
import { requestUrl } from "./client-auth.js";

const FORWARDED_QUERY_KEYS = [
  "offset",
  "handle",
  "live",
  "live_sse",
  "replica",
  "log",
  "columns",
  "cursor",
  "shape_id",
] as const;

const TOKEN_RECORD_COLUMNS = [
  "tenant_id",
  "user_id",
  "provider",
  "token_kind",
  "email",
  "pi_provider_id",
  "oauth_provider_id",
  "expires_at_ms",
  "account_id",
  "project_id",
  "metadata_json",
  "updated_at_ms",
];

type ShapeDefinition = {
  table: string;
  where: (auth: ClientRequestAuth) => string;
  columns?: string[];
};

const SHAPE_DEFINITIONS: Record<string, ShapeDefinition> = {
  "/sync/shapes/credentials": {
    table: "token_records",
    where: ({ auth }) =>
      `tenant_id = '${escapeSqlLiteral(auth.tenantId)}' AND user_id = '${escapeSqlLiteral(auth.userId)}'`,
    columns: TOKEN_RECORD_COLUMNS,
  },
  "/sync/shapes/channels": {
    table: "channels",
    where: ({ auth }) => `tenant_id = '${escapeSqlLiteral(auth.tenantId)}'`,
  },
  "/sync/shapes/hook-routes": {
    table: "hook_routes",
    where: ({ auth }) => `tenant_id = '${escapeSqlLiteral(auth.tenantId)}'`,
  },
  "/sync/shapes/hook-agents": {
    table: "hook_agents",
    where: ({ auth }) => `tenant_id = '${escapeSqlLiteral(auth.tenantId)}'`,
  },
};

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function copyProxyHeaders(upstream: Response, res: ServerResponse): void {
  for (const [key, value] of upstream.headers.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === "connection" || normalized === "transfer-encoding" || normalized === "keep-alive") {
      continue;
    }
    res.setHeader(key, value);
  }
}

export async function handleShapeProxyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  input: {
    env: GatewayEnv;
    auth: ClientRequestAuth;
  },
): Promise<boolean> {
  const definition = SHAPE_DEFINITIONS[path];
  if (!definition) {
    return false;
  }

  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "method not allowed" });
    return true;
  }

  try {
    const incomingUrl = requestUrl(req);
    const upstreamUrl = new URL("/v1/shape", input.env.ELECTRIC_URL);
    upstreamUrl.searchParams.set("table", definition.table);
    upstreamUrl.searchParams.set("where", definition.where(input.auth));

    if (definition.columns) {
      upstreamUrl.searchParams.set("columns", definition.columns.join(","));
    }

    for (const key of FORWARDED_QUERY_KEYS) {
      if (key === "columns" && definition.columns) {
        continue;
      }
      const value = incomingUrl.searchParams.get(key);
      if (value !== null) {
        upstreamUrl.searchParams.set(key, value);
      }
    }

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        accept: typeof req.headers.accept === "string" ? req.headers.accept : "*/*",
      },
    });

    res.statusCode = upstream.status;
    copyProxyHeaders(upstream, res);

    if (!upstream.body) {
      res.end(await upstream.text());
      return true;
    }

    Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  } catch (error) {
    logError("gateway-api", "electric.shape.proxy_failed", error, {
      path,
      electricUrl: input.env.ELECTRIC_URL,
      tenantId: input.auth.auth.tenantId,
      userId: input.auth.auth.userId,
    });
    json(res, 502, { ok: false, error: "electric shape proxy failed" });
    return true;
  }
}
