import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type HookTransformWakeMode = "now" | "next-heartbeat";

export type HookTransformInput = {
  tenantId: string;
  hookName: string;
  action: "wake" | "agent";
  source: string;
  routePath: string;
  opId: string;
  nowMs: number;
  payload: unknown;
  routeConfig: Record<string, unknown>;
  message: string;
  sessionKey: string;
  agentId: string;
  wakeMode: HookTransformWakeMode;
  deliver: boolean;
  channel: string | null;
  to: string | null;
  model: string | null;
  thinking: string | null;
  timeoutSeconds: number | null;
  metadata: Record<string, unknown> | null;
};

export type HookTransformOutput = {
  message?: string;
  sessionKey?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  deliver?: boolean;
  channel?: string;
  to?: string;
  wakeMode?: HookTransformWakeMode;
  thinking?: string;
  timeoutSeconds?: number;
  metadata?: Record<string, unknown>;
};

type HookTransformModule = {
  transform?: (input: HookTransformInput) => Promise<unknown> | unknown;
  default?: (input: HookTransformInput) => Promise<unknown> | unknown;
};

type CacheEntry = {
  mtimeMs: number;
  fn: (input: HookTransformInput) => Promise<unknown> | unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asFinitePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

export function normalizeHookTransformOutput(value: unknown): HookTransformOutput {
  const raw = asObject(value) ?? {};
  const out: HookTransformOutput = {};

  const message = asNonEmptyString(raw.message);
  if (message) out.message = message;

  const sessionKey = asNonEmptyString(raw.sessionKey);
  if (sessionKey) out.sessionKey = sessionKey;

  const agentId = asNonEmptyString(raw.agentId);
  if (agentId) out.agentId = agentId;

  const provider = asNonEmptyString(raw.provider);
  if (provider) out.provider = provider;

  const model = asNonEmptyString(raw.model);
  if (model) out.model = model;

  if (typeof raw.deliver === "boolean") out.deliver = raw.deliver;

  const channel = asNonEmptyString(raw.channel);
  if (channel) out.channel = channel;

  const to = asNonEmptyString(raw.to);
  if (to) out.to = to;

  const wakeModeRaw = asNonEmptyString(raw.wakeMode)?.toLowerCase();
  if (wakeModeRaw) {
    if (wakeModeRaw !== "now" && wakeModeRaw !== "next-heartbeat") {
      throw new Error("transform output wakeMode must be 'now' or 'next-heartbeat'");
    }
    out.wakeMode = wakeModeRaw;
  }

  const thinking = asNonEmptyString(raw.thinking);
  if (thinking) out.thinking = thinking;

  const timeoutSeconds = asFinitePositiveInt(raw.timeoutSeconds);
  if (typeof timeoutSeconds === "number") {
    out.timeoutSeconds = Math.min(timeoutSeconds, 3_600);
  }

  const metadata = asObject(raw.metadata);
  if (metadata) out.metadata = metadata;

  return out;
}

export type HookTransformRuntimeOptions = {
  transformsDir: string;
  devMode?: boolean;
  timeoutMs?: number;
};

export class HookTransformRuntime {
  private readonly transformsDir: string;

  private readonly devMode: boolean;

  private readonly timeoutMs: number;

  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: HookTransformRuntimeOptions) {
    this.transformsDir = options.transformsDir.trim();
    this.devMode = options.devMode ?? false;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  isEnabled(): boolean {
    return this.transformsDir.length > 0;
  }

  async validateRootReadable(): Promise<{ enabled: boolean; ok: boolean; reason?: string }> {
    if (!this.isEnabled()) {
      return { enabled: false, ok: true };
    }

    try {
      const root = await fs.realpath(this.transformsDir);
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) {
        return { enabled: true, ok: false, reason: "OPENCLAW_HOOKS_TRANSFORMS_DIR must be a directory" };
      }
      return { enabled: true, ok: true };
    } catch (error) {
      return {
        enabled: true,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveModulePath(moduleId: string): Promise<{ cacheKey: string; href: string; mtimeMs: number }> {
    if (!this.isEnabled()) {
      throw new Error("hook transforms are disabled");
    }

    const id = moduleId.trim();
    if (!id) {
      throw new Error("transform module id is required");
    }
    if (path.isAbsolute(id)) {
      throw new Error("transform module must be a relative path");
    }

    const baseReal = await fs.realpath(this.transformsDir);
    const candidate = path.resolve(baseReal, id);
    const targetReal = await fs.realpath(candidate);

    const basePrefix = `${baseReal}${path.sep}`;
    if (targetReal !== baseReal && !targetReal.startsWith(basePrefix)) {
      throw new Error("transform module path escapes OPENCLAW_HOOKS_TRANSFORMS_DIR");
    }

    const stat = await fs.stat(targetReal);
    if (!stat.isFile()) {
      throw new Error("transform module must resolve to a file");
    }

    return {
      cacheKey: targetReal,
      href: pathToFileURL(targetReal).href,
      mtimeMs: stat.mtimeMs,
    };
  }

  private async loadTransformFn(moduleId: string): Promise<(input: HookTransformInput) => Promise<unknown> | unknown> {
    const resolved = await this.resolveModulePath(moduleId);
    const cached = this.cache.get(resolved.cacheKey);
    if (cached && (!this.devMode || cached.mtimeMs === resolved.mtimeMs)) {
      return cached.fn;
    }

    const moduleHref = this.devMode
      ? `${resolved.href}?mtime=${Math.floor(resolved.mtimeMs)}`
      : resolved.href;
    const loaded = await import(moduleHref) as HookTransformModule;
    const fn = loaded.transform ?? loaded.default;

    if (typeof fn !== "function") {
      throw new Error("transform module must export default(input) or transform(input)");
    }

    this.cache.set(resolved.cacheKey, {
      mtimeMs: resolved.mtimeMs,
      fn,
    });

    return fn;
  }

  async run(moduleId: string, input: HookTransformInput): Promise<HookTransformOutput> {
    const fn = await this.loadTransformFn(moduleId);
    const execution = Promise.resolve(fn(input));

    const result = await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`transform timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      }),
    ]);

    return normalizeHookTransformOutput(result);
  }
}
