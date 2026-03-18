export type AuthContext = {
  tenantId: string;
  tenantType: "personal" | "org";
  userId: string;
  role: "admin" | "member" | "viewer" | "node";
  scopes: string[];
  deviceId?: string;
};

export type TokenKind = "oauth" | "api-key";

export type TokenRecord = {
  tenantId: string;
  userId: string;
  provider: string;
  token: string;
  tokenKind: TokenKind;
  updatedAtMs: number;
  email?: string;
  piProviderId?: string;
  oauthProviderId?: string;
  refreshToken?: string;
  expiresAtMs?: number;
  accountId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

export type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type Frame = RequestFrame | ResponseFrame | EventFrame;

export type InboundJob = {
  queueType: "inbound";
  id: string;
  tenantId: string;
  eventType: string;
  source: string;
  sourceEventId: string;
  payloadRef?: string;
  payload?: unknown;
};

export type HookAction = "wake" | "agent";
export type HookWakeMode = "now" | "next-heartbeat";

export type HookRouteMatch = {
  path?: string;
  source?: string;
};

export type HookRouteConfig = {
  name: string;
  action: HookAction;
  enabled: boolean;
  tokenHash?: string;
  match?: HookRouteMatch;
  defaultSessionKey?: string;
  allowRequestSessionKey?: boolean;
  allowedSessionKeyPrefixes?: string[];
  allowedAgentIds?: string[];
  agentId?: string;
  wakeMode?: HookWakeMode;
  deliver?: boolean;
  channel?: string;
  to?: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
  messageTemplate?: string;
  textTemplate?: string;
  transformModule?: string;
  metadata?: Record<string, unknown>;
};

export type HookAgentSessionMode = "isolated" | "shared";

export type HookAgentProfileConfig = {
  agentId: string;
  enabled: boolean;
  provider?: string;
  model?: string;
  system?: string;
  thinking?: string;
  timeoutSeconds?: number;
  sessionMode?: HookAgentSessionMode;
  summaryToMain?: boolean;
  metadata?: Record<string, unknown>;
};

export type HookAgentProfileRecord = {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  config: HookAgentProfileConfig;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HookRouteRecord = {
  tenantId: string;
  name: string;
  action: HookAction;
  enabled: boolean;
  tokenHash: string | null;
  config: HookRouteConfig;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HookEventStatus = "queued" | "processing" | "processed" | "failed" | "rejected";

export type HookEventRecord = {
  eventId: string;
  tenantId: string;
  hookName: string;
  action: HookAction;
  source: string;
  path: string;
  status: HookEventStatus;
  error: string | null;
  payloadRef: string | null;
  payloadJson: unknown;
  createdAtMs: number;
  processedAtMs: number | null;
};

export type HookJob = {
  queueType: "hook";
  id: string;
  tenantId: string;
  hookName: string;
  action: HookAction;
  source: string;
  path: string;
  payload?: unknown;
  payloadRef?: string;
  receivedAtMs: number;
  opId: string;
};

export type OutboundJob = {
  queueType: "outbound";
  id: string;
  tenantId: string;
  channelId: string;
  channelType: string;
  targetId: string;
  payloadRef?: string;
  payload?: unknown;
  idempotencyKey?: string;
};

export type TenantOwnershipLease = {
  ownerId: string;
  leaseId: string;
  epoch: number;
  expiresAtMs: number;
};
