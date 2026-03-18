import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Menu, app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import { z } from 'zod';
import type {
  GatewayAbortChatRequest,
  GatewayCloudTarget,
  GatewayChatHistoryRequest,
  GatewayPushEvent,
  GatewaySendChatRequest,
  GatewayStateSnapshot,
} from '@/gateway/demoTypes';
import {
  normalizeCloudProvider,
} from '@/gateway/tokenSyncTypes';
import { LocalOpenclawManager } from '@/main/localOpenclawManager';
import { createMainObserver, type MainObsRecord } from '@/main/observability';
import { PipelineGatewayService } from '@/main/pipelineGatewayService';
import * as sttManager from '@/main/sttManager';
import {
  devOrchestratorControl,
  devOrchestratorCleanupStale,
  devOrchestratorHealth,
  devOrchestratorList,
  devOrchestratorLiveLogs,
  devOrchestratorLogs,
  devOrchestratorRescan,
  devOrchestratorStartCurrentWorktreeCloud,
  devOrchestratorStatusCurrentWorktree,
  devOrchestratorSetWorktreeEnabled,
  devOrchestratorSetWorktreeLabel,
  devOrchestratorSetWorktreeProfile,
  type DevOrchestratorService,
  type DevOrchestratorScope,
} from '@/main/devOrchestrator';
import { DocumentBridge } from '@/main/documentBridge';
import { requestMacMicrophoneAccessIfNeeded } from '@/main/microphonePermissions';
import type { LocalAuthProfilePayload, LocalProviderReadyResult } from '@/shared/collections/types';

if (started) {
  app.quit();
}

const configuredUserDataDir = process.env.ONESHOT_USER_DATA_DIR?.trim();
if (configuredUserDataDir) {
  try {
    fs.mkdirSync(configuredUserDataDir, { recursive: true });
    app.setPath('userData', configuredUserDataDir);
  } catch (error) {
    // Avoid startup failure when the override path is invalid.
    console.warn(`[dev-orchestrator] failed to set ONESHOT_USER_DATA_DIR (${configuredUserDataDir}): ${String(error)}`);
  }
}

log.initialize();

// Route electron-updater logs through electron-log so they appear in the same log file.
autoUpdater.logger = log;
// Download silently in the background; install when the user quits.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const OBS_BUFFER_LIMIT = 500;
const observabilityBuffer: MainObsRecord[] = [];
const observer = createMainObserver((record) => {
  observabilityBuffer.push(record);
  if (observabilityBuffer.length > OBS_BUFFER_LIMIT) {
    observabilityBuffer.splice(0, observabilityBuffer.length - OBS_BUFFER_LIMIT);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:observability-event', record);
  }
});

type AppStateRecord = Record<string, unknown>;
type TerminalSession = {
  process: ChildProcessWithoutNullStreams;
  cwd: string;
};
type MenuCommand =
  | { type: 'navigate'; path: string }
  | { type: 'open-project'; projectPath: string };

// Canonical mapping between cloud provider names, proxyTokens keys, and openclaw profile names.
const CREDENTIAL_PROVIDER_MAPPINGS = [
  { cloud: 'openai', proxy: 'openai', openclaw: 'openai' },
  { cloud: 'anthropic', proxy: 'claude', openclaw: 'anthropic' },
  { cloud: 'gemini', proxy: 'gemini', openclaw: 'gemini' },
] as const;

function resolveCredentialMapping(cloudProviderRaw: string) {
  const cloudProvider = normalizeCloudProvider(cloudProviderRaw);
  const staticMapping = CREDENTIAL_PROVIDER_MAPPINGS.find((mapping) => mapping.cloud === cloudProvider);
  if (staticMapping) {
    return staticMapping;
  }
  return {
    cloud: cloudProvider,
    proxy: null,
    openclaw: cloudProvider,
  };
}

const store = new Store<Record<string, unknown>>({
  name: 'app-settings',
});
const documentBridge = new DocumentBridge(store);

const GATEWAY_CLOUD_TARGET_SETTING_KEY = 'gateway.cloudTarget';
const GATEWAY_DEV_LOCAL_WS_URL_SETTING_KEY = 'gateway.devLocalWsUrl';

let latestClerkToken: string | null = null;
let ensureCloudConnectedPromise: Promise<void> | null = null;

type GatewayJsonInit = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
};

const localOpenclawManager = new LocalOpenclawManager({
  packagedOnly: app.isPackaged,
  onCredentialStored: ({ provider, profileId }) => {
    void syncLocalCredentialToCloud(provider, profileId).catch((error) => {
      log.warn(`[credentials] failed to sync stored credential provider=${provider} profile=${profileId}: ${String(error)}`);
    });
  },
});

const terminalSessions = new Map<string, TerminalSession>();
let mainWindow: BrowserWindow | null = null;

function sendGatewayState(snapshot: GatewayStateSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('gateway:state', snapshot);
  }
}

function sendGatewayEvent(event: GatewayPushEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('gateway:event', event);
  }
}

const gatewayService = new PipelineGatewayService({
  appVersion: app.getVersion(),
  onState: (snapshot) => sendGatewayState(snapshot),
  onEvent: (event) => sendGatewayEvent(event),
  getSetting: (key) => store.get(key),
  setSetting: (key, value) => store.set(key, value),
  startLocalRuntime: async () => {
    const snapshot = await localOpenclawManager.start();
    return snapshot.status === 'running';
  },
  stopLocalRuntime: async () => {
    const snapshot = await localOpenclawManager.stop();
    return snapshot.status === 'stopped';
  },
  isLocalRuntimeRunning: () => localOpenclawManager.snapshot().status === 'running',
  getLocalGatewayAuth: () => localOpenclawManager.getGatewayAuth(),
  getLocalDeviceIdentity: () => localOpenclawManager.getDeviceIdentity(),
  getLocalDeviceAuthToken: () => localOpenclawManager.getDeviceAuthToken(),
  storeLocalDeviceAuthToken: (deviceId, role, token, scopes) =>
    localOpenclawManager.storeDeviceAuthToken(deviceId, role, token, scopes),
  generateLocalAssistant: async (params) => {
    const result = await localOpenclawManager.generateAssistantText({
      provider: params.provider,
      model: params.model,
      prompt: params.prompt,
      thinking: params.thinking,
      maxTokens: 900,
    });
    return { text: result.text };
  },
  observe: (event) => observer.emit(event),
  onAuthenticated: () => undefined,
});

function resolveGatewayApiBaseUrl() {
  const explicit = process.env.VITE_ONESHOT_API_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return app.isPackaged ? 'https://api.capzero.ai' : 'http://127.0.0.1:8790';
}

async function gatewayApiJson<T>(path: string, init: GatewayJsonInit = {}): Promise<T> {
  const token = latestClerkToken?.trim() || '';
  if (!token) {
    throw new Error('missing Clerk token');
  }

  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (typeof init.body !== 'undefined' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const {
    body,
    headers: ignoredHeaders,
    ...rest
  } = init;

  const requestInit: RequestInit = {
    ...rest,
    headers,
  };

  void ignoredHeaders;

  if (typeof body !== 'undefined') {
    requestInit.body = typeof body === 'string'
      ? body
      : JSON.stringify(body);
  }

  const response = await fetch(`${resolveGatewayApiBaseUrl()}${path}`, requestInit);

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

async function syncLocalCredentialToCloud(provider: string, profileId: string) {
  const cloudProvider = normalizeCloudProvider(provider);
  const payload = localOpenclawManager.getProviderSyncPayload(provider, profileId);
  await gatewayApiJson('/api/credentials/push', {
    method: 'POST',
    body: {
      provider: cloudProvider,
      ...payload,
    },
  });
  log.info(`[credentials] synced local credential provider=${cloudProvider} profile=${profileId} tokenKind=${payload.tokenKind}`);
}

async function refreshLocalCredentialCache(providerRaw: string) {
  const provider = normalizeCloudProvider(providerRaw);
  try {
    const payload = await gatewayApiJson<LocalAuthProfilePayload>(
      `/api/credentials/${encodeURIComponent(provider)}/secret`,
    );
    return localOpenclawManager.updateLocalAuthCache(provider, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('"code":"NOT_FOUND"') || /credential not found/i.test(message)) {
      return localOpenclawManager.removeLocalAuthCache(provider);
    }
    throw error;
  }
}

async function removeLocalCredentialCache(providerRaw: string) {
  const provider = normalizeCloudProvider(providerRaw);
  return localOpenclawManager.removeLocalAuthCache(provider);
}

function resolveDevCloudWsDomain(): string {
  const explicit = process.env.VITE_ONESHOT_WS_URL?.trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      const protocol = parsed.protocol === 'wss:' ? 'wss:' : 'ws:';
      return `${protocol}//${parsed.host}`;
    } catch {
      // fall through
    }
  }

  const cloudPortRaw = process.env.ONESHOT_CLOUD_PORT?.trim();
  const cloudPort = Number(cloudPortRaw);
  if (Number.isFinite(cloudPort) && cloudPort > 0 && cloudPort <= 65535) {
    return `ws://127.0.0.1:${cloudPort}`;
  }

  return 'ws://127.0.0.1:8789';
}

function resolveConfiguredCloudTarget(): GatewayCloudTarget {
  const raw = store.get(GATEWAY_CLOUD_TARGET_SETTING_KEY);
  if (raw === 'dev-local' || raw === 'prod' || raw === 'none') {
    return raw;
  }
  return app.isPackaged ? 'prod' : 'dev-local';
}

function normalizeWsDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:' && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const protocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'wss:' : 'ws:';
    return `${protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

async function resolveCloudDomainForTarget(target: GatewayCloudTarget): Promise<string | null> {
  if (target === 'none') return null;
  if (target === 'prod') return 'wss://ws.capzero.ai';

  const override = store.get(GATEWAY_DEV_LOCAL_WS_URL_SETTING_KEY);
  if (typeof override === 'string') {
    const parsed = normalizeWsDomain(override);
    if (parsed) return parsed;
  }

  const current = await devOrchestratorStatusCurrentWorktree();
  if (current.ok && current.row?.ports.cloudPort) {
    const cloudStatus = current.row.status.cloud;
    // Only use the orchestrator-assigned port if the cloud is actually running there.
    // Otherwise fall through to the local default (resolveDevCloudWsDomain()).
    if (cloudStatus === 'online' || cloudStatus === 'launching' || cloudStatus === 'external') {
      return `ws://127.0.0.1:${current.row.ports.cloudPort}`;
    }
  }

  return resolveDevCloudWsDomain();
}

async function maybeStartCurrentWorktreeCloud(): Promise<void> {
  if (app.isPackaged) return;
  // No-op: for manual app runs, cloud startup is external (orchestrator/launchd/manual).
  // ensureCloudConnected() handles the WS connection attempt directly.
}

async function ensureCloudConnected(trigger: string): Promise<void> {
  if (ensureCloudConnectedPromise) {
    await ensureCloudConnectedPromise;
    return;
  }

  ensureCloudConnectedPromise = (async () => {
    const cloudTarget = resolveConfiguredCloudTarget();
    const token = latestClerkToken?.trim() || '';
    if (cloudTarget === 'none') {
      gatewayService.disconnectCloud();
      return;
    }

    if (cloudTarget === 'dev-local') {
      await maybeStartCurrentWorktreeCloud();
      const status = await devOrchestratorStatusCurrentWorktree();
      if (status.ok && status.row?.blockedReason) {
        gatewayService.markCloudConnectBlocked(status.row.blockedReason, 'dev-local');
        return;
      }
    }

    if (!token) {
      gatewayService.markCloudConnectBlocked('Waiting for Clerk token before cloud connection.', cloudTarget);
      return;
    }

    const wsDomain = await resolveCloudDomainForTarget(cloudTarget);
    if (!wsDomain) {
      gatewayService.markCloudConnectBlocked(`Cloud target "${cloudTarget}" is not configured.`, cloudTarget);
      return;
    }

    gatewayService.updateCloudToken(token);
    const state = await gatewayService.getState();
    const alreadyConnected = gatewayService.isAuthenticated()
      && state.connectionScope === 'cloud'
      && state.cloudTarget === cloudTarget;
    if (alreadyConnected) {
      return;
    }

    log.info(`[gateway] ensureCloudConnected trigger=${trigger} target=${cloudTarget} domain=${wsDomain}`);
    await gatewayService.connectCloud(token, wsDomain, cloudTarget);
  })().finally(() => {
    ensureCloudConnectedPromise = null;
  });

  await ensureCloudConnectedPromise;
}

async function ensureProviderReady(
  providerRaw: string,
  runtime: 'local' | 'cloud' | 'auto',
  options?: {
    capabilityProbe?: boolean;
    model?: string;
  },
): Promise<{ ready: boolean; local: boolean; cloud: boolean; healed: boolean; reason?: string }> {
  const provider = normalizeCloudProvider(providerRaw);
  const local = await checkLocalProviderReady(provider, options);

  if (runtime === 'local') {
    return {
      ready: local.ready,
      local: local.ready,
      cloud: false,
      healed: false,
      ...(local.ready ? {} : { reason: local.reason ?? `no local token for ${provider}` }),
    };
  }

  try {
    await ensureCloudConnected('pipeline:ensure-provider-ready');
  } catch {
    // best effort; readiness checks below surface details
  }

  const gatewayState = await gatewayService.getState();
  log.info(`[preflight] provider=${provider} runtime=${runtime} hasLocal=${local.local} connStatus=${gatewayState.connectionStatus} connMode=${gatewayState.connectionMode} wsAuth=${gatewayService.isAuthenticated()}`);

  let cloudConnected = gatewayState.connectionStatus === 'connected'
    && gatewayState.connectionMode !== 'local'
    && gatewayService.isAuthenticated();

  // If cloud is still connecting, wait for the in-progress connect attempt to finish
  if (!cloudConnected && (gatewayState.connectionStatus === 'connecting' || gatewayState.connectionMode === 'remote-direct')) {
    log.info('[preflight] cloud not ready yet, waiting for connection...');
    cloudConnected = await gatewayService.waitForCloudReady(12_000);
    log.info(`[preflight] after wait: cloudConnected=${cloudConnected}`);
  }

  if (!cloudConnected) {
    if (runtime === 'auto' && local.ready) {
      log.info('[preflight] cloud unavailable, falling back to local');
      return { ready: true, local: true, cloud: false, healed: false };
    }
    log.warn(`[preflight] cloud not connected — connStatus=${gatewayState.connectionStatus} connMode=${gatewayState.connectionMode} connDetail=${gatewayState.connectionDetail}`);
    return { ready: false, local: local.ready, cloud: false, healed: false, reason: 'cloud not connected' };
  }

  try {
    const params = new URLSearchParams();
    if (options?.model?.trim()) {
      params.set('model', options.model.trim());
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const probe = await gatewayApiJson<{
      ready?: boolean;
      reason?: string;
    }>(`/api/credentials/${encodeURIComponent(provider)}/probe${suffix}`);

    if (probe.ready) {
      return { ready: true, local: local.ready, cloud: true, healed: false };
    }

    if (runtime === 'auto' && local.ready) {
      log.warn(`[preflight] cloud probe failed for ${provider}; falling back to local: ${probe.reason ?? 'provider not ready'}`);
      return { ready: true, local: true, cloud: false, healed: false };
    }

    return {
      ready: false,
      local: local.ready,
      cloud: false,
      healed: false,
      reason: probe.reason ?? `no cloud token for ${provider}`,
    };
  } catch (error) {
    if (runtime === 'auto' && local.ready) {
      log.warn(`[preflight] cloud probe error for ${provider}; falling back to local: ${String(error)}`);
      return { ready: true, local: true, cloud: false, healed: false };
    }
    return {
      ready: false,
      local: local.ready,
      cloud: false,
      healed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkLocalProviderReady(
  providerRaw: string,
  options?: {
    capabilityProbe?: boolean;
    model?: string;
  },
): Promise<LocalProviderReadyResult> {
  const provider = normalizeCloudProvider(providerRaw);
  const mapping = resolveCredentialMapping(provider);

  if (localOpenclawManager.snapshot().status !== 'running') {
    return {
      ready: false,
      local: false,
      capabilityChecked: options?.capabilityProbe === true,
      reason: 'local runtime is not available',
    };
  }

  let localToken = '';
  try {
    localToken = localOpenclawManager.getProviderSecret(mapping.openclaw).token;
  } catch {
    localToken = '';
  }

  let hasLocal = localToken.length > 0;
  if (hasLocal) {
    const profiles = localOpenclawManager.listAuthProfiles();
    const normalizedProvider = mapping.openclaw.trim().toLowerCase();
    const profile = profiles.find((item) => {
      const prov = item.provider.trim().toLowerCase();
      return prov === normalizedProvider
        || (normalizedProvider === 'openai' && prov === 'openai-codex')
        || (normalizedProvider === 'openai-codex' && prov === 'openai');
    });
    if (profile && typeof profile.expires === 'number' && profile.expires > 0
      && profile.expires < Date.now() && !profile.hasRefresh) {
      hasLocal = false;
    }
  }

  return {
    ready: hasLocal,
    local: hasLocal,
    capabilityChecked: options?.capabilityProbe === true,
    ...(hasLocal ? {} : { reason: `no local token for ${provider}` }),
  };
}

const DEFAULT_APP_STATE: AppStateRecord = {
  settingsSection: 'General',
  projectPaths: [],
  selectedProjectPath: '',
  projectProfiles: {},
  selectedRunByProject: {},
  sidebarCollapsed: false,
  homeGettingStartedOpen: true,
  homeDashboardOpen: true,
  selectedEditor: 'vscode',
  terminalOpen: false,
  createLaunchId: randomUUID(),
  createProjectDraft: {
    selectedIntent: 'web-app',
    projectName: '',
    projectDescription: '',
    selectedAgents: [],
    selectedTechnologies: [],
    selectedSkills: [],
    selectedProvider: 'openai',
    selectedModel: 'gpt-5-mini',
    createStep: 'curate',
    technologiesAutoMode: true,
    skillsAutoMode: true,
    assistantMessage: '',
    progressMessage: '',
  },
  projectWorkspaces: {},
};

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

const debugLogSchema = z.object({
  message: z.string().min(1),
  details: z.unknown().optional(),
});
const appLogEventSchema = z.object({
  domain: z.string().min(1),
  action: z.string().min(1),
  phase: z.string().optional(),
  status: z.enum(['start', 'success', 'error', 'retry', 'skip', 'close']).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  correlationId: z.string().optional(),
  fingerprint: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  duplicateCount: z.number().int().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const shellStateSchema = z.record(z.string(), z.unknown());

const openTargetSchema = z.object({
  projectPath: z.string().optional(),
  target: z.enum(['vscode', 'cursor', 'zed', 'finder', 'ghostty']),
});

const openDocumentDialogSchema = z.object({
  title: z.string().optional(),
  filters: z.array(z.object({
    name: z.string().min(1),
    extensions: z.array(z.string().min(1)).min(1),
  })).optional(),
}).optional();

const openDocumentTargetSchema = z.object({
  target: z.string().min(1),
});

const documentCreateSessionSchema = z.object({
  pathOrUrl: z.string().min(1),
  preferEdit: z.boolean().optional(),
});

const documentSessionSchema = z.object({
  sessionId: z.string().min(1),
});

const terminalStartSchema = z.object({
  cwd: z.string().optional(),
});

const terminalWriteSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string(),
});

const terminalResizeSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
});

const terminalStopSchema = z.object({
  sessionId: z.string().min(1),
});

const openExternalUrlSchema = z.object({
  url: z.string().min(1),
});

const proxyHealthSchema = z.object({
  baseUrl: z.string().min(1),
  authToken: z.string().optional(),
});

const proxyOauthUrlSchema = z.object({
  provider: z.enum(['claude', 'openai', 'gemini']),
  baseUrl: z.string().min(1),
  authToken: z.string().optional(),
});

const proxyOauthPollSchema = z.object({
  baseUrl: z.string().min(1),
  state: z.string().min(1),
  authToken: z.string().optional(),
});

const proxyRefreshAuthSchema = z.object({});

const gatewayChatHistorySchema = z.object({
  sessionKey: z.string().min(1),
  limit: z.number().int().min(1).max(1000).optional(),
});

const gatewaySendChatSchema = z.object({
  sessionKey: z.string().min(1),
  message: z.string(),
  attachments: z.array(z.object({
    type: z.literal('image'),
    mimeType: z.string().min(1),
    content: z.string().min(1),
    fileName: z.string().optional(),
  })).optional(),
  thinking: z.string().optional(),
  idempotencyKey: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const gatewayAbortChatSchema = z.object({
  sessionKey: z.string().min(1),
  runId: z.string().optional(),
});

const gatewayDebugCloudSnapshotSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  sessionId: z.string().min(1).optional(),
  includeR2: z.boolean().optional(),
}).optional();

const gatewayRemoteSettingsSchema = z.object({
  transport: z.enum(['ssh', 'direct']),
  sshTarget: z.string(),
  sshPort: z.number().int().min(1).max(65535).default(22),
  identityFile: z.string().default(''),
  remoteGatewayPort: z.number().int().min(1).max(65535).default(18789),
  remoteUrl: z.string().default(''),
  token: z.string().default(''),
  password: z.string().default(''),
});

const pipelineSetActiveUserSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().optional(),
  clerkToken: z.string().optional(),
});
const pipelineEnsureProviderReadySchema = z.object({
  provider: z.string().min(1),
  runtime: z.enum(['local', 'cloud', 'auto']),
  capabilityProbe: z.boolean().optional(),
  model: z.string().min(1).optional(),
});
const pipelineChatSendSchema = z.object({
  provider: z.string().min(1),
  runtime: z.enum(['local', 'cloud', 'auto']),
  model: z.string().min(1),
  sessionId: z.string().min(1),
  message: z.string(),
  attachments: z.array(z.object({
    type: z.literal('image'),
    mimeType: z.string().min(1),
    content: z.string().min(1),
    fileName: z.string().optional(),
  })).optional(),
  idempotencyKey: z.string().min(1),
}).superRefine((value, ctx) => {
  const hasMessage = value.message.trim().length > 0;
  const hasAttachments = Array.isArray(value.attachments) && value.attachments.length > 0;
  if (!hasMessage && !hasAttachments) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'message or attachments required',
      path: ['message'],
    });
  }
});
const pipelineListProviderModelsSchema = z.object({
  provider: z.string().min(1),
});

const pipelineSaveProviderTokenSchema = z.object({
  provider: z.string().min(1),
  token: z.string().min(1),
});
const pipelineProviderSchema = z.object({
  provider: z.string().min(1),
});
const pipelineLocalCredentialCacheSchema = z.object({
  provider: z.string().min(1),
});
const pipelineCheckLocalProviderReadySchema = z.object({
  provider: z.string().min(1),
  capabilityProbe: z.boolean().optional(),
  model: z.string().min(1).optional(),
});
const pipelineHookRouteUpsertSchema = z.object({
  name: z.string().min(1),
  action: z.enum(['wake', 'agent']),
  enabled: z.boolean().optional(),
  token: z.string().optional(),
  tokenHash: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const pipelineHookRouteDeleteSchema = z.object({
  name: z.string().min(1),
});
const pipelineHookEventListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});
const pipelineHookAgentUpsertSchema = z.object({
  agentId: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const pipelineHookAgentDeleteSchema = z.object({
  agentId: z.string().min(1),
});
const pipelineConnectMailboxSchema = z.object({
  action: z.enum(['start', 'complete', 'disconnect']),
  provider: z.string().optional(),
  mailboxId: z.string().optional(),
  accountId: z.string().optional(),
  sessionId: z.string().optional(),
  externalAccountId: z.string().optional(),
  tokenRef: z.string().optional(),
  scopes: z.array(z.string().min(1)).optional(),
  redirectUri: z.string().optional(),
});
const pipelineProvisionCapzeroMailboxSchema = z.object({
  mailboxId: z.string().optional(),
  displayName: z.string().optional(),
  primaryAddress: z.string().optional(),
  domain: z.string().optional(),
});
const pipelineListMailThreadsSchema = z.object({
  mailboxId: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  beforeTs: z.number().int().positive().optional(),
}).optional();
const pipelineGetMailThreadSchema = z.object({
  threadId: z.string().min(1),
  limit: z.number().int().min(1).max(400).optional(),
});
const pipelineCreateMailAliasSchema = z.object({
  mailboxId: z.string().min(1),
  address: z.string().optional(),
  label: z.string().optional(),
  purpose: z.string().optional(),
  routingPolicy: z.record(z.string(), z.unknown()).optional(),
  spamScore: z.number().optional(),
});
const pipelineBurnMailAliasSchema = z.object({
  aliasId: z.string().min(1),
  restore: z.boolean().optional(),
});
const pipelineUploadMailAttachmentSchema = z.object({
  action: z.enum(['init', 'complete', 'downloadUrl']),
  mailboxId: z.string().optional(),
  messageId: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().min(0).optional(),
  sha256: z.string().optional(),
  attachmentId: z.string().optional(),
  scanStatus: z.string().optional(),
});
const pipelineSendMailDraftSchema = z.object({
  draftId: z.string().min(1),
  provider: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
const pipelineGetMailHealthSchema = z.object({
  mailboxId: z.string().optional(),
}).optional();
const pipelineGetAuthProfileSecretSchema = z.object({
  profileId: z.string().min(1),
});
const pipelineOAuthSubmitInputSchema = z.object({
  sessionId: z.string().min(1),
  inputValue: z.string(),
});
const pipelineOAuthStatusSchema = z.object({
  sessionId: z.string().min(1),
});
const pipelineOAuthCancelSchema = z.object({
  sessionId: z.string().min(1),
});
const pipelineLaunchProviderOAuthSchema = z.object({
  provider: z.string().min(1),
});
const devOrchestratorScopeSchema = z.object({
  type: z.enum(['all', 'worktree', 'instance', 'process']),
  worktreeKey: z.string().optional(),
  instanceId: z.string().optional(), // legacy alias
  processName: z.string().optional(),
}).superRefine((value, ctx) => {
  if ((value.type === 'worktree' || value.type === 'instance') && (!value.worktreeKey?.trim() && !value.instanceId?.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'worktreeKey is required when scope type is worktree',
      path: ['worktreeKey'],
    });
  }
  if (value.type === 'process' && (!value.processName || !value.processName.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'processName is required when scope type is process',
      path: ['processName'],
    });
  }
});
const devOrchestratorServiceSchema = z.enum(['cloud', 'app']);
const devOrchestratorActionSchema = z.object({
  scope: devOrchestratorScopeSchema.optional(),
  services: z.array(devOrchestratorServiceSchema).nonempty().optional(),
});
const devOrchestratorLogsSchema = z.object({
  processName: z.string().min(1),
  lines: z.number().int().min(1).max(2000).optional(),
});
const devOrchestratorLiveLogsSchema = z.object({
  processName: z.string().min(1),
  fromNow: z.boolean().optional(),
  maxBytes: z.number().int().min(4 * 1024).max(1024 * 1024).optional(),
  cursor: z.object({
    stdoutOffset: z.number().int().min(0),
    stderrOffset: z.number().int().min(0),
  }).optional(),
});
const devOrchestratorWranglerLogsSchema = z.object({
  cloudPort: z.number().int().min(1).max(65535).optional(),
  lines: z.number().int().min(1).max(2000).optional(),
});
const devOrchestratorSetWorktreeEnabledSchema = z.object({
  worktreeKey: z.string().min(1),
  enabled: z.boolean(),
});
const devOrchestratorSetWorktreeProfileSchema = z.object({
  worktreeKey: z.string().min(1),
  profile: z.string().nullable().optional(),
});
const devOrchestratorSetWorktreeLabelSchema = z.object({
  worktreeKey: z.string().min(1),
  label: z.string().nullable().optional(),
});

function normalizeDevOrchestratorScope(scope?: z.infer<typeof devOrchestratorScopeSchema>): DevOrchestratorScope {
  if (!scope) {
    return { type: 'all' };
  }
  if (scope.type === 'worktree' || scope.type === 'instance') {
    return { type: 'worktree', worktreeKey: (scope.worktreeKey ?? scope.instanceId ?? '').trim() };
  }
  if (scope.type === 'process') {
    return { type: 'process', processName: (scope.processName ?? '').trim() };
  }
  return { type: 'all' };
}

function tailWranglerLocalLogs(cloudPort?: number, lines = 200) {
  const wranglerDir = path.join(os.homedir(), 'Library', 'Preferences', '.wrangler', 'logs');
  if (!fs.existsSync(wranglerDir) || !fs.statSync(wranglerDir).isDirectory()) {
    return {
      ok: false as const,
      supported: true as const,
      sourcePath: null as string | null,
      lines,
      entries: [] as string[],
      reason: `Wrangler log directory not found: ${wranglerDir}`,
    };
  }

  const files = fs.readdirSync(wranglerDir)
    .filter((name) => name.startsWith('wrangler-') && name.endsWith('.log'))
    .map((name) => {
      const filePath = path.join(wranglerDir, name);
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      return { filePath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const portNeedle = typeof cloudPort === 'number' ? `127.0.0.1:${cloudPort}` : '';
  for (const file of files.slice(0, 40)) {
    try {
      const raw = fs.readFileSync(file.filePath, 'utf8');
      if (!raw.trim()) continue;
      if (!raw.includes('Starting local server')) continue;
      if (portNeedle && !raw.includes(portNeedle)) continue;
      const rows = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      return {
        ok: true as const,
        supported: true as const,
        sourcePath: file.filePath,
        lines,
        entries: rows.slice(-lines),
      };
    } catch {
      // continue
    }
  }

  return {
    ok: false as const,
    supported: true as const,
    sourcePath: null as string | null,
    lines,
    entries: [] as string[],
    reason: typeof cloudPort === 'number'
      ? `No recent Wrangler local log matched port ${cloudPort}.`
      : 'No recent Wrangler local log found.',
  };
}

function existingDirectoryOrFallback(candidate?: string) {
  if (candidate && candidate.trim()) {
    const normalized = candidate.trim();
    if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
      return normalized;
    }
  }
  return os.homedir();
}

function sendTerminalEvent(channel: 'terminal:output' | 'terminal:exit', payload: Record<string, unknown>) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function sendMenuCommand(command: MenuCommand) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('menu:command', command);
}

function installAppMenu() {
  const isMac = process.platform === 'darwin';
  const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

  const sep: Electron.MenuItemConstructorOptions = { type: 'separator' as const };

  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' as const },
        sep,
        { role: 'services' as const },
        sep,
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        sep,
        { role: 'quit' as const },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Project',
        accelerator: 'CommandOrControl+N',
        click: () => sendMenuCommand({ type: 'navigate', path: '/home/create' }),
      },
      {
        label: 'Open Project…',
        accelerator: 'CommandOrControl+O',
        click: async () => {
          const result = await dialog.showOpenDialog({
            title: 'Open project',
            properties: ['openDirectory', 'createDirectory'],
          });
          const selected = result.canceled ? null : result.filePaths[0] ?? null;
          if (!selected) return;
          sendMenuCommand({ type: 'open-project', projectPath: selected });
          try {
            app.addRecentDocument(selected);
          } catch {
            // ignore
          }
        },
      },
      sep,
      { role: 'recentDocuments' as const },
      { role: 'clearRecentDocuments' as const },
      sep,
      ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }]),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' as const },
      { role: 'redo' as const },
      sep,
      { role: 'cut' as const },
      { role: 'copy' as const },
      { role: 'paste' as const },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' as const },
            { role: 'delete' as const },
            { role: 'selectAll' as const },
          ]
        : [{ role: 'delete' as const }, sep, { role: 'selectAll' as const }]),
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' as const },
      { role: 'forceReload' as const },
      ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
      sep,
      { role: 'resetZoom' as const },
      { role: 'zoomIn' as const },
      { role: 'zoomOut' as const },
      sep,
      { role: 'togglefullscreen' as const },
    ],
  });

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' as const },
      { role: 'zoom' as const },
      ...(isMac
        ? [sep, { role: 'front' as const }]
        : [{ role: 'close' as const }]),
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Terms of Service',
        click: () => void shell.openExternal('https://capzero.com/terms-of-service'),
      },
      {
        label: 'Privacy Policy',
        click: () => void shell.openExternal('https://capzero.com/privacy-policy'),
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function trySpawnCommand(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function openProjectTarget(
  projectPath: string | undefined,
  target: 'vscode' | 'cursor' | 'zed' | 'finder' | 'ghostty',
) {
  const normalizedPath = projectPath?.trim();

  if (target === 'finder') {
    if (normalizedPath) {
      const error = await shell.openPath(normalizedPath);
      return error.length === 0;
    }
    return trySpawnCommand('open', ['-a', 'Finder']);
  }

  const commands: Record<string, { command: string; argsWithPath: string[]; argsWithoutPath: string[] }> = {
    vscode: { command: 'code', argsWithPath: ['--reuse-window'], argsWithoutPath: ['--reuse-window'] },
    cursor: { command: 'cursor', argsWithPath: [], argsWithoutPath: [] },
    zed: { command: 'zed', argsWithPath: [], argsWithoutPath: [] },
    ghostty: { command: 'ghostty', argsWithPath: ['-d'], argsWithoutPath: [] },
  };

  const commandConfig = commands[target];
  if (!commandConfig) return false;

  const args = normalizedPath
    ? [...commandConfig.argsWithPath, normalizedPath]
    : commandConfig.argsWithoutPath;
  const spawned = await trySpawnCommand(commandConfig.command, args);
  if (spawned) return true;

  if (target === 'vscode') {
    await shell.openExternal(
      normalizedPath ? `vscode://file/${encodeURIComponent(normalizedPath)}` : 'vscode://',
    );
    return true;
  }
  return false;
}

function initAutoUpdater(window: BrowserWindow) {
  // Only run in packaged production builds — never during development.
  if (!app.isPackaged) return;

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available:', info.version);
    window.webContents.send('app:update-available', {
      version: info.version as string,
      releaseNotes: (info.releaseNotes ?? null) as string | null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update downloaded:', info.version);
    window.webContents.send('app:update-downloaded', {
      version: info.version as string,
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('[updater] error:', err.message);
  });

  // Delay the first check by 10 s to let the app fully start.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.warn('[updater] check failed:', err.message);
    });
  }, 10_000);
}

function resolveMacDockIconPath(): string | null {
  const roots = [process.cwd(), app.getAppPath(), __dirname];
  for (const root of roots) {
    let cursor = root;
    for (let depth = 0; depth < 8; depth += 1) {
      const png1024 = path.join(cursor, 'resources', 'icons', 'mac', 'icon_1024x1024.png');
      if (fs.existsSync(png1024)) return png1024;
      const png512 = path.join(cursor, 'resources', 'icons', 'mac', 'icon.iconset', 'icon_512x512.png');
      if (fs.existsSync(png512)) return png512;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return null;
}

function setMacDockIcon() {
  if (process.platform !== 'darwin') return;
  const iconPath = resolveMacDockIconPath();
  if (!iconPath) {
    log.warn('[icon] macOS dock icon not found under resources/icons/mac');
    return;
  }
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    log.warn('[icon] macOS dock icon failed to load:', iconPath);
    return;
  }
  app.dock?.setIcon(icon);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : { titleBarOverlay: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  installAppMenu();
}

app.on('ready', () => {
  void requestMacMicrophoneAccessIfNeeded('app.ready');

  void documentBridge.init().catch((error) => {
    log.warn(`[document-bridge] init failed: ${String(error)}`);
  });
  setMacDockIcon();
  createWindow();
  if (mainWindow) {
    initAutoUpdater(mainWindow);
  }
  if (!app.isPackaged && resolveConfiguredCloudTarget() === 'dev-local') {
    void maybeStartCurrentWorktreeCloud().catch((error) => {
      log.warn(`[gateway] dev-local cloud bootstrap failed: ${String(error)}`);
    });
  }
  void ensureCloudConnected('app.ready').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(app.ready) failed: ${String(error)}`);
  });
  // Workflow-first dictation readiness: start model download/init in background
  // at app startup if assets are missing, so first mic click is faster.
  sttManager.prewarmModelInBackground('app.ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  void gatewayService.shutdown();
  void localOpenclawManager.stop();
  void documentBridge.dispose();
  for (const [sessionId, session] of terminalSessions.entries()) {
    session.process.kill();
    terminalSessions.delete(sessionId);
  }
});

ipcMain.handle('app:get-setting', (_event, key: string) => {
  if (!key) return null;
  return store.get(key) ?? null;
});

ipcMain.handle('app:set-setting', (_event, payload: unknown) => {
  const { key, value } = settingUpdateSchema.parse(payload);
  store.set(key, value);
  if (key === GATEWAY_CLOUD_TARGET_SETTING_KEY || key === GATEWAY_DEV_LOCAL_WS_URL_SETTING_KEY) {
    void ensureCloudConnected(`app:set-setting:${key}`).catch((error) => {
      log.warn(`[gateway] ensureCloudConnected(app:set-setting) failed: ${String(error)}`);
    });
  }
});

ipcMain.handle('app:get-state', () => {
  const value = store.get('app-state');
  if (!value || typeof value !== 'object') {
    return DEFAULT_APP_STATE;
  }
  return {
    ...DEFAULT_APP_STATE,
    ...(value as AppStateRecord),
  };
});

ipcMain.handle('app:set-state', (_event, payload: unknown) => {
  const nextState = shellStateSchema.parse(payload);
  store.set('app-state', nextState);
});

ipcMain.handle('app:debug-log', (_event, payload: unknown) => {
  const { message, details } = debugLogSchema.parse(payload);
  try {
    observer.emit({
      level: 'debug',
      domain: 'renderer.debug',
      action: message,
      ...(typeof details === 'undefined' ? {} : { data: { details } }),
    });
  } catch {
    // no-op: debug logging must never crash the app
  }
  return true;
});

ipcMain.handle('app:log-event', (_event, payload: unknown) => {
  const event = appLogEventSchema.parse(payload);
  try {
    observer.emit(event);
  } catch {
    // no-op: logging must never crash the app
  }
  return true;
});

ipcMain.handle('app:get-observability-events', () => {
  return observabilityBuffer;
});

ipcMain.handle('app:clear-observability-events', () => {
  observabilityBuffer.length = 0;
  return true;
});

ipcMain.handle('app:open-project-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open project',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle('app:open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open file',
    properties: ['openFile'],
  });

  if (result.canceled) return null;
  const selected = result.filePaths[0] ?? null;
  if (selected) {
    try {
      app.addRecentDocument(selected);
    } catch {
      // ignore
    }
  }
  return selected;
});

ipcMain.handle('app:open-document-dialog', async (_event, payload: unknown) => {
  const parsed = openDocumentDialogSchema.parse(payload);
  const result = await dialog.showOpenDialog({
    title: parsed?.title ?? 'Open document',
    properties: ['openFile'],
    filters: parsed?.filters,
  });
  if (result.canceled) return null;
  const selected = result.filePaths[0] ?? null;
  if (selected) {
    try {
      app.addRecentDocument(selected);
    } catch {
      // ignore
    }
  }
  return selected;
});

ipcMain.handle('app:open-document-target', async (_event, payload: unknown) => {
  const { target } = openDocumentTargetSchema.parse(payload);
  return await documentBridge.openDocumentTarget(target);
});

ipcMain.handle('document:create-session', async (_event, payload: unknown) => {
  const parsed = documentCreateSessionSchema.parse(payload);
  return await documentBridge.createSession(parsed);
});

ipcMain.handle('document:save-session', async (_event, payload: unknown) => {
  const { sessionId } = documentSessionSchema.parse(payload);
  return await documentBridge.saveSession(sessionId);
});

ipcMain.handle('document:close-session', async (_event, payload: unknown) => {
  const { sessionId } = documentSessionSchema.parse(payload);
  return await documentBridge.closeSession(sessionId);
});

ipcMain.handle('document:get-capabilities', async () => {
  return await documentBridge.getCapabilities();
});

ipcMain.handle('app:open-project-target', async (_event, payload: unknown) => {
  const { projectPath, target } = openTargetSchema.parse(payload);
  return openProjectTarget(projectPath, target);
});

ipcMain.handle('app:open-external-url', async (_event, payload: unknown) => {
  const { url } = openExternalUrlSchema.parse(payload);
  await shell.openExternal(url);
});

ipcMain.handle('proxy:check-health', async (_event, payload: unknown) => {
  proxyHealthSchema.parse(payload);
  return {
    healthy: false,
    latency_ms: null,
    status_code: null,
    error: 'Legacy proxy backend removed. Use fresh Cloudflare pipeline settings.',
  };
});

ipcMain.handle('proxy:get-oauth-url', async (_event, payload: unknown) => {
  proxyOauthUrlSchema.parse(payload);
  throw new Error('Legacy proxy OAuth flow removed. Use new local OpenClaw auth flow.');
});

ipcMain.handle('proxy:poll-oauth-status', async (_event, payload: unknown) => {
  proxyOauthPollSchema.parse(payload);
  return false;
});

ipcMain.handle('proxy:refresh-auth-status', async (_event, payload: unknown) => {
  proxyRefreshAuthSchema.parse(payload);
  const status = { claude: 0, openai: 0, gemini: 0 };
  const allSettings = store.store;
  for (const [key, value] of Object.entries(allSettings)) {
    if (!key.startsWith('oneshot.user.') || !key.endsWith('.settings') || !value || typeof value !== 'object') {
      continue;
    }
    const connected = (value as { connectedAccounts?: unknown }).connectedAccounts;
    if (!connected || typeof connected !== 'object') continue;
    const proxyTokens = (connected as { secrets?: { proxyTokens?: Record<string, unknown> } }).secrets?.proxyTokens;
    if (!proxyTokens || typeof proxyTokens !== 'object') continue;
    if (typeof proxyTokens.claude === 'string' && proxyTokens.claude.trim()) status.claude += 1;
    if (typeof proxyTokens.openai === 'string' && proxyTokens.openai.trim()) status.openai += 1;
    if (typeof proxyTokens.gemini === 'string' && proxyTokens.gemini.trim()) status.gemini += 1;
    if (typeof proxyTokens.anthropic === 'string' && proxyTokens.anthropic.trim()) {
      status.claude += 1;
    }
    if (typeof proxyTokens.codex === 'string' && proxyTokens.codex.trim()) {
      status.openai += 1;
    }
  }
  if (status.claude === 0 && status.openai === 0 && status.gemini === 0) {
    for (const provider of ['claude', 'openai', 'gemini'] as const) {
      const direct = store.get(`hosted.token.personal.anonymous.${provider}`);
      if (typeof direct === 'string' && direct.trim()) {
        status[provider] += 1;
      }
    }
  }
  return status;
});

ipcMain.handle('gateway:get-state', async () => {
  return await gatewayService.getState();
});

ipcMain.handle('gateway:enable-openclaw', async () => {
  return await gatewayService.enableOpenclaw();
});

ipcMain.handle('gateway:disable-openclaw', async () => {
  return await gatewayService.disableOpenclaw();
});

ipcMain.handle('gateway:connect', async () => {
  return await gatewayService.connect();
});

ipcMain.handle('gateway:disconnect', async () => {
  return await gatewayService.disconnect();
});

ipcMain.handle('gateway:connect-remote', async (_event, payload: unknown) => {
  const parsed = gatewayRemoteSettingsSchema.parse(payload);
  return await gatewayService.connectRemote(parsed);
});

ipcMain.handle('gateway:connect-cloud', async (_event, payload: unknown) => {
  const { token, wsDomain } = z.object({
    token: z.string().min(1),
    wsDomain: z.string().optional(),
  }).parse(payload);
  latestClerkToken = token.trim() || null;
  if (!latestClerkToken) {
    gatewayService.markCloudConnectBlocked('Missing Clerk token before cloud connection.', resolveConfiguredCloudTarget());
    return await gatewayService.getState();
  }
  if (wsDomain?.trim()) {
    const normalized = normalizeWsDomain(wsDomain.trim());
    if (!normalized) {
      gatewayService.markCloudConnectBlocked(`Invalid wsDomain override: ${wsDomain}`, resolveConfiguredCloudTarget());
      return await gatewayService.getState();
    }
    return await gatewayService.connectCloud(
      latestClerkToken,
      normalized,
      (normalized.includes('ws.capzero.ai') || normalized.includes('ws.capzero.com')) ? 'prod' : 'dev-local',
    );
  }
  await ensureCloudConnected('gateway:connect-cloud');
  return await gatewayService.getState();
});

ipcMain.handle('gateway:get-remote-settings', () => {
  return gatewayService.getRemoteSettings();
});

ipcMain.handle('gateway:get-devices', async () => {
  return await gatewayService.getDevices();
});

ipcMain.handle('gateway:get-chat-history', async (_event, payload: unknown) => {
  const parsed = gatewayChatHistorySchema.parse(payload) as GatewayChatHistoryRequest;
  return await gatewayService.getChatHistory(parsed);
});

ipcMain.handle('gateway:send-chat', async (_event, payload: unknown) => {
  const parsed = gatewaySendChatSchema.parse(payload) as GatewaySendChatRequest;
  return await gatewayService.sendChat(parsed);
});

ipcMain.handle('gateway:abort-chat', async (_event, payload: unknown) => {
  const parsed = gatewayAbortChatSchema.parse(payload) as GatewayAbortChatRequest;
  return await gatewayService.abortChat(parsed);
});

ipcMain.handle('gateway:debug-cloud-snapshot', async (_event, payload: unknown) => {
  const parsed = gatewayDebugCloudSnapshotSchema.parse(payload);
  return await gatewayService.getCloudDebugSnapshot(parsed);
});

ipcMain.handle('terminal:start', (_event, payload: unknown) => {
  const { cwd } = terminalStartSchema.parse(payload);
  const resolvedCwd = existingDirectoryOrFallback(cwd);
  const shellPath = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
  const shellArgs = process.platform === 'win32' ? [] : ['-l'];
  const terminalProcess = spawn(shellPath, shellArgs, {
    cwd: resolvedCwd,
    env: process.env,
  });

  const sessionId = randomUUID();
  terminalProcess.stdout.setEncoding('utf8');
  terminalProcess.stderr.setEncoding('utf8');

  terminalProcess.stdout.on('data', (data: string) => {
    sendTerminalEvent('terminal:output', { sessionId, data, stream: 'stdout' });
  });
  terminalProcess.stderr.on('data', (data: string) => {
    sendTerminalEvent('terminal:output', { sessionId, data, stream: 'stderr' });
  });
  terminalProcess.on('close', (code, signal) => {
    terminalSessions.delete(sessionId);
    sendTerminalEvent('terminal:exit', { sessionId, code, signal });
  });

  terminalSessions.set(sessionId, {
    process: terminalProcess,
    cwd: resolvedCwd,
  });

  return {
    sessionId,
    cwd: resolvedCwd,
  };
});

ipcMain.handle('terminal:write', (_event, payload: unknown) => {
  const { sessionId, input } = terminalWriteSchema.parse(payload);
  const session = terminalSessions.get(sessionId);
  if (!session) return false;
  session.process.stdin.write(input);
  return true;
});

ipcMain.handle('terminal:resize', (_event, payload: unknown) => {
  const { sessionId } = terminalResizeSchema.parse(payload);
  return terminalSessions.has(sessionId);
});

ipcMain.handle('terminal:stop', (_event, payload: unknown) => {
  const { sessionId } = terminalStopSchema.parse(payload);
  const session = terminalSessions.get(sessionId);
  if (!session) return false;
  session.process.kill();
  terminalSessions.delete(sessionId);
  return true;
});

ipcMain.handle('pipeline:set-active-user', (_event, payload: unknown) => {
  const parsed = pipelineSetActiveUserSchema.parse(payload);
  const userId = parsed.userId;
  const tenantId = parsed.tenantId;
  const clerkToken = parsed.clerkToken;

  log.info(`[set-active-user] userId=${userId} tenantId=${tenantId ?? '(none)'} hasClerkToken=${Boolean(clerkToken)} tokenLen=${clerkToken?.length ?? 0}`);

  if (typeof clerkToken === 'string') {
    const trimmed = clerkToken.trim();
    latestClerkToken = trimmed || null;
  }

  localOpenclawManager.setActiveUser(userId);
  void tenantId;

  void ensureCloudConnected('pipeline:set-active-user').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(set-active-user) failed: ${String(error)}`);
  });

  return localOpenclawManager.snapshotWithProbe();
});

ipcMain.handle('pipeline:push-clerk-token', (_event, payload: unknown) => {
  const { token } = z.object({ token: z.string() }).parse(payload);
  const trimmed = token.trim();
  latestClerkToken = trimmed || null;
  if (trimmed) {
    gatewayService.updateCloudToken(trimmed);
  }
  void ensureCloudConnected('pipeline:push-clerk-token').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(push-clerk-token) failed: ${String(error)}`);
  });
  return { ok: true };
});

ipcMain.handle('pipeline:get-local-openclaw-status', () => {
  return localOpenclawManager.snapshotWithProbe();
});

ipcMain.handle('pipeline:check-openclaw-runtime', () => {
  return localOpenclawManager.runtimeCheck();
});

ipcMain.handle('pipeline:start-local-openclaw', async () => {
  return await localOpenclawManager.start();
});

ipcMain.handle('pipeline:stop-local-openclaw', async () => {
  return await localOpenclawManager.stop();
});

ipcMain.handle('pipeline:launch-provider-oauth', (_event, payload: unknown) => {
  const { provider } = pipelineLaunchProviderOAuthSchema.parse(payload);
  return localOpenclawManager.startProviderOAuthSession(provider);
});

ipcMain.handle('pipeline:oauth-submit-input', (_event, payload: unknown) => {
  const { sessionId, inputValue } = pipelineOAuthSubmitInputSchema.parse(payload);
  return localOpenclawManager.submitProviderOAuthInput(sessionId, inputValue);
});

ipcMain.handle('pipeline:oauth-status', (_event, payload: unknown) => {
  const { sessionId } = pipelineOAuthStatusSchema.parse(payload);
  return localOpenclawManager.getProviderOAuthStatus(sessionId);
});

ipcMain.handle('pipeline:oauth-cancel', (_event, payload: unknown) => {
  const { sessionId } = pipelineOAuthCancelSchema.parse(payload);
  return localOpenclawManager.cancelProviderOAuthSession(sessionId);
});

ipcMain.handle('pipeline:save-provider-token', (_event, payload: unknown) => {
  const { provider, token } = pipelineSaveProviderTokenSchema.parse(payload);
  return localOpenclawManager.saveProviderToken(provider, token);
});

ipcMain.handle('pipeline:delete-provider-token', (_event, payload: unknown) => {
  const { provider } = pipelineProviderSchema.parse(payload);
  return localOpenclawManager.removeProviderProfiles(provider);
});

ipcMain.handle('pipeline:refresh-local-credential-cache', async (_event, payload: unknown) => {
  const { provider } = pipelineLocalCredentialCacheSchema.parse(payload);
  return await refreshLocalCredentialCache(provider);
});

ipcMain.handle('pipeline:remove-local-credential-cache', (_event, payload: unknown) => {
  const { provider } = pipelineLocalCredentialCacheSchema.parse(payload);
  return removeLocalCredentialCache(provider);
});

ipcMain.handle('pipeline:check-local-provider-ready', async (_event, payload: unknown) => {
  const { provider, capabilityProbe, model } = pipelineCheckLocalProviderReadySchema.parse(payload);
  return await checkLocalProviderReady(provider, { capabilityProbe, model });
});

ipcMain.handle('pipeline:probe-channel', async (_event, payload: unknown) => {
  const { channelId } = z.object({ channelId: z.string().min(1) }).parse(payload);
  return await gatewayService.probeChannelFromCloud(channelId);
});

ipcMain.handle('pipeline:get-channel-status', async (_event, payload: unknown) => {
  const { channelId } = z.object({ channelId: z.string().min(1) }).parse(payload);
  return await gatewayService.getChannelStatusFromCloud(channelId);
});

ipcMain.handle('pipeline:upsert-hook-route', async (_event, payload: unknown) => {
  const parsed = pipelineHookRouteUpsertSchema.parse(payload);
  return await gatewayService.upsertHookRouteInCloud(parsed);
});

ipcMain.handle('pipeline:delete-hook-route', async (_event, payload: unknown) => {
  const parsed = pipelineHookRouteDeleteSchema.parse(payload);
  return await gatewayService.deleteHookRouteFromCloud(parsed.name);
});

ipcMain.handle('pipeline:list-hook-events', async (_event, payload: unknown) => {
  const parsed = pipelineHookEventListSchema.parse(payload ?? {});
  return await gatewayService.listHookEventsFromCloud(parsed.limit ?? 50);
});

ipcMain.handle('pipeline:upsert-hook-agent', async (_event, payload: unknown) => {
  const parsed = pipelineHookAgentUpsertSchema.parse(payload);
  return await gatewayService.upsertHookAgentInCloud(parsed);
});

ipcMain.handle('pipeline:delete-hook-agent', async (_event, payload: unknown) => {
  const parsed = pipelineHookAgentDeleteSchema.parse(payload);
  return await gatewayService.deleteHookAgentFromCloud(parsed.agentId);
});

ipcMain.handle('pipeline:list-mailboxes', async () => {
  await ensureCloudConnected('pipeline:list-mailboxes');
  return await gatewayService.requestCloudMethod('mail.account.list', {}, 12_000);
});

ipcMain.handle('pipeline:connect-mailbox', async (_event, payload: unknown) => {
  const parsed = pipelineConnectMailboxSchema.parse(payload);
  await ensureCloudConnected('pipeline:connect-mailbox');
  if (parsed.action === 'start') {
    return await gatewayService.requestCloudMethod(
      'mail.account.connect.start',
      {
        provider: parsed.provider,
        mailboxId: parsed.mailboxId,
        redirectUri: parsed.redirectUri,
      },
      12_000,
    );
  }
  if (parsed.action === 'complete') {
    return await gatewayService.requestCloudMethod(
      'mail.account.connect.complete',
      {
        provider: parsed.provider,
        mailboxId: parsed.mailboxId,
        sessionId: parsed.sessionId,
        externalAccountId: parsed.externalAccountId,
        tokenRef: parsed.tokenRef,
        scopes: parsed.scopes,
      },
      12_000,
    );
  }
  return await gatewayService.requestCloudMethod(
    'mail.account.disconnect',
    { accountId: parsed.accountId },
    12_000,
  );
});

ipcMain.handle('pipeline:provision-capzero-mailbox', async (_event, payload: unknown) => {
  const parsed = pipelineProvisionCapzeroMailboxSchema.parse(payload);
  await ensureCloudConnected('pipeline:provision-capzero-mailbox');
  return await gatewayService.requestCloudMethod('mail.account.provision.capzero', parsed, 12_000);
});

ipcMain.handle('pipeline:list-mail-threads', async (_event, payload: unknown) => {
  const parsed = pipelineListMailThreadsSchema.parse(payload);
  await ensureCloudConnected('pipeline:list-mail-threads');
  return await gatewayService.requestCloudMethod('mail.inbox.list', parsed ?? {}, 12_000);
});

ipcMain.handle('pipeline:get-mail-thread', async (_event, payload: unknown) => {
  const parsed = pipelineGetMailThreadSchema.parse(payload);
  await ensureCloudConnected('pipeline:get-mail-thread');
  return await gatewayService.requestCloudMethod('mail.thread.get', parsed, 12_000);
});

ipcMain.handle('pipeline:create-mail-alias', async (_event, payload: unknown) => {
  const parsed = pipelineCreateMailAliasSchema.parse(payload);
  await ensureCloudConnected('pipeline:create-mail-alias');
  return await gatewayService.requestCloudMethod('mail.alias.create', parsed, 12_000);
});

ipcMain.handle('pipeline:burn-mail-alias', async (_event, payload: unknown) => {
  const parsed = pipelineBurnMailAliasSchema.parse(payload);
  await ensureCloudConnected('pipeline:burn-mail-alias');
  return await gatewayService.requestCloudMethod(
    parsed.restore ? 'mail.alias.restore' : 'mail.alias.burn',
    { aliasId: parsed.aliasId },
    12_000,
  );
});

ipcMain.handle('pipeline:upload-mail-attachment', async (_event, payload: unknown) => {
  const parsed = pipelineUploadMailAttachmentSchema.parse(payload);
  await ensureCloudConnected('pipeline:upload-mail-attachment');
  if (parsed.action === 'init') {
    return await gatewayService.requestCloudMethod('mail.attachment.upload.init', parsed, 12_000);
  }
  if (parsed.action === 'complete') {
    return await gatewayService.requestCloudMethod(
      'mail.attachment.upload.complete',
      { attachmentId: parsed.attachmentId, scanStatus: parsed.scanStatus },
      12_000,
    );
  }
  return await gatewayService.requestCloudMethod(
    'mail.attachment.download.url',
    { attachmentId: parsed.attachmentId },
    12_000,
  );
});

ipcMain.handle('pipeline:send-mail-draft', async (_event, payload: unknown) => {
  const parsed = pipelineSendMailDraftSchema.parse(payload);
  await ensureCloudConnected('pipeline:send-mail-draft');
  return await gatewayService.requestCloudMethod('mail.send', parsed, 20_000);
});

ipcMain.handle('pipeline:get-mail-health', async (_event, payload: unknown) => {
  const parsed = pipelineGetMailHealthSchema.parse(payload);
  await ensureCloudConnected('pipeline:get-mail-health');
  return await gatewayService.requestCloudMethod('mail.health.snapshot', parsed ?? {}, 12_000);
});

ipcMain.handle('dev-orchestrator:list', async () => {
  return await devOrchestratorList();
});

ipcMain.handle('dev-orchestrator:start', async (_event, payload: unknown) => {
  const parsed = devOrchestratorActionSchema.parse(payload);
  const scope = normalizeDevOrchestratorScope(parsed.scope);
  const result = await devOrchestratorControl(
    'start',
    scope,
    parsed.services as DevOrchestratorService[] | undefined,
  );
  void ensureCloudConnected('dev-orchestrator:start').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(start) failed: ${String(error)}`);
  });
  return result;
});

ipcMain.handle('dev-orchestrator:stop', async (_event, payload: unknown) => {
  const parsed = devOrchestratorActionSchema.parse(payload);
  const scope = normalizeDevOrchestratorScope(parsed.scope);
  const result = await devOrchestratorControl(
    'stop',
    scope,
    parsed.services as DevOrchestratorService[] | undefined,
  );
  void ensureCloudConnected('dev-orchestrator:stop').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(stop) failed: ${String(error)}`);
  });
  return result;
});

ipcMain.handle('dev-orchestrator:restart', async (_event, payload: unknown) => {
  const parsed = devOrchestratorActionSchema.parse(payload);
  const scope = normalizeDevOrchestratorScope(parsed.scope);
  const result = await devOrchestratorControl(
    'restart',
    scope,
    parsed.services as DevOrchestratorService[] | undefined,
  );
  void ensureCloudConnected('dev-orchestrator:restart').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(restart) failed: ${String(error)}`);
  });
  return result;
});

ipcMain.handle('dev-orchestrator:delete', async (_event, payload: unknown) => {
  const parsed = devOrchestratorActionSchema.parse(payload);
  const scope = normalizeDevOrchestratorScope(parsed.scope);
  return await devOrchestratorControl('delete', scope);
});

ipcMain.handle('dev-orchestrator:logs', async (_event, payload: unknown) => {
  const parsed = devOrchestratorLogsSchema.parse(payload);
  return await devOrchestratorLogs(parsed.processName, parsed.lines ?? 200);
});

ipcMain.handle('dev-orchestrator:logs-live', async (_event, payload: unknown) => {
  const parsed = devOrchestratorLiveLogsSchema.parse(payload);
  return await devOrchestratorLiveLogs(
    parsed.processName,
    parsed.cursor,
    parsed.fromNow ?? false,
    parsed.maxBytes ?? 256 * 1024,
  );
});

ipcMain.handle('dev-orchestrator:wrangler-logs', async (_event, payload: unknown) => {
  const parsed = devOrchestratorWranglerLogsSchema.parse(payload);
  return tailWranglerLocalLogs(parsed.cloudPort, parsed.lines ?? 200);
});

ipcMain.handle('dev-orchestrator:health', async () => {
  return await devOrchestratorHealth();
});

ipcMain.handle('dev-orchestrator:rescan', async () => {
  const result = await devOrchestratorRescan();
  void ensureCloudConnected('dev-orchestrator:rescan').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(rescan) failed: ${String(error)}`);
  });
  return result;
});

ipcMain.handle('dev-orchestrator:set-worktree-enabled', async (_event, payload: unknown) => {
  const parsed = devOrchestratorSetWorktreeEnabledSchema.parse(payload);
  return await devOrchestratorSetWorktreeEnabled(parsed.worktreeKey, parsed.enabled);
});

ipcMain.handle('dev-orchestrator:set-worktree-profile', async (_event, payload: unknown) => {
  const parsed = devOrchestratorSetWorktreeProfileSchema.parse(payload);
  return await devOrchestratorSetWorktreeProfile(parsed.worktreeKey, parsed.profile ?? null);
});

ipcMain.handle('dev-orchestrator:set-worktree-label', async (_event, payload: unknown) => {
  const parsed = devOrchestratorSetWorktreeLabelSchema.parse(payload);
  return await devOrchestratorSetWorktreeLabel(parsed.worktreeKey, parsed.label ?? null);
});

ipcMain.handle('dev-orchestrator:cleanup-stale', async () => {
  return await devOrchestratorCleanupStale();
});

ipcMain.handle('dev-orchestrator:start-current-worktree-cloud', async () => {
  const result = await devOrchestratorStartCurrentWorktreeCloud();
  void ensureCloudConnected('dev-orchestrator:start-current-worktree-cloud').catch((error) => {
    log.warn(`[gateway] ensureCloudConnected(start-current-worktree-cloud) failed: ${String(error)}`);
  });
  return result;
});

ipcMain.handle('dev-orchestrator:status-current-worktree', async () => {
  return await devOrchestratorStatusCurrentWorktree();
});

ipcMain.handle('dev-orchestrator:cloud-health-probe', async (_event, payload: unknown) => {
  const { port } = z.object({ port: z.number().int().min(1).max(65535) }).parse(payload);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const body = await resp.json() as unknown;
    return { ok: resp.ok, status: resp.status, body };
  } catch (err) {
    return { ok: false, status: null, body: null, error: String(err) };
  }
});

ipcMain.handle('pipeline:ensure-provider-ready', async (_event, payload: unknown) => {
  const { provider, runtime, capabilityProbe, model } = pipelineEnsureProviderReadySchema.parse(payload);
  return await ensureProviderReady(provider, runtime, {
    capabilityProbe,
    model,
  });
});

ipcMain.handle('pipeline:recheck-provider-status', async (_event, payload: unknown) => {
  const { provider, runtime, capabilityProbe, model } = pipelineEnsureProviderReadySchema.parse(payload);
  return await ensureProviderReady(provider, runtime, {
    capabilityProbe,
    model,
  });
});

ipcMain.handle('pipeline:chat-send', async (_event, payload: unknown) => {
  const req = pipelineChatSendSchema.parse(payload);
  const preflight = await ensureProviderReady(req.provider, req.runtime);
  if (!preflight.ready) {
    return {
      ok: false as const,
      error: preflight.reason ?? 'provider not ready',
      blockedBy: preflight.local ? 'no-cloud-token' : 'no-token',
    };
  }

  // Route local/auto-local chat through the local OpenClaw websocket path.
  if (req.runtime === 'local' || (req.runtime === 'auto' && preflight.local && !preflight.cloud)) {
    const state = await gatewayService.getState();
    if (state.connectionMode !== 'local' || state.connectionStatus !== 'connected' || !gatewayService.isAuthenticated()) {
      await gatewayService.connect();
    }
    const postConnect = await gatewayService.getState();
    if (postConnect.connectionMode !== 'local' || postConnect.connectionStatus !== 'connected' || !gatewayService.isAuthenticated()) {
      return {
        ok: false as const,
        error: postConnect.connectionDetail || 'local OpenClaw websocket not connected',
        blockedBy: 'not-connected' as const,
      };
    }
  } else if (req.runtime === 'cloud') {
    // Ensure cloud WS is connected for cloud runtime
    await ensureCloudConnected('pipeline:chat-send');
    const cloudState = await gatewayService.getState();
    const cloudReady = gatewayService.isAuthenticated()
      && cloudState.connectionMode !== 'local'
      && cloudState.connectionScope === 'cloud';
    if (!cloudReady) {
      const waited = await gatewayService.waitForCloudReady(12_000);
      if (!waited) {
        const state = await gatewayService.getState();
        return {
          ok: false as const,
          error: state.connectionDetail || 'cloud gateway not connected — ensure Clerk auth completed',
          blockedBy: 'not-connected' as const,
        };
      }
    }
  }

  try {
    const result = await gatewayService.sendChat({
      sessionKey: req.sessionId,
      message: req.message,
      attachments: req.attachments,
      provider: req.provider,
      model: req.model,
      idempotencyKey: req.idempotencyKey,
    });
    return {
      ok: true as const,
      runId: result.runId,
      status: result.status,
      healed: preflight.healed,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: detail || 'chat send failed',
    };
  }
});

ipcMain.handle('pipeline:list-provider-models', async (_event, payload: unknown) => {
  const { provider } = pipelineListProviderModelsSchema.parse(payload);
  const models = await localOpenclawManager.listProviderModels(provider);
  return { provider, models };
});

ipcMain.handle('pipeline:list-auth-profiles', () => {
  return localOpenclawManager.listAuthProfiles();
});

ipcMain.handle('pipeline:get-auth-store-diagnostics', () => {
  return localOpenclawManager.getAuthStoreDiagnostics();
});

ipcMain.handle('pipeline:get-auth-profile-secret', (_event, payload: unknown) => {
  const { profileId } = pipelineGetAuthProfileSecretSchema.parse(payload);
  return localOpenclawManager.getAuthProfileSecret(profileId);
});

// ---------------------------------------------------------------------------
// STT (Speech-to-Text) IPC
// ---------------------------------------------------------------------------

ipcMain.handle('stt:getStatus', () => {
  return sttManager.getStatus();
});

ipcMain.handle('stt:ensureReady', async () => {
  return await sttManager.ensureReady();
});

ipcMain.handle('stt:startListening', () => {
  return sttManager.startListening();
});

ipcMain.handle('stt:stopListening', () => {
  return sttManager.stopListening();
});

ipcMain.handle('stt:cancelListening', () => {
  sttManager.cancelListening();
});

ipcMain.on('stt:audio', (_event, payload: { sessionId: string; pcm: ArrayBuffer }) => {
  try {
    sttManager.processAudio(payload.sessionId, new Float32Array(payload.pcm));
  } catch (error) {
    log.error('[stt] processAudio error:', error);
  }
});

// ---------------------------------------------------------------------------
// Auto-update IPC
// ---------------------------------------------------------------------------

ipcMain.handle('app:update-check', async () => {
  if (!app.isPackaged) return { available: false, version: null };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: Boolean(result?.updateInfo?.version), version: result?.updateInfo?.version ?? null };
  } catch {
    return { available: false, version: null };
  }
});

// Called by the renderer when the user clicks "Restart and Update".
ipcMain.handle('app:update-install', () => {
  autoUpdater.quitAndInstall();
});
