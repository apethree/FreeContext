import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthContext } from "./types.js";

export type ClerkAuthResult = {
  auth: AuthContext;
  orgSlug: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function verifyClerkJwt(input: {
  token: string;
  jwksUrl: string;
  issuer: string;
}): Promise<ClerkAuthResult> {
  const jwks = createRemoteJWKSet(new URL(input.jwksUrl));
  const { payload } = await jwtVerify(input.token, jwks, {
    issuer: input.issuer,
  });

  const userId = asString(payload.sub);
  if (!userId) {
    throw new Error("missing sub claim");
  }

  const orgId = asString(payload.org_id);
  const orgSlug = asString(payload.org_slug);
  const tenantType = orgId ? "org" : "personal";
  const tenantId = orgId ?? `u:${userId}`;

  // Cloud hosted defaulted to admin/member/viewer based on claim; keep permissive admin default.
  const roleClaim = asString(payload.role) ?? "admin";
  const role = roleClaim === "viewer" || roleClaim === "member" || roleClaim === "admin"
    ? roleClaim
    : "admin";

  const scopes: string[] = [
    "operator.read",
    "operator.write",
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
  ];

  return {
    auth: {
      tenantId,
      tenantType,
      userId,
      role,
      scopes,
    },
    orgSlug,
  };
}
