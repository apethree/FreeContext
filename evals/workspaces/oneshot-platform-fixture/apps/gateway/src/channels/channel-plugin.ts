export type ApplyInput = {
  tenantId: string;
  channelId: string;
  channelType: string;
  isActive: boolean;
  config: Record<string, unknown>;
};

export type ApplyResult = {
  ok: boolean;
  state?: Record<string, unknown>;
  error?: string;
};

export type ProbeInput = {
  tenantId: string;
  channelId: string;
  channelType: string;
  config: Record<string, unknown>;
};

export type ProbeResult = {
  ok: boolean;
  elapsedMs?: number;
  detail?: unknown;
  error?: string;
};

export type SendInput = {
  tenantId: string;
  channelId: string;
  channelType: string;
  targetId: string;
  payload: unknown;
  idempotencyKey?: string;
  config: Record<string, unknown>;
};

export type SendResult = {
  ok: boolean;
  deliveryId?: string;
  error?: string;
};

export type DestroyInput = {
  tenantId: string;
  channelId: string;
  channelType: string;
  config: Record<string, unknown>;
};

export type NormalizeInput = {
  tenantId: string;
  channelId: string;
  channelType: string;
  eventType: string;
  source: string;
  sourceEventId: string;
  payload: unknown;
  config: Record<string, unknown>;
};

export type NormalizeResult = {
  ok: boolean;
  text?: string;
  senderId?: string;
  senderName?: string;
  error?: string;
};

export interface ChannelPlugin {
  readonly type: string;
  apply(input: ApplyInput): Promise<ApplyResult>;
  probe(input: ProbeInput): Promise<ProbeResult>;
  send(input: SendInput): Promise<SendResult>;
  destroy(input: DestroyInput): Promise<void>;
  normalizeInbound(input: NormalizeInput): Promise<NormalizeResult>;
}
