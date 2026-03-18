export type ChannelHealth = {
  recentJobCount: number;
  completed: number;
  failed: number;
  queued: number;
  lastActivity: number | null;
  lastError: string | null;
};

export type InstanceStatus = "disconnected" | "connecting" | "connected" | "error";

export type ChannelInstance = {
  id: string;
  type: string;
  isPersisted: boolean;
  isActive: boolean;
  status: InstanceStatus;
  createdAt?: number;
};

export type ChannelStatusResult = {
  ok: boolean;
  found?: boolean;
  channel?: {
    id: string;
    type: string;
    isActive: boolean;
    createdAt: number;
  };
  health?: ChannelHealth;
  reason?: string;
};

export type ProbeResult = {
  ok: boolean;
  skipped?: boolean;
  elapsedMs?: number;
  bot?: { id?: string; username?: string };
  error?: string;
};

export function deriveInstanceStatus(
  instance: ChannelInstance,
  status?: ChannelStatusResult | null,
  probe?: ProbeResult | null,
): InstanceStatus {
  if (!instance.isPersisted) return "disconnected";
  if (!instance.isActive) return "disconnected";

  // Probe result takes precedence when available
  if (probe) {
    if (probe.skipped) return "connected"; // no probe available for this type, assume ok
    if (probe.ok) return "connected";
    return "error";
  }

  if (!status) return "connecting";
  if (!status.ok) return "error";
  if (status.found === false) return "disconnected";

  const health = status.health ?? null;
  if (!health) return "connected";
  if (health.failed > 0) return "error";
  if (health.queued > 0) return "connecting";
  return "connected";
}
