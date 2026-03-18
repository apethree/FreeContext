import type {
  ChannelPlugin,
  ApplyInput,
  ApplyResult,
  ProbeInput,
  ProbeResult,
  SendInput,
  SendResult,
  DestroyInput,
  NormalizeInput,
  NormalizeResult,
} from "./channel-plugin.js";
import { createGatewayChannelPlugins } from "./openclaw-bridge.js";
import { logEvent, logError } from "../shared/logger.js";

export const PLUGIN_REGISTRY = new Map<string, ChannelPlugin>();

let initialized = false;

export function initPluginRegistry(): void {
  if (initialized) return;
  initialized = true;

  try {
    const plugins = createGatewayChannelPlugins();
    for (const [type, plugin] of plugins) {
      PLUGIN_REGISTRY.set(type, plugin);
    }

    logEvent("gateway-channels", "plugin-registry.initialized", {
      pluginCount: PLUGIN_REGISTRY.size,
      types: [...PLUGIN_REGISTRY.keys()],
    });
  } catch (err) {
    logError(
      "gateway-channels",
      "plugin-registry.init-failed",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

export function hasPlugin(type: string): boolean {
  return PLUGIN_REGISTRY.has(type.toLowerCase());
}

// Typed overloads so callers get the right return type without casting.
export function dispatchPlugin(type: string, method: "apply", input: ApplyInput): Promise<ApplyResult>;
export function dispatchPlugin(type: string, method: "probe", input: ProbeInput): Promise<ProbeResult>;
export function dispatchPlugin(type: string, method: "send", input: SendInput): Promise<SendResult>;
export function dispatchPlugin(type: string, method: "destroy", input: DestroyInput): Promise<void>;
export function dispatchPlugin(type: string, method: "normalizeInbound", input: NormalizeInput): Promise<NormalizeResult>;
export async function dispatchPlugin(
  type: string,
  method: keyof Omit<ChannelPlugin, "type">,
  input: unknown,
): Promise<unknown> {
  const plugin = PLUGIN_REGISTRY.get(type.toLowerCase());
  if (!plugin) {
    throw new Error(`no plugin registered for channel type: ${type}`);
  }
  const fn = plugin[method];
  if (typeof fn !== "function") {
    throw new Error(`${type}.${method} is not a function`);
  }
  return (fn as (arg: unknown) => Promise<unknown>).call(plugin, input);
}

export function pluginManifest(): { type: string }[] {
  return [...PLUGIN_REGISTRY.keys()].map((type) => ({ type }));
}
