export type GatewayConnectionMode = 'local' | 'remote-ssh' | 'remote-direct';
export type GatewayCloudTarget = 'dev-local' | 'prod' | 'none';
export type GatewayConnectionScope = 'cloud' | 'local-openclaw';

export type GatewayTunnelStatus = 'stopped' | 'starting' | 'running' | 'failed';

export type GatewayRemoteSettings = {
  transport: 'ssh' | 'direct';
  sshTarget: string;
  sshPort: number;
  identityFile: string;
  remoteGatewayPort: number;
  remoteUrl: string;
  token: string;
  password: string;
};

export type GatewayProcessStatus =
  | 'stopped'
  | 'starting'
  | 'running-service'
  | 'running-child'
  | 'stopping'
  | 'failed';

export type GatewayConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded';

export type GatewayActivityKind = 'idle' | 'job' | 'tool';

export type GatewayActivitySnapshot = {
  kind: GatewayActivityKind;
  sessionKey: string;
  label: string;
  updatedAtMs: number;
};

export type GatewayHealthSnapshot = {
  ok: boolean | null;
  summary: string;
  checkedAtMs: number | null;
};

export type GatewayRuntimeConfigSnapshot = {
  configPath: string;
  stateDir: string;
  port: number;
  wsUrl: string;
  hasToken: boolean;
  hasPassword: boolean;
  parseError: string | null;
};

export type GatewayStateSnapshot = {
  processStatus: GatewayProcessStatus;
  processDetail: string;
  connectionStatus: GatewayConnectionStatus;
  connectionDetail: string;
  connectionMode: GatewayConnectionMode;
  connectionScope: GatewayConnectionScope;
  cloudTarget: GatewayCloudTarget;
  tunnelStatus: GatewayTunnelStatus;
  tunnelDetail: string;
  lastCloudConnectAttemptAtMs: number | null;
  lastCloudConnectError: string | null;
  config: GatewayRuntimeConfigSnapshot;
  health: GatewayHealthSnapshot;
  activity: GatewayActivitySnapshot | null;
  lastUpdatedAtMs: number;
};

export type GatewayRequestPayload = {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayResponseErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

export type GatewayResponsePayload = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: GatewayResponseErrorPayload;
};

export type GatewayEventPayload = {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
};

export type GatewayFrame =
  | GatewayRequestPayload
  | GatewayResponsePayload
  | GatewayEventPayload;

export type GatewayPushEvent = {
  type: 'chat' | 'agent' | 'health' | 'tick' | 'shutdown' | 'other';
  event: string;
  payload: unknown;
  seq?: number;
  ts: number;
};

export type GatewayNodeInfo = {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  paired?: boolean;
  connected?: boolean;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
};

export type GatewayNodeListResponse = {
  ts?: number;
  nodes?: GatewayNodeInfo[];
};

export type GatewayChatHistoryResponse = {
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
  thinkingLevel?: string;
  verboseLevel?: string;
};

export type GatewaySendChatRequest = {
  sessionKey: string;
  message: string;
  attachments?: GatewayChatAttachment[];
  provider?: string;
  model?: string;
  system?: string;
  thinking?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type GatewayChatAttachment = {
  type: 'image';
  mimeType: string;
  content: string;
  fileName?: string;
};

export type GatewayAbortChatRequest = {
  sessionKey: string;
  runId?: string;
};

export type GatewayChatHistoryRequest = {
  sessionKey: string;
  limit?: number;
};

export type GatewaySendChatResponse = {
  runId: string;
  status: string;
};

export type GatewayAbortChatResponse = {
  ok: boolean;
  aborted: boolean;
};
