import type { HookRouteConfig, HookRouteRecord } from "./types.js";
import { renderHookTemplate } from "./hooks-template.js";

export type ResolveHookRouteInput = {
  path: string;
  source?: string | null;
  explicitName?: string | null;
  routes: HookRouteRecord[];
};

export type HookTemplateVars = {
  tenantId: string;
  hookName: string;
  path: string;
  source: string;
  payload: unknown;
  nowMs: number;
  nowIso: string;
  opId: string;
};

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeSource(source: string | null | undefined): string {
  return (source ?? "").trim().toLowerCase();
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathMatches(pattern: string | undefined, path: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  const normalizedPattern = normalizePath(pattern);
  // Support exact path or * wildcard segments.
  const regex = new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, ".*")}$`, "i");
  return regex.test(path);
}

function sourceMatches(pattern: string | undefined, source: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  return pattern.trim().toLowerCase() === source;
}

function routeMatches(route: HookRouteRecord, path: string, source: string): boolean {
  if (!route.enabled) return false;
  const match = route.config.match;
  return pathMatches(match?.path, path) && sourceMatches(match?.source, source);
}

export function resolveHookRoute(input: ResolveHookRouteInput): HookRouteRecord | null {
  const normalizedPath = normalizePath(input.path);
  const normalizedSource = normalizeSource(input.source);
  const explicit = input.explicitName?.trim().toLowerCase();

  if (explicit) {
    const named = input.routes.find((route) => route.name.toLowerCase() === explicit) ?? null;
    if (!named) return null;
    return routeMatches(named, normalizedPath, normalizedSource) ? named : null;
  }

  for (const route of input.routes) {
    if (routeMatches(route, normalizedPath, normalizedSource)) return route;
  }
  return null;
}

export function buildHookTemplateVars(input: HookTemplateVars): Record<string, unknown> {
  const payloadTopLevel = input.payload && typeof input.payload === "object"
    ? input.payload as Record<string, unknown>
    : {};
  return {
    ...payloadTopLevel,
    tenantId: input.tenantId,
    hookName: input.hookName,
    path: input.path,
    source: input.source,
    payload: input.payload,
    opId: input.opId,
    nowMs: input.nowMs,
    nowIso: input.nowIso,
  };
}

export function renderHookMessage(config: HookRouteConfig, vars: Record<string, unknown>): string {
  const template = config.messageTemplate || config.textTemplate;
  if (template && template.trim()) {
    return renderHookTemplate(template, vars).trim();
  }
  return "";
}
