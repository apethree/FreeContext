import type {
  GatewayAbortChatRequest,
  GatewayAbortChatResponse,
  GatewayChatAttachment,
  GatewayChatHistoryRequest,
  GatewayChatHistoryResponse,
  GatewayNodeListResponse,
  GatewayPushEvent,
  GatewayRemoteSettings,
  GatewaySendChatRequest,
  GatewaySendChatResponse,
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
import type { AppCapabilities } from '@/lib/appCapabilities';

export {};

declare global {
  interface Window {
    appShell: {
      getCapabilities: () => AppCapabilities;
      getSetting: (key: string) => Promise<unknown>;
      setSetting: (key: string, value: unknown) => Promise<void>;
      getAppState: () => Promise<Record<string, unknown>>;
      setAppState: (state: Record<string, unknown>) => Promise<void>;
      debugLog: (payload: { message: string; details?: unknown }) => Promise<boolean>;
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
      }) => Promise<boolean>;
      getObservabilityEvents: () => Promise<Array<{
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
      }>>;
      clearObservabilityEvents: () => Promise<boolean>;
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
      }) => void) => () => void;
      openExternalUrl: (url: string) => Promise<void>;
      openProjectDialog: () => Promise<string | null>;
      openFileDialog: () => Promise<string | null>;
      openDocumentDialog: (payload?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<string | null>;
      openDocumentTarget: (payload: { target: string }) => Promise<{
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
      }>;
      documentCreateSession: (payload: { pathOrUrl: string; preferEdit?: boolean }) => Promise<{
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
      }>;
      documentSaveSession: (payload: { sessionId: string }) => Promise<{
        ok: boolean;
        saved?: boolean;
        backupPath?: string | null;
        conflictDetected?: boolean;
        error?: string;
      }>;
      documentCloseSession: (payload: { sessionId: string }) => Promise<{ ok: boolean; closed: boolean }>;
      documentGetCapabilities: () => Promise<{
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
      }>;
      openProjectTarget: (payload: {
        projectPath?: string;
        target: 'vscode' | 'cursor' | 'zed' | 'finder' | 'ghostty';
      }) => Promise<boolean>;
      checkProxyHealth: (payload: { baseUrl: string; authToken?: string }) => Promise<{
        healthy: boolean;
        latency_ms: number | null;
        status_code: number | null;
        error: string;
      }>;
      getProxyOauthUrl: (payload: { provider: 'claude' | 'openai' | 'gemini'; baseUrl: string; authToken?: string }) => Promise<{ url: string; state: string }>;
      pollProxyOauthStatus: (payload: { baseUrl: string; state: string; authToken?: string }) => Promise<boolean>;
      refreshProxyAuthStatus: () => Promise<{ claude: number; openai: number; gemini: number }>;
      startTerminal: (payload: { cwd?: string }) => Promise<{ sessionId: string; cwd: string }>;
      writeTerminal: (payload: { sessionId: string; input: string }) => Promise<boolean>;
      resizeTerminal: (payload: { sessionId: string; cols: number; rows: number }) => Promise<boolean>;
      stopTerminal: (payload: { sessionId: string }) => Promise<boolean>;
      onTerminalOutput: (listener: (payload: {
        sessionId: string;
        data: string;
        stream: 'stdout' | 'stderr';
      }) => void) => () => void;
      onTerminalExit: (listener: (payload: {
        sessionId: string;
        code: number | null;
        signal: string | null;
      }) => void) => () => void;
      onMenuCommand: (listener: (payload: {
        type: 'navigate';
        path: string;
      } | {
        type: 'open-project';
        projectPath: string;
      }) => void) => () => void;
      gatewayGetState: () => Promise<GatewayStateSnapshot>;
      gatewayEnableOpenclaw: () => Promise<GatewayStateSnapshot>;
      gatewayDisableOpenclaw: () => Promise<GatewayStateSnapshot>;
      gatewayConnect: () => Promise<GatewayStateSnapshot>;
      gatewayConnectRemote: (settings: GatewayRemoteSettings) => Promise<GatewayStateSnapshot>;
      gatewayGetRemoteSettings: () => Promise<GatewayRemoteSettings>;
      gatewayDisconnect: () => Promise<GatewayStateSnapshot>;
      gatewayGetDevices: () => Promise<GatewayNodeListResponse>;
      gatewayGetChatHistory: (payload: GatewayChatHistoryRequest) => Promise<GatewayChatHistoryResponse>;
      gatewaySendChat: (payload: GatewaySendChatRequest) => Promise<GatewaySendChatResponse>;
      gatewayAbortChat: (payload: GatewayAbortChatRequest) => Promise<GatewayAbortChatResponse>;
      gatewayDebugCloudSnapshot: (payload?: {
        limit?: number;
        sessionId?: string;
        includeR2?: boolean;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      gatewayConnectCloud: (payload: { token: string; wsDomain?: string }) => Promise<unknown>;
      onGatewayState: (listener: (payload: GatewayStateSnapshot) => void) => () => void;
      onGatewayEvent: (listener: (payload: GatewayPushEvent) => void) => () => void;
      pipelinePushClerkToken: (payload: { token: string }) => Promise<{ ok: boolean }>;
      pipelineSetActiveUser: (payload: { userId: string; tenantId?: string; clerkToken?: string }) => Promise<{
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
      }>;
      pipelineGetLocalOpenclawStatus: () => Promise<{
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
      }>;
      pipelineCheckOpenclawRuntime: () => Promise<{
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
      }>;
      pipelineStartLocalOpenclaw: () => Promise<{
        status: 'stopped' | 'starting' | 'running' | 'failed';
        detail: string;
        pid: number | null;
      }>;
      pipelineStopLocalOpenclaw: () => Promise<{
        status: 'stopped' | 'starting' | 'running' | 'failed';
        detail: string;
      }>;
      pipelineLaunchProviderOAuth: (payload: { provider: string }) => Promise<{
        sessionId: string;
        provider?: string;
        status: 'starting' | 'awaiting_auth' | 'awaiting_input' | 'completing' | 'completed' | 'failed';
        authUrl: string | null;
        instructions?: string | null;
        promptMessage?: string | null;
        promptPlaceholder?: string | null;
        promptAllowEmpty?: boolean;
        detail: string;
      }>;
      pipelineOAuthSubmitInput: (payload: { sessionId: string; inputValue: string }) => Promise<{ ok: boolean }>;
      pipelineOAuthStatus: (payload: { sessionId: string }) => Promise<{
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
      }>;
      pipelineOAuthCancel: (payload: { sessionId: string }) => Promise<{ ok: boolean; found: boolean }>;
      pipelineSaveProviderToken: (payload: { provider: string; token: string }) => Promise<{ ok: boolean; profileId: string }>;
      pipelineDeleteProviderToken: (payload: { provider: string }) => Promise<{
        ok: boolean;
        provider: string;
        removedProfiles: string[];
        removedCount: number;
      }>;
      pipelineRefreshLocalCredentialCache: (payload: { provider: string }) => Promise<{
        ok: boolean;
        provider: string;
        profileId: string;
        type: 'oauth' | 'token';
      }>;
      pipelineRemoveLocalCredentialCache: (payload: { provider: string }) => Promise<{
        ok: boolean;
        provider: string;
        aliases: string[];
        removedProfiles: string[];
        removedCount: number;
      }>;
      pipelineCheckLocalProviderReady: (payload: {
        provider: string;
        capabilityProbe?: boolean;
        model?: string;
      }) => Promise<{
        ready: boolean;
        local: boolean;
        capabilityChecked?: boolean;
        reason?: string;
      }>;
      pipelineEnsureProviderReady: (payload: {
        provider: string;
        runtime: 'local' | 'cloud' | 'auto';
        capabilityProbe?: boolean;
        model?: string;
      }) => Promise<{
        ready: boolean;
        local: boolean;
        cloud: boolean;
        healed: boolean;
        reason?: string;
      }>;
      pipelineRecheckProviderStatus: (payload: {
        provider: string;
        runtime: 'local' | 'cloud' | 'auto';
        capabilityProbe?: boolean;
        model?: string;
      }) => Promise<{
        ready: boolean;
        local: boolean;
        cloud: boolean;
        healed: boolean;
        reason?: string;
      }>;
      pipelineChatSend: (payload: {
        provider: string;
        runtime: 'local' | 'cloud' | 'auto';
        model: string;
        sessionId: string;
        message: string;
        attachments?: GatewayChatAttachment[];
        idempotencyKey: string;
      }) => Promise<{
        ok: boolean;
        runId?: string;
        status?: string;
        healed?: boolean;
        error?: string;
        blockedBy?: string;
      }>;
      pipelineListProviderModels: (payload: { provider: string }) => Promise<{
        provider: string;
        models: Array<{ id: string; label: string }>;
      }>;
      pipelineListAuthProfiles: () => Promise<Array<{
        profileId: string;
        provider: string;
        type: string;
        hasAccess: boolean;
        hasRefresh: boolean;
        expires: number | null;
        email: string | null;
      }>>;
      pipelineGetAuthStoreDiagnostics: () => Promise<{
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
      }>;
      pipelineGetAuthProfileSecret: (payload: { profileId: string }) => Promise<{
        profileId: string;
        provider: string;
        token: string;
        tokenPreview: string;
        tokenLength: number;
        type: string;
      }>;
      pipelineProbeChannel: (payload: { channelId: string }) => Promise<{
        ok: boolean;
        channelId: string;
        probe: {
          ok: boolean;
          skipped?: boolean;
          elapsedMs?: number;
          bot?: { id?: string; username?: string };
          error?: string;
        } | null;
      }>;
      pipelineGetChannelStatus: (payload: { channelId: string }) => Promise<{
        ok: boolean;
        found?: boolean;
        channel?: { id: string; type: string; isActive: boolean; createdAt: number };
        health?: { recentJobCount: number; completed: number; failed: number; queued: number; lastActivity: number | null; lastError: string | null };
        reason?: string;
      }>;
      pipelineUpsertHookRoute: (payload: HookRouteUpsertPayload) => Promise<HookRouteUpsertResult>;
      pipelineDeleteHookRoute: (payload: { name: string }) => Promise<HookRouteDeleteResult>;
      pipelineListHookEvents: (payload?: { limit?: number }) => Promise<HookEventListResult>;
      pipelineUpsertHookAgent: (payload: HookAgentUpsertPayload) => Promise<HookAgentUpsertResult>;
      pipelineDeleteHookAgent: (payload: { agentId: string }) => Promise<HookAgentDeleteResult>;
      pipelineListMailboxes: () => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
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
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineProvisionCapzeroMailbox: (payload: {
        mailboxId?: string;
        displayName?: string;
        primaryAddress?: string;
        domain?: string;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineListMailThreads: (payload?: {
        mailboxId?: string;
        limit?: number;
        beforeTs?: number;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineGetMailThread: (payload: { threadId: string; limit?: number }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineCreateMailAlias: (payload: {
        mailboxId: string;
        address?: string;
        label?: string;
        purpose?: string;
        routingPolicy?: Record<string, unknown>;
        spamScore?: number;
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineBurnMailAlias: (payload: { aliasId: string; restore?: boolean }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
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
      }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineSendMailDraft: (payload: { draftId: string; provider?: string; idempotencyKey?: string }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      pipelineGetMailHealth: (payload?: { mailboxId?: string }) => Promise<{
        ok: boolean;
        reason?: string;
        payload?: unknown;
      }>;
      devOrchestratorList: () => Promise<{
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
          blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
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
      }>;
      devOrchestratorStart: (payload?: {
        scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services?: Array<'cloud' | 'app'>;
      }) => Promise<{
        ok: boolean;
        supported: boolean;
        action: 'start' | 'stop' | 'restart' | 'delete';
        scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services: Array<'cloud' | 'app'>;
        affected: string[];
        skipped: Array<{ name: string; reason: string }>;
        reason?: string;
      }>;
      devOrchestratorStop: (payload?: {
        scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services?: Array<'cloud' | 'app'>;
      }) => Promise<{
        ok: boolean;
        supported: boolean;
        action: 'start' | 'stop' | 'restart' | 'delete';
        scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services: Array<'cloud' | 'app'>;
        affected: string[];
        skipped: Array<{ name: string; reason: string }>;
        reason?: string;
      }>;
      devOrchestratorRestart: (payload?: {
        scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services?: Array<'cloud' | 'app'>;
      }) => Promise<{
        ok: boolean;
        supported: boolean;
        action: 'start' | 'stop' | 'restart' | 'delete';
        scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        services: Array<'cloud' | 'app'>;
        affected: string[];
        skipped: Array<{ name: string; reason: string }>;
        reason?: string;
      }>;
      devOrchestratorDelete: (payload?: {
        scope?: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
      }) => Promise<{
        ok: boolean;
        supported: boolean;
        action: 'start' | 'stop' | 'restart' | 'delete';
        scope: { type: 'all' } | { type: 'worktree'; worktreeKey: string } | { type: 'process'; processName: string };
        affected: string[];
        skipped: Array<{ name: string; reason: string }>;
        reason?: string;
      }>;
      devOrchestratorLogs: (payload: { processName: string; lines?: number }) => Promise<{
        ok: boolean;
        supported: boolean;
        processName: string;
        lines: number;
        stdout: string[];
        stderr: string[];
        reason?: string;
      }>;
      devOrchestratorLiveLogs: (payload: {
        processName: string;
        fromNow?: boolean;
        maxBytes?: number;
        cursor?: { stdoutOffset: number; stderrOffset: number };
      }) => Promise<{
        ok: boolean;
        supported: boolean;
        processName: string;
        stdout: string[];
        stderr: string[];
        cursor: { stdoutOffset: number; stderrOffset: number };
        reason?: string;
      }>;
      devOrchestratorWranglerLogs: (payload?: { cloudPort?: number; lines?: number }) => Promise<{
        ok: boolean;
        supported: boolean;
        sourcePath: string | null;
        lines: number;
        entries: string[];
        reason?: string;
      }>;
      devOrchestratorHealth: () => Promise<{
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
      }>;
      devOrchestratorRescan: () => ReturnType<Window['appShell']['devOrchestratorList']>;
      devOrchestratorSetWorktreeEnabled: (payload: { worktreeKey: string; enabled: boolean }) => ReturnType<Window['appShell']['devOrchestratorList']>;
      devOrchestratorSetWorktreeProfile: (payload: { worktreeKey: string; profile?: string | null }) => ReturnType<Window['appShell']['devOrchestratorList']>;
      devOrchestratorSetWorktreeLabel: (payload: { worktreeKey: string; label?: string | null }) => ReturnType<Window['appShell']['devOrchestratorList']>;
      devOrchestratorCleanupStale: () => ReturnType<Window['appShell']['devOrchestratorList']>;
      devOrchestratorStartCurrentWorktreeCloud: () => ReturnType<Window['appShell']['devOrchestratorStart']>;
      devOrchestratorStatusCurrentWorktree: () => Promise<{
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
      }>;
      devOrchestratorCloudHealthProbe: (payload: { port: number }) => Promise<{
        ok: boolean;
        status: number | null;
        body: Record<string, unknown> | null;
        error?: string;
      }>;
      checkForUpdate: () => Promise<{ available: boolean; version: string | null }>;
      installUpdate: () => Promise<void>;
      onUpdateAvailable: (listener: (payload: { version: string; releaseNotes: string | null }) => void) => () => void;
      onUpdateDownloaded: (listener: (payload: { version: string }) => void) => () => void;
      sttGetStatus: () => Promise<{
        state: 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error';
        modelDownloaded: boolean;
        detail?: string;
      }>;
      sttEnsureReady: () => Promise<{ ready: boolean; error?: string }>;
      sttStartListening: () => Promise<{ sessionId: string }>;
      sttStopListening: () => Promise<{ finalTranscript: string }>;
      sttCancelListening: () => Promise<void>;
      sttSendAudio: (payload: { sessionId: string; pcm: ArrayBuffer }) => void;
      onSttStatus: (listener: (payload: { state: 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error'; detail?: string }) => void) => () => void;
      onSttDownloadProgress: (listener: (payload: { percent: number; bytesDownloaded: number; bytesTotal: number }) => void) => () => void;
      onSttTranscript: (listener: (payload: { sessionId: string; transcript: string; isFinal: boolean }) => void) => () => void;
    };
  }
}
