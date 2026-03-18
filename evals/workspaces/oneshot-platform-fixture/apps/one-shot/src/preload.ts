import { contextBridge, ipcRenderer } from 'electron';
import type {
  GatewayAbortChatResponse,
  GatewayAbortChatRequest,
  GatewayChatHistoryRequest,
  GatewayChatHistoryResponse,
  GatewayNodeListResponse,
  GatewayPushEvent,
  GatewayRemoteSettings,
  GatewaySendChatResponse,
  GatewaySendChatRequest,
  GatewayStateSnapshot,
} from '@/gateway/demoTypes';
import type {
  HookAgentDeleteResult,
  HookAgentUpsertPayload,
  HookAgentUpsertResult,
  HookEventListResult,
  HookRouteDeleteResult,
  HookRouteUpsertPayload,
  HookRouteUpsertResult,
} from '@/gateway/hookOpsTypes';

type TerminalOutputPayload = {
  sessionId: string;
  data: string;
  stream: 'stdout' | 'stderr';
};

type TerminalExitPayload = {
  sessionId: string;
  code: number | null;
  signal: string | null;
};

type MenuCommandPayload =
  | { type: 'navigate'; path: string }
  | { type: 'open-project'; projectPath: string };

const appShell = {
  getCapabilities: () => ({
    platform: 'desktop' as const,
    localRuntime: true,
    terminal: true,
    projectShell: true,
    autoUpdate: true,
    speechToText: true,
  }),
  getSetting: (key: string): Promise<unknown> => ipcRenderer.invoke('app:get-setting', key),
  setSetting: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('app:set-setting', { key, value }),
  getAppState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('app:get-state'),
  setAppState: (state: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('app:set-state', state),
  debugLog: (payload: { message: string; details?: unknown }): Promise<boolean> =>
    ipcRenderer.invoke('app:debug-log', payload) as Promise<boolean>,
  logEvent: (payload: {
    domain: string;
    action: string;
    phase?: string;
    status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
    level?: 'debug' | 'info' | 'warn' | 'error';
    correlationId?: string;
    fingerprint?: string;
    durationMs?: number;
    duplicateCount?: number;
    data?: Record<string, unknown>;
  }): Promise<boolean> =>
    ipcRenderer.invoke('app:log-event', payload) as Promise<boolean>,
  getObservabilityEvents: (): Promise<Array<{
    ts: string;
    domain: string;
    action: string;
    phase?: string;
    status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
    correlationId?: string;
    fingerprint?: string;
    durationMs?: number;
    duplicateCount?: number;
    data?: Record<string, unknown>;
  }>> =>
    ipcRenderer.invoke('app:get-observability-events') as Promise<Array<{
      ts: string;
      domain: string;
      action: string;
      phase?: string;
      status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
      correlationId?: string;
      fingerprint?: string;
      durationMs?: number;
      duplicateCount?: number;
      data?: Record<string, unknown>;
    }>>,
  clearObservabilityEvents: (): Promise<boolean> =>
    ipcRenderer.invoke('app:clear-observability-events') as Promise<boolean>,
  onObservabilityEvent: (listener: (payload: {
    ts: string;
    domain: string;
    action: string;
    phase?: string;
    status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
    correlationId?: string;
    fingerprint?: string;
    durationMs?: number;
    duplicateCount?: number;
    data?: Record<string, unknown>;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      ts: string;
      domain: string;
      action: string;
      phase?: string;
      status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
      correlationId?: string;
      fingerprint?: string;
      durationMs?: number;
      duplicateCount?: number;
      data?: Record<string, unknown>;
    }) => listener(payload);
    ipcRenderer.on('app:observability-event', wrapped);
    return () => ipcRenderer.off('app:observability-event', wrapped);
  },
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:open-external-url', { url }),
  openProjectDialog: (): Promise<string | null> => ipcRenderer.invoke('app:open-project-dialog'),
  openFileDialog: (): Promise<string | null> => ipcRenderer.invoke('app:open-file-dialog'),
  openDocumentDialog: (payload?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null> => ipcRenderer.invoke('app:open-document-dialog', payload),
  openDocumentTarget: (payload: { target: string }) =>
    ipcRenderer.invoke('app:open-document-target', payload) as Promise<{
      ok: boolean;
      sourceUrl?: string;
      resolvedUrl?: string;
      surface?: string;
      adapter?: string;
      access?: 'editable' | 'read-only' | 'converted';
      isEditable?: boolean;
      sessionId?: string | null;
      reason?: string;
      error?: string;
    }>,
  documentCreateSession: (payload: { pathOrUrl: string; preferEdit?: boolean }) =>
    ipcRenderer.invoke('document:create-session', payload) as Promise<{
      ok: boolean;
      sourceUrl?: string;
      resolvedUrl?: string;
      surface?: string;
      adapter?: string;
      access?: 'editable' | 'read-only' | 'converted';
      isEditable?: boolean;
      sessionId?: string | null;
      reason?: string;
      error?: string;
    }>,
  documentSaveSession: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('document:save-session', payload) as Promise<{
      ok: boolean;
      saved?: boolean;
      backupPath?: string | null;
      conflictDetected?: boolean;
      error?: string;
    }>,
  documentCloseSession: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('document:close-session', payload) as Promise<{ ok: boolean; closed: boolean }>,
  documentGetCapabilities: () =>
    ipcRenderer.invoke('document:get-capabilities') as Promise<{
      officeEditing: {
        enabled: boolean;
        available: boolean;
        serverUrl: string | null;
        supportedExtensions: string[];
        reason?: string;
      };
      previewFallback: {
        enabled: boolean;
        converterAvailable: boolean;
        converterCommand: string | null;
      };
    }>,
  openProjectTarget: (payload: { projectPath?: string; target: 'vscode' | 'cursor' | 'zed' | 'finder' | 'ghostty' }) =>
    ipcRenderer.invoke('app:open-project-target', payload),
  checkProxyHealth: (payload: { baseUrl: string; authToken?: string }) =>
    ipcRenderer.invoke('proxy:check-health', payload) as Promise<{
      healthy: boolean;
      latency_ms: number | null;
      status_code: number | null;
      error: string;
    }>,
  getProxyOauthUrl: (payload: { provider: 'claude' | 'openai' | 'gemini'; baseUrl: string; authToken?: string }) =>
    ipcRenderer.invoke('proxy:get-oauth-url', payload) as Promise<{ url: string; state: string }>,
  pollProxyOauthStatus: (payload: { baseUrl: string; state: string; authToken?: string }) =>
    ipcRenderer.invoke('proxy:poll-oauth-status', payload) as Promise<boolean>,
  refreshProxyAuthStatus: () =>
    ipcRenderer.invoke('proxy:refresh-auth-status', {}) as Promise<{ claude: number; openai: number; gemini: number }>,
  startTerminal: (payload: { cwd?: string }) =>
    ipcRenderer.invoke('terminal:start', payload) as Promise<{ sessionId: string; cwd: string }>,
  writeTerminal: (payload: { sessionId: string; input: string }) =>
    ipcRenderer.invoke('terminal:write', payload) as Promise<boolean>,
  resizeTerminal: (payload: { sessionId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', payload) as Promise<boolean>,
  stopTerminal: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('terminal:stop', payload) as Promise<boolean>,
  onTerminalOutput: (listener: (payload: TerminalOutputPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalOutputPayload) =>
      listener(payload);
    ipcRenderer.on('terminal:output', wrapped);
    return () => ipcRenderer.off('terminal:output', wrapped);
  },
  onTerminalExit: (listener: (payload: TerminalExitPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalExitPayload) =>
      listener(payload);
    ipcRenderer.on('terminal:exit', wrapped);
    return () => ipcRenderer.off('terminal:exit', wrapped);
  },
  onMenuCommand: (listener: (payload: MenuCommandPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: MenuCommandPayload) =>
      listener(payload);
    ipcRenderer.on('menu:command', wrapped);
    return () => ipcRenderer.off('menu:command', wrapped);
  },
  gatewayGetState: () =>
    ipcRenderer.invoke('gateway:get-state') as Promise<GatewayStateSnapshot>,
  gatewayEnableOpenclaw: () =>
    ipcRenderer.invoke('gateway:enable-openclaw') as Promise<GatewayStateSnapshot>,
  gatewayDisableOpenclaw: () =>
    ipcRenderer.invoke('gateway:disable-openclaw') as Promise<GatewayStateSnapshot>,
  gatewayConnect: () =>
    ipcRenderer.invoke('gateway:connect') as Promise<GatewayStateSnapshot>,
  gatewayDisconnect: () =>
    ipcRenderer.invoke('gateway:disconnect') as Promise<GatewayStateSnapshot>,
  gatewayConnectRemote: (settings: GatewayRemoteSettings) =>
    ipcRenderer.invoke('gateway:connect-remote', settings) as Promise<GatewayStateSnapshot>,
  gatewayGetRemoteSettings: () =>
    ipcRenderer.invoke('gateway:get-remote-settings') as Promise<GatewayRemoteSettings>,
  gatewayGetDevices: () =>
    ipcRenderer.invoke('gateway:get-devices') as Promise<GatewayNodeListResponse>,
  gatewayGetChatHistory: (payload: GatewayChatHistoryRequest) =>
    ipcRenderer.invoke('gateway:get-chat-history', payload) as Promise<GatewayChatHistoryResponse>,
  gatewaySendChat: (payload: GatewaySendChatRequest) =>
    ipcRenderer.invoke('gateway:send-chat', payload) as Promise<GatewaySendChatResponse>,
  gatewayAbortChat: (payload: GatewayAbortChatRequest) =>
    ipcRenderer.invoke('gateway:abort-chat', payload) as Promise<GatewayAbortChatResponse>,
  gatewayDebugCloudSnapshot: (payload?: { limit?: number; sessionId?: string; includeR2?: boolean }) =>
    ipcRenderer.invoke('gateway:debug-cloud-snapshot', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  gatewayConnectCloud: (payload: { token: string; wsDomain?: string }) =>
    ipcRenderer.invoke('gateway:connect-cloud', payload) as Promise<unknown>,
  onGatewayState: (listener: (payload: GatewayStateSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: GatewayStateSnapshot) => {
      listener(payload);
    };
    ipcRenderer.on('gateway:state', wrapped);
    return () => ipcRenderer.off('gateway:state', wrapped);
  },
  onGatewayEvent: (listener: (payload: GatewayPushEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: GatewayPushEvent) => {
      listener(payload);
    };
    ipcRenderer.on('gateway:event', wrapped);
    return () => ipcRenderer.off('gateway:event', wrapped);
  },
  pipelinePushClerkToken: (payload: { token: string }) =>
    ipcRenderer.invoke('pipeline:push-clerk-token', payload) as Promise<{ ok: boolean }>,
  pipelineSetActiveUser: (payload: { userId: string; tenantId?: string; clerkToken?: string }) =>
    ipcRenderer.invoke('pipeline:set-active-user', payload) as Promise<{
      activeUserId: string | null;
      profileRoot: string | null;
      stateDir: string | null;
      configPath: string | null;
      status: 'stopped' | 'starting' | 'running' | 'failed';
      detail: string;
      launcherLabel: string | null;
      pid: number | null;
      startedAtMs: number | null;
      gatewayProbe: {
        checkedAtMs: number;
        port: number;
        reachable: boolean;
        detail: string;
      };
      gatewayStatus: {
        checkedAtMs: number;
        ok: boolean;
        detail: string;
        output: string;
      };
      logTail: string[];
    }>,
  pipelineGetLocalOpenclawStatus: () =>
    ipcRenderer.invoke('pipeline:get-local-openclaw-status') as Promise<{
      activeUserId: string | null;
      profileRoot: string | null;
      stateDir: string | null;
      configPath: string | null;
      status: 'stopped' | 'starting' | 'running' | 'failed';
      detail: string;
      launcherLabel: string | null;
      pid: number | null;
      startedAtMs: number | null;
      gatewayProbe: {
        checkedAtMs: number;
        port: number;
        reachable: boolean;
        detail: string;
      };
      gatewayStatus: {
        checkedAtMs: number;
        ok: boolean;
        detail: string;
        output: string;
      };
      logTail: string[];
    }>,
  pipelineCheckOpenclawRuntime: () =>
    ipcRenderer.invoke('pipeline:check-openclaw-runtime') as Promise<{
      checkedAtMs: number;
      packagedOnly: boolean;
      expectedBinaryName: string;
      expectedPaths: string[];
      foundPaths: string[];
      candidates: Array<{
        label: string;
        command: string;
        cwd: string | null;
      }>;
      hasRuntime: boolean;
      detail: string;
    }>,
  pipelineStartLocalOpenclaw: () =>
    ipcRenderer.invoke('pipeline:start-local-openclaw') as Promise<{
      status: 'stopped' | 'starting' | 'running' | 'failed';
      detail: string;
      pid: number | null;
    }>,
  pipelineStopLocalOpenclaw: () =>
    ipcRenderer.invoke('pipeline:stop-local-openclaw') as Promise<{
      status: 'stopped' | 'starting' | 'running' | 'failed';
      detail: string;
    }>,
  pipelineLaunchProviderOAuth: (payload: { provider: string }) =>
    ipcRenderer.invoke('pipeline:launch-provider-oauth', payload) as Promise<{
      sessionId: string;
      provider?: string;
      status: 'starting' | 'awaiting_auth' | 'awaiting_input' | 'completing' | 'completed' | 'failed';
      authUrl: string | null;
      instructions?: string | null;
      promptMessage?: string | null;
      promptPlaceholder?: string | null;
      promptAllowEmpty?: boolean;
      detail: string;
    }>,
  pipelineOAuthSubmitInput: (payload: { sessionId: string; inputValue: string }) =>
    ipcRenderer.invoke('pipeline:oauth-submit-input', payload) as Promise<{ ok: boolean }>,
  pipelineOAuthStatus: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('pipeline:oauth-status', payload) as Promise<{
      found: boolean;
      sessionId?: string;
      provider?: string;
      status?: 'starting' | 'awaiting_auth' | 'awaiting_input' | 'completing' | 'completed' | 'failed';
      authUrl?: string | null;
      instructions?: string | null;
      promptMessage?: string | null;
      promptPlaceholder?: string | null;
      promptAllowEmpty?: boolean;
      detail?: string;
      profileId?: string | null;
    }>,
  pipelineOAuthCancel: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('pipeline:oauth-cancel', payload) as Promise<{ ok: boolean; found: boolean }>,
  pipelineSaveProviderToken: (payload: { provider: string; token: string }) =>
    ipcRenderer.invoke('pipeline:save-provider-token', payload) as Promise<{ ok: boolean; profileId: string }>,
  pipelineDeleteProviderToken: (payload: { provider: string }) =>
    ipcRenderer.invoke('pipeline:delete-provider-token', payload) as Promise<{
      ok: boolean;
      provider: string;
      removedProfiles: string[];
      removedCount: number;
    }>,
  pipelineRefreshLocalCredentialCache: (payload: { provider: string }) =>
    ipcRenderer.invoke('pipeline:refresh-local-credential-cache', payload) as Promise<{
      ok: boolean;
      provider: string;
      profileId: string;
      type: 'oauth' | 'token';
    }>,
  pipelineRemoveLocalCredentialCache: (payload: { provider: string }) =>
    ipcRenderer.invoke('pipeline:remove-local-credential-cache', payload) as Promise<{
      ok: boolean;
      provider: string;
      aliases: string[];
      removedProfiles: string[];
      removedCount: number;
    }>,
  pipelineCheckLocalProviderReady: (payload: {
    provider: string;
    capabilityProbe?: boolean;
    model?: string;
  }) =>
    ipcRenderer.invoke('pipeline:check-local-provider-ready', payload) as Promise<{
      ready: boolean;
      local: boolean;
      capabilityChecked?: boolean;
      reason?: string;
    }>,
  pipelineEnsureProviderReady: (payload: {
    provider: string;
    runtime: 'local' | 'cloud' | 'auto';
    capabilityProbe?: boolean;
    model?: string;
  }) =>
    ipcRenderer.invoke('pipeline:ensure-provider-ready', payload) as Promise<{
      ready: boolean;
      local: boolean;
      cloud: boolean;
      healed: boolean;
      reason?: string;
    }>,
  pipelineRecheckProviderStatus: (payload: {
    provider: string;
    runtime: 'local' | 'cloud' | 'auto';
    capabilityProbe?: boolean;
    model?: string;
  }) =>
    ipcRenderer.invoke('pipeline:recheck-provider-status', payload) as Promise<{
      ready: boolean;
      local: boolean;
      cloud: boolean;
      healed: boolean;
      reason?: string;
    }>,
  pipelineChatSend: (payload: {
    provider: string;
    runtime: 'local' | 'cloud' | 'auto';
    model: string;
    sessionId: string;
    message: string;
    attachments?: Array<{
      type: 'image';
      mimeType: string;
      content: string;
      fileName?: string;
    }>;
    idempotencyKey: string;
  }) =>
    ipcRenderer.invoke('pipeline:chat-send', payload) as Promise<{
      ok: boolean;
      runId?: string;
      status?: string;
      healed?: boolean;
      error?: string;
      blockedBy?: string;
    }>,
  pipelineListProviderModels: (payload: { provider: string }) =>
    ipcRenderer.invoke('pipeline:list-provider-models', payload) as Promise<{
      provider: string;
      models: Array<{ id: string; label: string }>;
    }>,
  pipelineListAuthProfiles: () =>
    ipcRenderer.invoke('pipeline:list-auth-profiles') as Promise<Array<{
      profileId: string;
      provider: string;
      type: string;
      hasAccess: boolean;
      hasRefresh: boolean;
      expires: number | null;
      email: string | null;
    }>>,
  pipelineGetAuthStoreDiagnostics: () =>
    ipcRenderer.invoke('pipeline:get-auth-store-diagnostics') as Promise<{
      authStorePath: string | null;
      exists: boolean;
      profileCount: number;
      profiles: Array<{
        profileId: string;
        provider: string;
        type: string;
        hasAccess: boolean;
        hasRefresh: boolean;
        expires: number | null;
        email: string | null;
      }>;
    }>,
  pipelineGetAuthProfileSecret: (payload: { profileId: string }) =>
    ipcRenderer.invoke('pipeline:get-auth-profile-secret', payload) as Promise<{
      profileId: string;
      provider: string;
      token: string;
      tokenPreview: string;
      tokenLength: number;
      type: string;
    }>,
  pipelineProbeChannel: (payload: { channelId: string }) =>
    ipcRenderer.invoke('pipeline:probe-channel', payload) as Promise<{
      ok: boolean;
      channelId: string;
      probe: {
        ok: boolean;
        skipped?: boolean;
        elapsedMs?: number;
        bot?: { id?: string; username?: string };
        error?: string;
      } | null;
    }>,
  pipelineGetChannelStatus: (payload: { channelId: string }) =>
    ipcRenderer.invoke('pipeline:get-channel-status', payload) as Promise<{
      ok: boolean;
      found?: boolean;
      channel?: { id: string; type: string; isActive: boolean; createdAt: number };
      health?: { recentJobCount: number; completed: number; failed: number; queued: number; lastActivity: number | null; lastError: string | null };
      reason?: string;
    }>,
  pipelineUpsertHookRoute: (payload: HookRouteUpsertPayload) =>
    ipcRenderer.invoke('pipeline:upsert-hook-route', payload) as Promise<HookRouteUpsertResult>,
  pipelineDeleteHookRoute: (payload: { name: string }) =>
    ipcRenderer.invoke('pipeline:delete-hook-route', payload) as Promise<HookRouteDeleteResult>,
  pipelineListHookEvents: (payload?: { limit?: number }) =>
    ipcRenderer.invoke('pipeline:list-hook-events', payload) as Promise<HookEventListResult>,
  pipelineUpsertHookAgent: (payload: HookAgentUpsertPayload) =>
    ipcRenderer.invoke('pipeline:upsert-hook-agent', payload) as Promise<HookAgentUpsertResult>,
  pipelineDeleteHookAgent: (payload: { agentId: string }) =>
    ipcRenderer.invoke('pipeline:delete-hook-agent', payload) as Promise<HookAgentDeleteResult>,
  pipelineListMailboxes: () =>
    ipcRenderer.invoke('pipeline:list-mailboxes') as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineConnectMailbox: (payload: {
    action: 'start' | 'complete' | 'disconnect';
    provider?: string;
    mailboxId?: string;
    accountId?: string;
    sessionId?: string;
    externalAccountId?: string;
    tokenRef?: string;
    scopes?: string[];
    redirectUri?: string;
  }) =>
    ipcRenderer.invoke('pipeline:connect-mailbox', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineProvisionCapzeroMailbox: (payload: {
    mailboxId?: string;
    displayName?: string;
    primaryAddress?: string;
    domain?: string;
  }) =>
    ipcRenderer.invoke('pipeline:provision-capzero-mailbox', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineListMailThreads: (payload?: { mailboxId?: string; limit?: number; beforeTs?: number }) =>
    ipcRenderer.invoke('pipeline:list-mail-threads', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineGetMailThread: (payload: { threadId: string; limit?: number }) =>
    ipcRenderer.invoke('pipeline:get-mail-thread', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineCreateMailAlias: (payload: {
    mailboxId: string;
    address?: string;
    label?: string;
    purpose?: string;
    routingPolicy?: Record<string, unknown>;
    spamScore?: number;
  }) =>
    ipcRenderer.invoke('pipeline:create-mail-alias', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineBurnMailAlias: (payload: { aliasId: string; restore?: boolean }) =>
    ipcRenderer.invoke('pipeline:burn-mail-alias', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineUploadMailAttachment: (payload: {
    action: 'init' | 'complete' | 'downloadUrl';
    mailboxId?: string;
    messageId?: string;
    fileName?: string;
    contentType?: string;
    sizeBytes?: number;
    sha256?: string;
    attachmentId?: string;
    scanStatus?: string;
  }) =>
    ipcRenderer.invoke('pipeline:upload-mail-attachment', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineSendMailDraft: (payload: { draftId: string; provider?: string; idempotencyKey?: string }) =>
    ipcRenderer.invoke('pipeline:send-mail-draft', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  pipelineGetMailHealth: (payload?: { mailboxId?: string }) =>
    ipcRenderer.invoke('pipeline:get-mail-health', payload) as Promise<{
      ok: boolean;
      reason?: string;
      payload?: unknown;
    }>,
  devOrchestratorList: () =>
    ipcRenderer.invoke('dev-orchestrator:list') as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      migrationInfo?: {
        migrated: boolean;
        sourceSchema: 'legacy-instances' | 'default-created' | 'example-promoted';
        message: string;
      };
      reason?: string;
    }>,
  devOrchestratorStart: (payload?: {
    scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
    services?: Array<'cloud' | 'app'>;
  }) =>
    ipcRenderer.invoke('dev-orchestrator:start', payload ?? {}) as Promise<{
      ok: boolean;
      supported: boolean;
      action: 'start' | 'stop' | 'restart' | 'delete';
      scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      services: Array<'cloud' | 'app'>;
      affected: string[];
      skipped: Array<{ name: string; reason: string }>;
      reason?: string;
    }>,
  devOrchestratorStop: (payload?: {
    scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
    services?: Array<'cloud' | 'app'>;
  }) =>
    ipcRenderer.invoke('dev-orchestrator:stop', payload ?? {}) as Promise<{
      ok: boolean;
      supported: boolean;
      action: 'start' | 'stop' | 'restart' | 'delete';
      scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      services: Array<'cloud' | 'app'>;
      affected: string[];
      skipped: Array<{ name: string; reason: string }>;
      reason?: string;
    }>,
  devOrchestratorRestart: (payload?: {
    scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
    services?: Array<'cloud' | 'app'>;
  }) =>
    ipcRenderer.invoke('dev-orchestrator:restart', payload ?? {}) as Promise<{
      ok: boolean;
      supported: boolean;
      action: 'start' | 'stop' | 'restart' | 'delete';
      scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      services: Array<'cloud' | 'app'>;
      affected: string[];
      skipped: Array<{ name: string; reason: string }>;
      reason?: string;
    }>,
  devOrchestratorDelete: (payload?: { scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string } }) =>
    ipcRenderer.invoke('dev-orchestrator:delete', payload ?? {}) as Promise<{
      ok: boolean;
      supported: boolean;
      action: 'start' | 'stop' | 'restart' | 'delete';
      scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      affected: string[];
      skipped: Array<{ name: string; reason: string }>;
      reason?: string;
    }>,
  devOrchestratorLogs: (payload: { processName: string; lines?: number }) =>
    ipcRenderer.invoke('dev-orchestrator:logs', payload) as Promise<{
      ok: boolean;
      supported: boolean;
      processName: string;
      lines: number;
      stdout: string[];
      stderr: string[];
      reason?: string;
    }>,
  devOrchestratorLiveLogs: (payload: {
    processName: string;
    fromNow?: boolean;
    maxBytes?: number;
    cursor?: { stdoutOffset: number; stderrOffset: number };
  }) =>
    ipcRenderer.invoke('dev-orchestrator:logs-live', payload) as Promise<{
      ok: boolean;
      supported: boolean;
      processName: string;
      stdout: string[];
      stderr: string[];
      cursor: { stdoutOffset: number; stderrOffset: number };
      reason?: string;
    }>,
  devOrchestratorWranglerLogs: (payload?: { cloudPort?: number; lines?: number }) =>
    ipcRenderer.invoke('dev-orchestrator:wrangler-logs', payload ?? {}) as Promise<{
      ok: boolean;
      supported: boolean;
      sourcePath: string | null;
      lines: number;
      entries: string[];
      reason?: string;
    }>,
  devOrchestratorHealth: () =>
    ipcRenderer.invoke('dev-orchestrator:health') as Promise<{
      ok: boolean;
      supported: boolean;
      pm2Connected: boolean;
      hasLocalConfig: boolean;
      hasExampleConfig: boolean;
      hasGeneratedEcosystem: boolean;
      configPath: string;
      ecosystemPath: string;
      worktreeCount: number;
      enabledCount: number;
      migrationInfo?: {
        migrated: boolean;
        sourceSchema: 'legacy-instances' | 'default-created' | 'example-promoted';
        message: string;
      };
      reason?: string;
    }>,
  devOrchestratorRescan: () =>
    ipcRenderer.invoke('dev-orchestrator:rescan') as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      migrationInfo?: {
        migrated: boolean;
        sourceSchema: 'legacy-instances' | 'default-created' | 'example-promoted';
        message: string;
      };
      reason?: string;
    }>,
  devOrchestratorSetWorktreeEnabled: (payload: { worktreeKey: string; enabled: boolean }) =>
    ipcRenderer.invoke('dev-orchestrator:set-worktree-enabled', payload) as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      reason?: string;
    }>,
  devOrchestratorSetWorktreeProfile: (payload: { worktreeKey: string; profile?: string | null }) =>
    ipcRenderer.invoke('dev-orchestrator:set-worktree-profile', payload) as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      reason?: string;
    }>,
  devOrchestratorSetWorktreeLabel: (payload: { worktreeKey: string; label?: string | null }) =>
    ipcRenderer.invoke('dev-orchestrator:set-worktree-label', payload) as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      reason?: string;
    }>,
  devOrchestratorCleanupStale: () =>
    ipcRenderer.invoke('dev-orchestrator:cleanup-stale') as Promise<{
      ok: boolean;
      supported: boolean;
      updatedAtMs: number;
      configPath: string;
      ecosystemPath: string;
      discoveredWorktrees: Array<{
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: string; app: string };
        blockedReason?: string;
      }>;
      processes: Array<{
        name: string;
        worktreeKey: string;
        kind: 'cloud' | 'app';
        status: string;
        pid: number | null;
        cpu: number;
        memory: number;
        uptimeMs: number | null;
        cwd: string;
        cloudPort: number;
        appPort: number;
        outLogPath: string | null;
        errLogPath: string | null;
      }>;
      profiles: string[];
      portPolicy: {
        cloudRange: { start: number; end: number };
        appRange: { start: number; end: number };
        stable: boolean;
      };
      reason?: string;
    }>,
  devOrchestratorStartCurrentWorktreeCloud: () =>
    ipcRenderer.invoke('dev-orchestrator:start-current-worktree-cloud') as Promise<{
      ok: boolean;
      supported: boolean;
      action: 'start' | 'stop' | 'restart' | 'delete';
      scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      services: Array<'cloud' | 'app'>;
      affected: string[];
      skipped: Array<{ name: string; reason: string }>;
      reason?: string;
    }>,
  devOrchestratorStatusCurrentWorktree: () =>
    ipcRenderer.invoke('dev-orchestrator:status-current-worktree') as Promise<{
      ok: boolean;
      supported: boolean;
      worktreeKey: string | null;
      appOwnership: 'pm2' | 'external' | 'none';
      cloudOwnership: 'pm2' | 'external' | 'none';
      row: {
        worktreeKey: string;
        path: string;
        branch: string;
        enabled: boolean;
        stale: boolean;
        valid: boolean;
        profile: string | null;
        profileSource: 'override' | 'rule' | 'default' | 'invalid';
        label: string;
        ports: { cloudPort: number | null; appPort: number | null };
        userDataDir: string;
        cloudProcessName: string;
        appProcessName: string;
        status: { cloud: 'online' | 'launching' | 'stopped' | 'blocked' | 'external' | 'error'; app: 'online' | 'launching' | 'stopped' | 'blocked' | 'external' | 'error' };
        blockedReason?: string;
        blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
      } | null;
      reason?: string;
    }>,
  devOrchestratorCloudHealthProbe: (payload: { port: number }) =>
    ipcRenderer.invoke('dev-orchestrator:cloud-health-probe', payload) as Promise<{
      ok: boolean;
      status: number | null;
      body: Record<string, unknown> | null;
      error?: string;
    }>,
  checkForUpdate: () =>
    ipcRenderer.invoke('app:update-check') as Promise<{ available: boolean; version: string | null }>,
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('app:update-install'),
  onUpdateAvailable: (listener: (payload: { version: string; releaseNotes: string | null }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { version: string; releaseNotes: string | null }) =>
      listener(payload);
    ipcRenderer.on('app:update-available', wrapped);
    return () => ipcRenderer.off('app:update-available', wrapped);
  },
  onUpdateDownloaded: (listener: (payload: { version: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { version: string }) =>
      listener(payload);
    ipcRenderer.on('app:update-downloaded', wrapped);
    return () => ipcRenderer.off('app:update-downloaded', wrapped);
  },
  sttGetStatus: () =>
    ipcRenderer.invoke('stt:getStatus') as Promise<{
      state: 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error';
      modelDownloaded: boolean;
      detail?: string;
    }>,
  sttEnsureReady: () =>
    ipcRenderer.invoke('stt:ensureReady') as Promise<{ ready: boolean; error?: string }>,
  sttStartListening: () =>
    ipcRenderer.invoke('stt:startListening') as Promise<{ sessionId: string }>,
  sttStopListening: () =>
    ipcRenderer.invoke('stt:stopListening') as Promise<{ finalTranscript: string }>,
  sttCancelListening: () =>
    ipcRenderer.invoke('stt:cancelListening') as Promise<void>,
  sttSendAudio: (payload: { sessionId: string; pcm: ArrayBuffer }) => {
    ipcRenderer.send('stt:audio', payload);
  },
  onSttStatus: (listener: (payload: { state: 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error'; detail?: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { state: 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error'; detail?: string }) =>
      listener(payload);
    ipcRenderer.on('stt:status', wrapped);
    return () => ipcRenderer.off('stt:status', wrapped);
  },
  onSttDownloadProgress: (listener: (payload: { percent: number; bytesDownloaded: number; bytesTotal: number }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { percent: number; bytesDownloaded: number; bytesTotal: number }) =>
      listener(payload);
    ipcRenderer.on('stt:downloadProgress', wrapped);
    return () => ipcRenderer.off('stt:downloadProgress', wrapped);
  },
  onSttTranscript: (listener: (payload: { sessionId: string; transcript: string; isFinal: boolean }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; transcript: string; isFinal: boolean }) =>
      listener(payload);
    ipcRenderer.on('stt:transcript', wrapped);
    return () => ipcRenderer.off('stt:transcript', wrapped);
  },
};

contextBridge.exposeInMainWorld('appShell', appShell);
