export type HookRouteAction = 'wake' | 'agent';

export type HookRouteConfig = {
  name?: string;
  action?: HookRouteAction;
  enabled?: boolean;
  tokenHash?: string;
  match?: {
    path?: string;
    source?: string;
  };
  defaultSessionKey?: string;
  allowRequestSessionKey?: boolean;
  allowedSessionKeyPrefixes?: string[];
  allowedAgentIds?: string[];
  agentId?: string;
  wakeMode?: 'now' | 'next-heartbeat';
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

export type HookRouteRecord = {
  tenantId: string;
  name: string;
  action: HookRouteAction;
  enabled: boolean;
  tokenHash: string | null;
  config: HookRouteConfig;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HookEventRecord = {
  eventId: string;
  hookName: string;
  action: HookRouteAction;
  source: string;
  path: string;
  status: string;
  error: string | null;
  payloadRef: string | null;
  payloadJson: unknown;
  createdAtMs: number;
  processedAtMs: number | null;
};

export type HookAgentRecord = {
  tenantId: string;
  agentId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HookRouteListResult = {
  ok: boolean;
  reason?: string;
  routes: HookRouteRecord[];
};

export type HookRouteUpsertPayload = {
  name: string;
  action: HookRouteAction;
  enabled?: boolean;
  token?: string;
  tokenHash?: string;
  config?: HookRouteConfig;
};

export type HookRouteUpsertResult = {
  ok: boolean;
  reason?: string;
  route?: HookRouteRecord;
};

export type HookRouteDeleteResult = {
  ok: boolean;
  reason?: string;
  deleted: boolean;
};

export type HookEventListResult = {
  ok: boolean;
  reason?: string;
  events: HookEventRecord[];
};

export type HookAgentListResult = {
  ok: boolean;
  reason?: string;
  agents: HookAgentRecord[];
};

export type HookAgentUpsertPayload = {
  agentId: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type HookAgentUpsertResult = {
  ok: boolean;
  reason?: string;
  agent?: HookAgentRecord;
};

export type HookAgentDeleteResult = {
  ok: boolean;
  reason?: string;
  deleted: boolean;
};
