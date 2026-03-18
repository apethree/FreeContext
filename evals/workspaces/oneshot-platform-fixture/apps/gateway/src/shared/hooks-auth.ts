import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

export function extractHookBearerToken(headers: IncomingHttpHeaders): string | null {
  const auth = trimOrEmpty(headers.authorization);
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token.length > 0 ? token : null;
  }

  const tokenHeader = trimOrEmpty(headers["x-openclaw-token"]);
  return tokenHeader.length > 0 ? tokenHeader : null;
}

export function hasHookQueryToken(url: URL): boolean {
  const candidates = ["token", "hooks_token", "openclaw_token", "x-openclaw-token"];
  return candidates.some((key) => trimOrEmpty(url.searchParams.get(key)).length > 0);
}

export function hashHookToken(token: string): string {
  return `sha256:${hashHex(token.trim())}`;
}

export function fingerprintHookToken(token: string): string {
  return hashHex(token.trim()).slice(0, 12);
}

export function verifyHookToken(
  candidateToken: string | null,
  expectedTokenHashes: string[],
): boolean {
  if (!candidateToken || !candidateToken.trim()) return false;
  if (expectedTokenHashes.length === 0) return false;
  const candidateHash = hashHookToken(candidateToken);
  for (const expected of expectedTokenHashes) {
    if (secureEqual(candidateHash, expected)) return true;
  }
  return false;
}

export function collectExpectedHookTokenHashes(
  globalToken: string,
  routeTokenHash: string | null | undefined,
): string[] {
  const hashes: string[] = [];
  const globalTrimmed = globalToken.trim();
  if (globalTrimmed.length > 0) hashes.push(hashHookToken(globalTrimmed));
  const route = trimOrEmpty(routeTokenHash);
  if (route.length > 0) hashes.push(route);
  return hashes;
}
