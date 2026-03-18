import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyClerkJwt } from "../shared/clerk.js";
import type { GatewayEnv } from "../shared/config.js";
import type { AuthContext } from "../shared/types.js";

const DEFAULT_ALLOWED_HEADERS = "authorization, content-type, last-event-id";
const DEFAULT_ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";

export class ClientAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ClientRequestAuth = {
  auth: AuthContext;
  bearerToken: string;
  orgSlug: string | null;
};

export function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `http://${host}`);
}

export function isClientRoutePath(path: string): boolean {
  return path === "/api"
    || path.startsWith("/api/")
    || path === "/sync"
    || path.startsWith("/sync/");
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function appendVary(res: ServerResponse, value: string): void {
  const existing = res.getHeader("vary");
  const parts = new Set<string>();

  const addPart = (input: string) => {
    for (const entry of input.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) parts.add(trimmed);
    }
  };

  if (typeof existing === "string") {
    addPart(existing);
  } else if (Array.isArray(existing)) {
    for (const valueEntry of existing) {
      if (typeof valueEntry === "string") addPart(valueEntry);
    }
  }

  addPart(value);
  res.setHeader("vary", [...parts].join(", "));
}

function parseAllowedOrigins(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function resolveCorsOrigin(req: IncomingMessage, env: GatewayEnv): string | null {
  const origin = trimString(req.headers.origin);
  if (!origin) return null;
  if (origin === "null") return "*";
  return parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS).has(origin) ? origin : null;
}

export function applyClientCors(req: IncomingMessage, res: ServerResponse, env: GatewayEnv): void {
  const allowedOrigin = resolveCorsOrigin(req, env);
  if (!allowedOrigin) return;

  res.setHeader("access-control-allow-origin", allowedOrigin);
  res.setHeader("access-control-allow-methods", DEFAULT_ALLOWED_METHODS);
  res.setHeader("access-control-allow-headers", DEFAULT_ALLOWED_HEADERS);
  res.setHeader("access-control-expose-headers", "*");
  appendVary(res, "Origin");
}

export function handleClientCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  env: GatewayEnv,
  path: string,
): boolean {
  if (req.method !== "OPTIONS" || !isClientRoutePath(path)) {
    return false;
  }

  const originHeader = trimString(req.headers.origin);
  const allowedOrigin = resolveCorsOrigin(req, env);

  if (originHeader && !allowedOrigin) {
    res.statusCode = 403;
    res.end();
    return true;
  }

  if (allowedOrigin) {
    const requestedHeaders = trimString(req.headers["access-control-request-headers"]);
    res.setHeader("access-control-allow-origin", allowedOrigin);
    res.setHeader("access-control-allow-methods", DEFAULT_ALLOWED_METHODS);
    res.setHeader("access-control-allow-headers", requestedHeaders ?? DEFAULT_ALLOWED_HEADERS);
    res.setHeader("access-control-max-age", "600");
    res.setHeader("access-control-expose-headers", "*");
    appendVary(res, "Origin, Access-Control-Request-Headers");
  }

  res.statusCode = 204;
  res.end();
  return true;
}

export async function requireClientAuth(req: IncomingMessage, env: GatewayEnv): Promise<ClientRequestAuth> {
  const token = getBearer(req);
  if (!token) {
    throw new ClientAuthError(401, "UNAUTHORIZED", "missing bearer token");
  }

  try {
    const verified = await verifyClerkJwt({
      token,
      jwksUrl: env.CLERK_JWKS_URL,
      issuer: env.CLERK_ISSUER,
    });
    return {
      auth: verified.auth,
      bearerToken: token,
      orgSlug: verified.orgSlug,
    };
  } catch {
    throw new ClientAuthError(401, "UNAUTHORIZED", "invalid bearer token");
  }
}
