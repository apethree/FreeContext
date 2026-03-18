import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createPublicKey, randomUUID } from 'node:crypto';
import net from 'node:net';
import {
  normalizeOAuthProviderId,
  normalizePiProviderId,
  type GatewayTokenSyncPayload,
} from '@/gateway/tokenSyncTypes';

type OAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  [key: string]: unknown;
};

type TokenCredentials = {
  token: string;
};

type LocalAuthProfileInput =
  | ({
      type: 'token';
      provider: string;
    } & TokenCredentials)
  | ({
      type: 'oauth';
      provider: string;
    } & OAuthCredentials);

type OAuthPrompt = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

type OAuthAuthInfo = {
  url: string;
  instructions?: string;
};

type OAuthLoginCallbacks = {
  onAuth: (info: OAuthAuthInfo) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  signal?: AbortSignal;
};

type OAuthProviderInterface = {
  id: string;
  name: string;
  login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
};

type PiAiModelEntry = {
  id?: unknown;
  name?: unknown;
};

type LocalRuntimeStatus = 'stopped' | 'starting' | 'running' | 'failed';

type LaunchCandidate = {
  command: string;
  argsPrefix: string[];
  cwd?: string;
  label: string;
};

type RuntimeCandidateSummary = {
  label: string;
  command: string;
  cwd: string | null;
};

export type LocalOpenclawRuntimeCheck = {
  checkedAtMs: number;
  packagedOnly: boolean;
  expectedBinaryName: string;
  expectedPaths: string[];
  foundPaths: string[];
  candidates: RuntimeCandidateSummary[];
  hasRuntime: boolean;
  detail: string;
};

export type LocalOpenclawSnapshot = {
  activeUserId: string | null;
  profileRoot: string | null;
  stateDir: string | null;
  configPath: string | null;
  status: LocalRuntimeStatus;
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
};

type ProviderOAuthStatus = {
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
};

type ProviderOAuthFlow = {
  sessionId: string;
  provider: string;
  status: 'starting' | 'awaiting_auth' | 'awaiting_input' | 'completing' | 'completed' | 'failed';
  authUrl: string | null;
  instructions: string | null;
  promptMessage: string | null;
  promptPlaceholder: string | null;
  promptAllowEmpty: boolean;
  detail: string;
  inputResolver?: (value: string) => void;
  abortController?: AbortController;
  profileId?: string;
};

type AuthProfileSummary = {
  profileId: string;
  provider: string;
  type: string;
  hasAccess: boolean;
  hasRefresh: boolean;
  expires: number | null;
  email: string | null;
};

type CredentialStoredPayload = {
  provider: string;
  profileId: string;
  token: string;
};

type ProviderSyncPayload = Omit<GatewayTokenSyncPayload, 'provider'>;

type GenerateAssistantParams = {
  provider: string;
  model: string;
  prompt: string;
  system?: string;
  thinking?: string;
  maxTokens?: number;
};

type LocalOpenclawManagerOptions = {
  packagedOnly?: boolean;
  onCredentialStored?: (payload: CredentialStoredPayload) => Promise<void> | void;
};

/** User-facing provider name → pi-ai provider ID for OAuth path */
const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: 'openai-codex',
  'openai-codex': 'openai-codex',
  anthropic: 'anthropic',
  gemini: 'google-gemini-cli',
  'gemini-cli': 'google-gemini-cli',
  'google-gemini-cli': 'google-gemini-cli',
};

/** User-facing provider name → pi-ai provider ID for API-key path */
const APIKEY_PROVIDER_MAP: Record<string, string> = {
  openai: 'openai',
  'openai-codex': 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  'gemini-cli': 'google',
  'google-gemini-cli': 'google',
};

const PROFILE_ROOT = path.join(os.homedir(), '.oneshot', 'profiles');
const LOCAL_GATEWAY_PORT = 18890;

function sanitizeUserId(userId: string) {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readJson(pathname: string): Record<string, unknown> {
  if (!fs.existsSync(pathname)) return {};
  try {
    const raw = fs.readFileSync(pathname, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(pathname: string, value: unknown) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, JSON.stringify(value, null, 2));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function summarizeOauthUrl(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
      hasState: parsed.searchParams.has('state'),
      hasCode: parsed.searchParams.has('code'),
      searchKeys: [...parsed.searchParams.keys()].sort(),
    };
  } catch {
    return { invalidUrl: true };
  }
}

function resolveAppRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (current) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: unknown };
        if (pkg?.name === 'one-shot') return current;
      } catch {
        // noop
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function resolveCandidates(packagedOnly = false): LaunchCandidate[] {
  const candidates: LaunchCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: LaunchCandidate) => {
    const key = `${candidate.command}\0${candidate.argsPrefix.join('\0')}\0${candidate.cwd ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const packagedBin = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
  const resourcesRoot = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const packagedPaths = resourcesRoot
    ? [
      path.join(resourcesRoot, 'openclaw-runtime', packagedBin),
      path.join(resourcesRoot, 'app.asar.unpacked', 'openclaw-runtime', packagedBin),
    ]
    : [];
  for (const p of packagedPaths) {
    if (fs.existsSync(p)) {
      add({ command: p, argsPrefix: [], label: `packaged:${p}` });
    }
  }

  if (!packagedOnly) {
    const roots = [resolveAppRoot(process.cwd()), resolveAppRoot(__dirname)].filter((v): v is string => Boolean(v));
    for (const root of roots) {
      const bundledDevPath = path.join(root, 'resources', 'openclaw-runtime', packagedBin);
      if (fs.existsSync(bundledDevPath)) {
        add({ command: bundledDevPath, argsPrefix: [], label: `bundled-dev:${bundledDevPath}` });
      }
    }
  }
  return candidates;
}

function expectedRuntimePaths(packagedOnly = false): string[] {
  const expected: string[] = [];
  const packagedBin = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
  const resourcesRoot = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (resourcesRoot) {
    expected.push(path.join(resourcesRoot, 'openclaw-runtime', packagedBin));
    expected.push(path.join(resourcesRoot, 'app.asar.unpacked', 'openclaw-runtime', packagedBin));
  }

  if (!packagedOnly) {
    const roots = [resolveAppRoot(process.cwd()), resolveAppRoot(__dirname)].filter((v): v is string => Boolean(v));
    for (const root of roots) {
      expected.push(path.join(root, 'resources', 'openclaw-runtime', packagedBin));
    }
  }

  return Array.from(new Set(expected));
}

export class LocalOpenclawManager {
  private readonly options: LocalOpenclawManagerOptions;
  private activeUserId: string | null = null;

  private profileRoot: string | null = null;

  private stateDir: string | null = null;

  private configPath: string | null = null;

  private launcherLabel: string | null = null;

  private child: ChildProcess | null = null;

  private status: LocalRuntimeStatus = 'stopped';

  private detail = 'not started';

  private startedAtMs: number | null = null;

  private readonly providerOAuthFlows = new Map<string, ProviderOAuthFlow>();

  private readonly logTail: string[] = [];

  private launchCandidateUsed: LaunchCandidate | null = null;

  private lastGatewayStatus: { checkedAtMs: number; ok: boolean; detail: string; output: string } = {
    checkedAtMs: 0,
    ok: false,
    detail: 'status not checked',
    output: '',
  };

  constructor(options: LocalOpenclawManagerOptions = {}) {
    this.options = options;
  }

  runtimeCheck(): LocalOpenclawRuntimeCheck {
    const packagedOnly = Boolean(this.options.packagedOnly);
    const expectedBinaryName = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
    const expectedPaths = expectedRuntimePaths(packagedOnly);
    const foundPaths = expectedPaths.filter((candidate) => fs.existsSync(candidate));
    const candidates = resolveCandidates(packagedOnly).map((candidate) => ({
      label: candidate.label,
      command: candidate.command,
      cwd: candidate.cwd ?? null,
    }));
    const hasRuntime = candidates.length > 0;
    const detail = hasRuntime
      ? `Runtime candidate(s) found: ${candidates.map((candidate) => candidate.label).join(', ')}`
      : 'No One Shot OpenClaw runtime found. Expected resources/openclaw-runtime/openclaw(.exe).';

    return {
      checkedAtMs: Date.now(),
      packagedOnly,
      expectedBinaryName,
      expectedPaths,
      foundPaths,
      candidates,
      hasRuntime,
      detail,
    };
  }

  setActiveUser(userId: string | null) {
    const normalized = userId?.trim() || null;
    if (!normalized) {
      this.activeUserId = null;
      this.profileRoot = null;
      this.stateDir = null;
      this.configPath = null;
      this.status = 'stopped';
      this.detail = 'No active user selected.';
      return this.snapshot();
    }

    const profileId = sanitizeUserId(normalized);
    this.activeUserId = normalized;
    this.profileRoot = path.join(PROFILE_ROOT, profileId);
    this.stateDir = path.join(this.profileRoot, 'openclaw');
    this.configPath = path.join(this.stateDir, 'openclaw.json');

    this.ensureProfileBootstrap();
    return this.snapshot();
  }

  private ensureProfileBootstrap() {
    if (!this.profileRoot || !this.stateDir || !this.configPath || !this.activeUserId) return;

    fs.mkdirSync(this.profileRoot, { recursive: true });
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.mkdirSync(path.join(this.profileRoot, 'workspace'), { recursive: true });
    fs.mkdirSync(path.join(this.profileRoot, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(this.stateDir, 'agents', 'main', 'agent'), { recursive: true });

    if (!fs.existsSync(this.configPath)) {
      writeJson(this.configPath, {
        agents: {
          defaults: {
            model: {
              primary: 'openai-codex/gpt-5.3-codex',
            },
          },
        },
        gateway: {
          bind: 'loopback',
          port: LOCAL_GATEWAY_PORT,
          mode: 'local',
        },
      });
      return;
    }

    // Keep older profiles aligned with One Shot's dedicated local gateway port
    // and ensure a default model is configured.
    const cfg = readJson(this.configPath);
    const gateway = (cfg.gateway && typeof cfg.gateway === 'object')
      ? (cfg.gateway as Record<string, unknown>)
      : {};
    gateway.bind = 'loopback';
    gateway.mode = 'local';
    gateway.port = LOCAL_GATEWAY_PORT;
    cfg.gateway = gateway;

    // Ensure agents.defaults.model.primary is set so the agent knows which model to use.
    const agents = (cfg.agents && typeof cfg.agents === 'object')
      ? (cfg.agents as Record<string, unknown>)
      : {};
    const defaults = (agents.defaults && typeof agents.defaults === 'object')
      ? (agents.defaults as Record<string, unknown>)
      : {};
    const model = (defaults.model && typeof defaults.model === 'object')
      ? (defaults.model as Record<string, unknown>)
      : {};
    if (!model.primary) {
      model.primary = 'openai-codex/gpt-5.3-codex';
    }
    defaults.model = model;
    agents.defaults = defaults;
    cfg.agents = agents;

    writeJson(this.configPath, cfg);
  }

  /**
   * Read the gateway's own device identity from `{stateDir}/identity/device.json`.
   * This is the keypair the binary generated on first run and auto-paired.
   * For local connections we authenticate AS this device (proof of local access).
   */
  getDeviceIdentity(): { deviceId: string; privateKeyPem: string; publicKeyBase64url: string } | null {
    if (!this.stateDir) return null;
    const identityPath = path.join(this.stateDir, 'identity', 'device.json');
    const identity = readJson(identityPath);
    const deviceId = typeof identity.deviceId === 'string' ? identity.deviceId : '';
    const privateKeyPem = typeof identity.privateKeyPem === 'string' ? identity.privateKeyPem : '';
    const publicKeyPem = typeof identity.publicKeyPem === 'string' ? identity.publicKeyPem : '';
    if (!deviceId || !privateKeyPem || !publicKeyPem) return null;
    // Extract raw 32-byte Ed25519 public key from SPKI PEM and encode as base64url.
    try {
      const keyObj = createPublicKey(publicKeyPem);
      const der = keyObj.export({ type: 'spki', format: 'der' }) as Buffer;
      const publicKeyBase64url = der.slice(-32).toString('base64url');
      return { deviceId, privateKeyPem, publicKeyBase64url };
    } catch {
      return null;
    }
  }

  /**
   * Read the stored device auth token from `{stateDir}/identity/device-auth.json`.
   * This token was issued by the gateway on a previous successful connect
   * and grants the device full operator scopes.
   */
  getDeviceAuthToken(role = 'operator'): { token: string; role: string; scopes: string[] } | null {
    if (!this.stateDir) return null;
    const authPath = path.join(this.stateDir, 'identity', 'device-auth.json');
    const store = readJson(authPath);
    const tokens = (store.tokens && typeof store.tokens === 'object')
      ? (store.tokens as Record<string, unknown>)
      : {};
    const entry = (tokens[role] && typeof tokens[role] === 'object')
      ? (tokens[role] as Record<string, unknown>)
      : null;
    if (!entry) return null;
    const token = typeof entry.token === 'string' ? entry.token.trim() : '';
    if (!token) return null;
    return {
      token,
      role: typeof entry.role === 'string' ? entry.role : role,
      scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((s): s is string => typeof s === 'string') : [],
    };
  }

  /**
   * Persist a device auth token returned by the gateway after successful connect.
   */
  storeDeviceAuthToken(deviceId: string, role: string, token: string, scopes: string[]) {
    if (!this.stateDir) return;
    const authPath = path.join(this.stateDir, 'identity', 'device-auth.json');
    const store = readJson(authPath);
    const tokens = (store.tokens && typeof store.tokens === 'object')
      ? (store.tokens as Record<string, unknown>)
      : {};
    tokens[role] = { token, role, scopes, updatedAtMs: Date.now() };
    store.version = 1;
    store.deviceId = deviceId;
    store.tokens = tokens;
    writeJson(authPath, store);
  }

  /** Read the gateway auth credentials from the active profile's openclaw config. */
  getGatewayAuth(): { mode: 'token'; token: string } | { mode: 'password'; password: string } | null {
    if (!this.configPath) return null;
    const cfg = readJson(this.configPath);
    const gateway = (cfg.gateway && typeof cfg.gateway === 'object')
      ? (cfg.gateway as Record<string, unknown>)
      : {};
    const auth = (gateway.auth && typeof gateway.auth === 'object')
      ? (gateway.auth as Record<string, unknown>)
      : {};
    const mode = typeof auth.mode === 'string' ? auth.mode : 'token';
    if (mode === 'password') {
      const password = typeof auth.password === 'string' ? auth.password.trim() : '';
      return password ? { mode: 'password', password } : null;
    }
    const token = typeof auth.token === 'string' ? auth.token.trim() : '';
    return token ? { mode: 'token', token } : null;
  }

  private getGatewayAuthArgs() {
    if (!this.configPath) return [] as string[];
    const cfg = readJson(this.configPath);
    const gateway = (cfg.gateway && typeof cfg.gateway === 'object')
      ? (cfg.gateway as Record<string, unknown>)
      : {};
    const auth = (gateway.auth && typeof gateway.auth === 'object')
      ? (gateway.auth as Record<string, unknown>)
      : {};
    const mode = typeof auth.mode === 'string' ? auth.mode : 'token';
    if (mode === 'password') {
      const password = typeof auth.password === 'string' ? auth.password.trim() : '';
      return password ? ['--password', password] : [];
    }
    const token = typeof auth.token === 'string' ? auth.token.trim() : '';
    return token ? ['--token', token] : [];
  }

  private appendLog(stream: 'stdout' | 'stderr', chunk: string) {
    const lines = chunk
      .split(/\r?\n/g)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return;
    for (const line of lines) {
      this.logTail.unshift(`${new Date().toISOString()} [${stream}] ${line}`);
    }
    if (this.logTail.length > 200) {
      this.logTail.length = 200;
    }
  }

  private async probeGatewayPort() {
    const checkedAtMs = Date.now();
    const detailPrefix = `127.0.0.1:${LOCAL_GATEWAY_PORT}`;
    return await new Promise<{ checkedAtMs: number; port: number; reachable: boolean; detail: string }>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (reachable: boolean, detail: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          checkedAtMs,
          port: LOCAL_GATEWAY_PORT,
          reachable,
          detail,
        });
      };
      socket.setTimeout(700);
      socket.once('connect', () => done(true, `${detailPrefix} reachable`));
      socket.once('timeout', () => done(false, `${detailPrefix} probe timeout`));
      socket.once('error', (error) => done(false, `${detailPrefix} ${String(error)}`));
      socket.connect(LOCAL_GATEWAY_PORT, '127.0.0.1');
    });
  }

  private async probeGatewayStatus() {
    const candidate = this.launchCandidateUsed ?? resolveCandidates(Boolean(this.options.packagedOnly))[0];
    if (!candidate) {
      return {
        checkedAtMs: Date.now(),
        ok: false,
        detail: 'status probe unavailable (no launch candidate)',
        output: '',
      };
    }
    if (Date.now() - this.lastGatewayStatus.checkedAtMs < 8_000) {
      return this.lastGatewayStatus;
    }
    const targetUrl = `ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`;
    const authArgs = this.getGatewayAuthArgs();
    const args = [
      ...candidate.argsPrefix,
      'gateway',
      'call',
      'health',
      '--url',
      targetUrl,
      ...authArgs,
      '--timeout',
      '2500',
      '--json',
    ];
    const checkedAtMs = Date.now();
    const result = await new Promise<{ ok: boolean; detail: string; output: string }>((resolve) => {
      const proc = spawn(candidate.command, args, {
        cwd: candidate.cwd,
        env: this.runtimeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // noop
        }
        resolve({
          ok: false,
          detail: `gateway health probe timed out (${targetUrl})`,
          output: `${stdout}${stderr}`.trim(),
        });
      }, 4_000);
      proc.stdout?.on('data', (chunk: string | Buffer) => {
        stdout += String(chunk);
      });
      proc.stderr?.on('data', (chunk: string | Buffer) => {
        stderr += String(chunk);
      });
      proc.once('error', (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          detail: `gateway health probe failed: ${String(error)}`,
          output: `${stdout}${stderr}`.trim(),
        });
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          detail: code === 0
            ? `gateway health probe ok (${targetUrl})`
            : `gateway health probe exited with code ${String(code)} (${targetUrl})`,
          output: `${stdout}${stderr}`.trim(),
        });
      });
    });
    this.lastGatewayStatus = {
      checkedAtMs,
      ok: result.ok,
      detail: result.detail,
      output: result.output,
    };
    return this.lastGatewayStatus;
  }

  private reconcileExternalRuntimeObservation(
    gatewayProbe: { checkedAtMs: number; port: number; reachable: boolean; detail: string },
    gatewayStatus: { checkedAtMs: number; ok: boolean; detail: string; output: string },
  ) {
    if (this.child) {
      return;
    }

    if (gatewayProbe.reachable && gatewayStatus.ok) {
      if (this.status !== 'running') {
        this.status = 'running';
      }
      if (!this.launcherLabel) {
        this.launcherLabel = 'existing-process';
      }
      if (!this.startedAtMs) {
        this.startedAtMs = Date.now();
      }
      this.detail = 'Using existing local OpenClaw runtime.';
      return;
    }

    if (!gatewayProbe.reachable && this.launcherLabel === 'existing-process') {
      this.launcherLabel = null;
      this.startedAtMs = null;
      if (this.status === 'running') {
        this.status = 'stopped';
        this.detail = 'Not running';
      }
    }
  }

  private async runGatewayControl(
    action: 'stop' | 'status',
    timeoutMs = 5_000,
  ): Promise<{ ok: boolean; detail: string; output: string }> {
    const candidate = this.launchCandidateUsed ?? resolveCandidates(Boolean(this.options.packagedOnly))[0];
    if (!candidate) {
      return { ok: false, detail: `gateway ${action}: no launch candidate`, output: '' };
    }
    const args = [...candidate.argsPrefix, 'gateway', action];
    return await new Promise<{ ok: boolean; detail: string; output: string }>((resolve) => {
      const proc = spawn(candidate.command, args, {
        cwd: candidate.cwd,
        env: this.runtimeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // noop
        }
        resolve({
          ok: false,
          detail: `gateway ${action} timed out`,
          output: `${stdout}${stderr}`.trim(),
        });
      }, timeoutMs);
      proc.stdout?.on('data', (chunk: string | Buffer) => {
        stdout += String(chunk);
      });
      proc.stderr?.on('data', (chunk: string | Buffer) => {
        stderr += String(chunk);
      });
      proc.once('error', (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          detail: `gateway ${action} failed: ${String(error)}`,
          output: `${stdout}${stderr}`.trim(),
        });
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          detail: code === 0 ? `gateway ${action} ok` : `gateway ${action} exited with code ${String(code)}`,
          output: `${stdout}${stderr}`.trim(),
        });
      });
    });
  }

  private async waitForPortState(expectedReachable: boolean, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const probe = await this.probeGatewayPort();
      if (probe.reachable === expectedReachable) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  private pidListeningOnGatewayPort(): number | null {
    const result = spawnSync('lsof', ['-nP', '-iTCP:18890', '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = String(result.stdout || '').trim();
    if (!output) return null;
    const first = output.split(/\s+/g).find(Boolean) ?? '';
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  private forceStopGatewayPortOwner(): boolean {
    const pid = this.pidListeningOnGatewayPort();
    if (!pid) return false;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return false;
    }
    return true;
  }

  private runtimeEnv(): NodeJS.ProcessEnv {
    if (!this.stateDir || !this.configPath || !this.profileRoot) return process.env;
    return {
      ...process.env,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath,
      OPENCLAW_GATEWAY_PORT: String(LOCAL_GATEWAY_PORT),
      OPENCLAW_AGENT_DIR: path.join(this.stateDir, 'agents', 'main', 'agent'),
      OPENCLAW_WORKSPACE_DIR: path.join(this.profileRoot, 'workspace'),
    };
  }

  async start() {
    if (!this.activeUserId || !this.profileRoot || !this.stateDir || !this.configPath) {
      throw new Error('set active user before starting local openclaw');
    }
    if (this.child) return this.snapshot();

    this.ensureProfileBootstrap();
    this.status = 'starting';
    this.detail = 'Starting local OpenClaw gateway...';

    const preProbe = await this.probeGatewayPort();
    const preStatus = await this.probeGatewayStatus();
    this.reconcileExternalRuntimeObservation(preProbe, preStatus);
    if (preProbe.reachable && preStatus.ok) {
      this.appendLog('stdout', 'local runtime already running; adopted existing process');
      return this.snapshot(preProbe, preStatus);
    }

    const preStop = await this.runGatewayControl('stop', 3_000);
    if (preStop.output.trim()) {
      this.appendLog('stdout', preStop.output.trim());
    }
    const drainedAfterStop = await this.waitForPortState(false, 3_500);
    if (!drainedAfterStop) {
      const forced = this.forceStopGatewayPortOwner();
      if (forced) {
        this.appendLog('stderr', 'gateway stop fallback: terminated existing process on port 18890');
        await this.waitForPortState(false, 2_500);
      }
    }

    const candidates = resolveCandidates(Boolean(this.options.packagedOnly));
    if (candidates.length === 0) {
      this.status = 'failed';
      this.detail = 'No One Shot OpenClaw runtime found. Expected resources/openclaw-runtime/openclaw(.exe).';
      this.appendLog('stderr', this.detail);
      return await this.snapshotWithProbe();
    }
    let lastErr = 'No launch candidates available';
    for (const candidate of candidates) {
      const result = await new Promise<{ ok: boolean; detail: string; child?: ChildProcess; unavailable?: boolean }>((resolve) => {
        const args = [...candidate.argsPrefix, 'gateway', 'run', '--allow-unconfigured', '--bind', 'loopback', '--port', String(LOCAL_GATEWAY_PORT)];
        const child = spawn(candidate.command, args, {
          cwd: candidate.cwd,
          env: this.runtimeEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let settled = false;
        const finish = (payload: { ok: boolean; detail: string; child?: ChildProcess; unavailable?: boolean }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(payload);
        };

        child.once('error', (error) => {
          const code = (error as NodeJS.ErrnoException)?.code;
          finish({
            ok: false,
            detail: `${candidate.label}: ${String(error)}`,
            unavailable: code === 'ENOENT',
          });
        });

        child.once('exit', (code, signal) => {
          finish({ ok: false, detail: `${candidate.label}: exited early code=${String(code)} signal=${String(signal)}` });
        });

        const timer = setTimeout(() => {
          finish({ ok: true, detail: `${candidate.label}: started`, child });
        }, 900);
      });

      if (result.ok && result.child) {
        this.child = result.child;
        this.launchCandidateUsed = candidate;
        this.launcherLabel = candidate.label;
        this.status = 'running';
        this.detail = `Running via ${candidate.label}`;
        this.startedAtMs = Date.now();
        this.appendLog('stdout', `local runtime started via ${candidate.label}`);

        this.child.stdout?.setEncoding('utf8');
        this.child.stderr?.setEncoding('utf8');
        this.child.stdout?.on('data', (data: string | Buffer) => {
          this.appendLog('stdout', String(data));
        });
        this.child.stderr?.on('data', (data: string | Buffer) => {
          this.appendLog('stderr', String(data));
        });

        this.child.once('exit', (code, signal) => {
          this.child = null;
          this.launchCandidateUsed = null;
          this.status = 'failed';
          this.detail = `Local OpenClaw exited code=${String(code)} signal=${String(signal)}`;
          this.appendLog('stderr', this.detail);
        });
        return await this.snapshotWithProbe();
      }

      lastErr = result.detail;
      if (result.unavailable) {
        continue;
      }
    }

    this.status = 'failed';
    this.detail = lastErr;
    this.appendLog('stderr', this.detail);
    return await this.snapshotWithProbe();
  }

  async stop() {
    if (!this.child) {
      const probe = await this.probeGatewayPort();
      if (!probe.reachable) {
        this.status = 'stopped';
        this.detail = 'Not running';
        return await this.snapshotWithProbe();
      }

      const gracefulStop = await this.runGatewayControl('stop');
      if (gracefulStop.output.trim()) {
        this.appendLog(gracefulStop.ok ? 'stdout' : 'stderr', gracefulStop.output.trim());
      }
      const drained = await this.waitForPortState(false, 5_000);
      if (!drained) {
        const forced = this.forceStopGatewayPortOwner();
        if (forced) {
          this.appendLog('stderr', 'gateway stop fallback: terminated existing process on port 18890');
          await this.waitForPortState(false, 2_500);
        }
      }
      const finalDrained = await this.waitForPortState(false, 500);
      this.status = finalDrained ? 'stopped' : 'failed';
      this.detail = finalDrained
        ? 'Stopped'
        : 'Stop requested, but gateway port still appears occupied.';
      if (finalDrained) {
        this.launcherLabel = null;
        this.startedAtMs = null;
      }
      this.appendLog('stdout', 'local runtime stop requested (external process)');
      return await this.snapshotWithProbe();
    }

    const child = this.child;
    this.child = null;
    this.launchCandidateUsed = null;
    const gracefulStop = await this.runGatewayControl('stop');
    if (gracefulStop.output.trim()) {
      this.appendLog(gracefulStop.ok ? 'stdout' : 'stderr', gracefulStop.output.trim());
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // noop
    }

    const drained = await this.waitForPortState(false, 5_000);
    if (!drained) {
      const forced = this.forceStopGatewayPortOwner();
      if (forced) {
        this.appendLog('stderr', 'gateway stop fallback: terminated existing process on port 18890');
        await this.waitForPortState(false, 2_500);
      }
    }
    const finalDrained = await this.waitForPortState(false, 500);

    this.status = 'stopped';
    this.detail = finalDrained ? 'Stopped' : 'Stop requested, but gateway port still appears occupied.';
    if (finalDrained) {
      this.startedAtMs = null;
      this.launcherLabel = null;
    }
    this.appendLog('stdout', 'local runtime stopped');
    return await this.snapshotWithProbe();
  }

  private authStorePath() {
    if (!this.stateDir) return null;
    return path.join(this.stateDir, 'agents', 'main', 'agent', 'auth-profiles.json');
  }

  private configPathRequired() {
    if (!this.configPath) throw new Error('profile not initialized');
    return this.configPath;
  }

  private readAuthStore() {
    const authPath = this.authStorePath();
    if (!authPath) {
      throw new Error('profile not initialized');
    }
    const store = readJson(authPath);
    const profiles = (store.profiles && typeof store.profiles === 'object')
      ? (store.profiles as Record<string, unknown>)
      : {};
    const order = (store.order && typeof store.order === 'object')
      ? (store.order as Record<string, unknown>)
      : {};
    return { authPath, store, profiles, order };
  }

  private writeAuthStore(profiles: Record<string, unknown>, order: Record<string, unknown>, existingStore: Record<string, unknown>) {
    const { authPath } = this.readAuthStore();
    writeJson(authPath, {
      version: 1,
      ...existingStore,
      profiles,
      order,
    });
  }

  private updateConfigAuthEntry(provider: string, profileId: string, mode: 'oauth' | 'token') {
    const cfgPath = this.configPathRequired();
    const cfg = readJson(cfgPath);
    const auth = (cfg.auth && typeof cfg.auth === 'object') ? (cfg.auth as Record<string, unknown>) : {};
    const cfgProfiles = (auth.profiles && typeof auth.profiles === 'object') ? (auth.profiles as Record<string, unknown>) : {};
    const cfgOrder = (auth.order && typeof auth.order === 'object') ? (auth.order as Record<string, unknown>) : {};
    cfgProfiles[profileId] = {
      provider,
      mode,
    };
    cfgOrder[provider] = [profileId];
    auth.profiles = cfgProfiles;
    auth.order = cfgOrder;
    cfg.auth = auth;
    writeJson(cfgPath, cfg);
  }

  private removeConfigTokenEntries(provider: string) {
    const cfgPath = this.configPathRequired();
    const cfg = readJson(cfgPath);
    const auth = (cfg.auth && typeof cfg.auth === 'object') ? (cfg.auth as Record<string, unknown>) : {};
    const cfgProfiles = (auth.profiles && typeof auth.profiles === 'object') ? (auth.profiles as Record<string, unknown>) : {};
    const cfgOrder = (auth.order && typeof auth.order === 'object') ? (auth.order as Record<string, unknown>) : {};
    const remainingProfileIds = new Set<string>();

    for (const [profileId, raw] of Object.entries(cfgProfiles)) {
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const entryProvider = typeof record?.provider === 'string' ? record.provider.trim().toLowerCase() : '';
      const mode = typeof record?.mode === 'string' ? record.mode.trim().toLowerCase() : '';
      if (entryProvider === provider && mode === 'token') {
        delete cfgProfiles[profileId];
        continue;
      }
      remainingProfileIds.add(profileId);
    }

    const existingOrder = Array.isArray(cfgOrder[provider]) ? (cfgOrder[provider] as unknown[]) : [];
    const nextOrder = existingOrder
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .filter((profileId) => remainingProfileIds.has(profileId));
    if (nextOrder.length > 0) {
      cfgOrder[provider] = nextOrder;
    } else {
      delete cfgOrder[provider];
    }

    auth.profiles = cfgProfiles;
    auth.order = cfgOrder;
    cfg.auth = auth;
    writeJson(cfgPath, cfg);
  }

  private removeConfigProviderEntries(aliases: string[], includeModes: Set<string>) {
    const cfgPath = this.configPathRequired();
    const cfg = readJson(cfgPath);
    const auth = (cfg.auth && typeof cfg.auth === 'object') ? (cfg.auth as Record<string, unknown>) : {};
    const cfgProfiles = (auth.profiles && typeof auth.profiles === 'object') ? (auth.profiles as Record<string, unknown>) : {};
    const cfgOrder = (auth.order && typeof auth.order === 'object') ? (auth.order as Record<string, unknown>) : {};
    const aliasSet = new Set(aliases.map((v) => v.trim().toLowerCase()).filter(Boolean));
    const remainingProfileIds = new Set<string>();

    for (const [profileId, raw] of Object.entries(cfgProfiles)) {
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const entryProvider = typeof record?.provider === 'string' ? record.provider.trim().toLowerCase() : '';
      const mode = typeof record?.mode === 'string' ? record.mode.trim().toLowerCase() : '';
      if (aliasSet.has(entryProvider) && includeModes.has(mode)) {
        delete cfgProfiles[profileId];
        continue;
      }
      remainingProfileIds.add(profileId);
    }

    for (const alias of aliasSet) {
      const existingOrder = Array.isArray(cfgOrder[alias]) ? (cfgOrder[alias] as unknown[]) : [];
      const nextOrder = existingOrder
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .filter((profileId) => remainingProfileIds.has(profileId));
      if (nextOrder.length > 0) {
        cfgOrder[alias] = nextOrder;
      } else {
        delete cfgOrder[alias];
      }
    }

    auth.profiles = cfgProfiles;
    auth.order = cfgOrder;
    cfg.auth = auth;
    writeJson(cfgPath, cfg);
  }

  private providerAliases(provider: string): string[] {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) return [];
    if (normalized === 'openai' || normalized === 'openai-codex') return ['openai', 'openai-codex'];
    if (normalized === 'gemini' || normalized === 'gemini-cli' || normalized === 'google-gemini-cli') {
      return ['gemini', 'gemini-cli', 'google-gemini-cli'];
    }
    return [normalized];
  }

  private async notifyCredentialStored(payload: CredentialStoredPayload) {
    try {
      if (this.options.onCredentialStored) {
        await this.options.onCredentialStored(payload);
      }
    } catch (error) {
      this.appendLog('stderr', `credential sync callback failed: ${String(error)}`);
    }
  }

  private persistOAuthCredential(provider: string, creds: OAuthCredentials) {
    const { store, profiles, order } = this.readAuthStore();
    const email = typeof creds.email === 'string' && creds.email.trim() ? creds.email.trim() : 'default';
    const profileId = `${provider}:${email}`;
    profiles[profileId] = {
      type: 'oauth',
      provider,
      ...creds,
    };
    order[provider] = [profileId];
    this.writeAuthStore(profiles, order, store);
    this.updateConfigAuthEntry(provider, profileId, 'oauth');
    return { profileId, token: creds.access };
  }

  private persistTokenCredential(provider: string, token: string, profileHint = 'manual') {
    this.removeProviderTokens(provider);
    const profileId = `${provider}:${profileHint}`;
    const { store, profiles, order } = this.readAuthStore();
    profiles[profileId] = {
      type: 'token',
      provider,
      token,
    };
    order[provider] = [profileId];
    this.writeAuthStore(profiles, order, store);
    this.updateConfigAuthEntry(provider, profileId, 'token');
    return { profileId, token };
  }

  restoreOAuthCredential(provider: string, creds: OAuthCredentials) {
    const providerNormalized = provider.trim().toLowerCase();
    if (!providerNormalized) {
      throw new Error('provider is required');
    }
    const access = typeof creds.access === 'string' ? creds.access.trim() : '';
    if (!access) {
      throw new Error('oauth access token is required');
    }

    const existing = this.findBestAuthProfile(providerNormalized);
    const existingEntry = existing?.entry ?? null;
    const sameOauthCredential = existingEntry
      && typeof existingEntry === 'object'
      && String(existingEntry.type ?? '').trim().toLowerCase() === 'oauth'
      && String(existingEntry.access ?? '').trim() === access
      && String(existingEntry.refresh ?? '').trim() === String(creds.refresh ?? '').trim()
      && Number(existingEntry.expires ?? 0) === Number(creds.expires ?? 0)
      && String(existingEntry.email ?? '').trim() === String(creds.email ?? '').trim()
      && String(existingEntry.oauthProviderId ?? '').trim() === String(creds.oauthProviderId ?? '').trim()
      && String(existingEntry.accountId ?? '').trim() === String(creds.accountId ?? '').trim()
      && String(existingEntry.projectId ?? '').trim() === String(creds.projectId ?? '').trim();
    if (sameOauthCredential && existing) {
      return { ok: true, profileId: existing.profileId, changed: false };
    }

    const persisted = this.persistOAuthCredential(providerNormalized, {
      ...creds,
      access,
      refresh: typeof creds.refresh === 'string' ? creds.refresh.trim() : '',
      expires: typeof creds.expires === 'number' && Number.isFinite(creds.expires) ? creds.expires : 0,
      ...(typeof creds.email === 'string' && creds.email.trim() ? { email: creds.email.trim() } : {}),
    });
    this.appendLog('stdout', `[oauth] restored ${JSON.stringify({
      provider: providerNormalized,
      profileId: persisted.profileId,
      hasEmail: typeof creds.email === 'string' && creds.email.trim().length > 0,
      hasRefresh: typeof creds.refresh === 'string' && creds.refresh.trim().length > 0,
      expires: typeof creds.expires === 'number' ? creds.expires : null,
    })}`);
    return { ok: true, profileId: persisted.profileId, changed: true };
  }

  private logOAuthDiagnostics(provider: string, creds: OAuthCredentials) {
    const accessPayload = typeof creds.access === 'string' ? decodeJwtPayload(creds.access) : null;
    const refreshPayload = typeof creds.refresh === 'string' ? decodeJwtPayload(creds.refresh) : null;
    const accessAuth = accessPayload?.['https://api.openai.com/auth'];
    const accessAuthKeys = accessAuth && typeof accessAuth === 'object'
      ? Object.keys(accessAuth as Record<string, unknown>).sort()
      : [];
    const summary = {
      provider,
      returnedKeys: Object.keys(creds).sort(),
      hasEmail: typeof creds.email === 'string' && creds.email.trim().length > 0,
      email: typeof creds.email === 'string' && creds.email.trim().length > 0 ? creds.email.trim() : null,
      hasAccess: typeof creds.access === 'string' && creds.access.trim().length > 0,
      hasRefresh: typeof creds.refresh === 'string' && creds.refresh.trim().length > 0,
      expires: typeof creds.expires === 'number' ? creds.expires : null,
      accountId: typeof creds.accountId === 'string' ? creds.accountId : null,
      accessJwt: accessPayload ? {
        keys: Object.keys(accessPayload).sort(),
        email: typeof accessPayload.email === 'string' ? accessPayload.email : null,
        preferredUsername: typeof accessPayload.preferred_username === 'string' ? accessPayload.preferred_username : null,
        authKeys: accessAuthKeys,
      } : null,
      refreshJwt: refreshPayload ? {
        keys: Object.keys(refreshPayload).sort(),
        email: typeof refreshPayload.email === 'string' ? refreshPayload.email : null,
      } : null,
    };
    this.appendLog('stdout', `[oauth] login result ${JSON.stringify(summary)}`);
  }

  saveProviderToken(provider: string, token: string, profileHint = 'manual') {
    const providerNormalized = provider.trim().toLowerCase();
    if (!providerNormalized) {
      throw new Error('provider is required');
    }
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error('token is required');
    }
    const existing = this.findBestAuthProfile(providerNormalized);
    const existingType = typeof existing?.entry.type === 'string' ? existing.entry.type.trim().toLowerCase() : '';
    const existingToken = typeof existing?.entry.token === 'string' ? existing.entry.token.trim() : '';
    if (existing && existingType === 'token' && existingToken === trimmed) {
      return { ok: true, profileId: existing.profileId };
    }
    const persisted = this.persistTokenCredential(providerNormalized, trimmed, profileHint);
    void this.notifyCredentialStored({
      provider: providerNormalized,
      profileId: persisted.profileId,
      token: trimmed,
    });
    return { ok: true, profileId: persisted.profileId };
  }

  updateLocalAuthCache(provider: string, profile: LocalAuthProfileInput) {
    const providerNormalized = (profile.provider || provider).trim().toLowerCase();
    if (!providerNormalized) {
      throw new Error('provider is required');
    }

    if (profile.type === 'oauth') {
      const access = typeof profile.access === 'string' ? profile.access.trim() : '';
      if (!access) {
        throw new Error('oauth access token is required');
      }
      const persisted = this.persistOAuthCredential(providerNormalized, {
        ...profile,
        access,
        refresh: typeof profile.refresh === 'string' ? profile.refresh.trim() : '',
        expires: typeof profile.expires === 'number' && Number.isFinite(profile.expires) ? profile.expires : 0,
      });
      return {
        ok: true,
        provider: providerNormalized,
        profileId: persisted.profileId,
        type: 'oauth' as const,
      };
    }

    const token = typeof profile.token === 'string' ? profile.token.trim() : '';
    if (!token) {
      throw new Error('token is required');
    }

    const persisted = this.persistTokenCredential(providerNormalized, token);
    return {
      ok: true,
      provider: providerNormalized,
      profileId: persisted.profileId,
      type: 'token' as const,
    };
  }

  removeLocalAuthCache(provider: string) {
    return this.removeProviderProfiles(provider);
  }

  removeProviderTokens(provider: string) {
    const providerNormalized = provider.trim().toLowerCase();
    if (!providerNormalized) {
      throw new Error('provider is required');
    }
    const { store, profiles, order } = this.readAuthStore();
    const removedProfileIds: string[] = [];

    for (const [profileId, raw] of Object.entries(profiles)) {
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const entryProvider = typeof record?.provider === 'string' ? record.provider.trim().toLowerCase() : '';
      const type = typeof record?.type === 'string' ? record.type.trim().toLowerCase() : '';
      if (entryProvider !== providerNormalized || type !== 'token') {
        continue;
      }
      delete profiles[profileId];
      removedProfileIds.push(profileId);
    }

    const existingOrder = Array.isArray(order[providerNormalized]) ? (order[providerNormalized] as unknown[]) : [];
    const nextOrder = existingOrder
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .filter((profileId) => Object.prototype.hasOwnProperty.call(profiles, profileId));
    if (nextOrder.length > 0) {
      order[providerNormalized] = nextOrder;
    } else {
      delete order[providerNormalized];
    }

    this.writeAuthStore(profiles, order, store);
    this.removeConfigTokenEntries(providerNormalized);
    return {
      ok: true,
      provider: providerNormalized,
      removedProfiles: removedProfileIds,
      removedCount: removedProfileIds.length,
    };
  }

  removeProviderProfiles(provider: string) {
    const aliases = this.providerAliases(provider);
    if (aliases.length === 0) {
      throw new Error('provider is required');
    }
    const aliasSet = new Set(aliases);
    const { store, profiles, order } = this.readAuthStore();
    const removedProfileIds: string[] = [];

    for (const [profileId, raw] of Object.entries(profiles)) {
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const entryProvider = typeof record?.provider === 'string' ? record.provider.trim().toLowerCase() : '';
      const profileIdLower = profileId.trim().toLowerCase();
      const providerMatch = aliasSet.has(entryProvider);
      const idPrefixMatch = aliases.some((alias) => profileIdLower.startsWith(`${alias}:`));
      if (!providerMatch && !idPrefixMatch) continue;
      delete profiles[profileId];
      removedProfileIds.push(profileId);
    }

    for (const alias of aliases) {
      const existingOrder = Array.isArray(order[alias]) ? (order[alias] as unknown[]) : [];
      const nextOrder = existingOrder
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .filter((profileId) => Object.prototype.hasOwnProperty.call(profiles, profileId));
      if (nextOrder.length > 0) {
        order[alias] = nextOrder;
      } else {
        delete order[alias];
      }
    }

    this.writeAuthStore(profiles, order, store);
    this.removeConfigProviderEntries(aliases, new Set(['token', 'oauth']));
    return {
      ok: true,
      provider: provider.trim().toLowerCase(),
      aliases,
      removedProfiles: removedProfileIds,
      removedCount: removedProfileIds.length,
    };
  }

  startProviderOAuthSession(provider: string) {
    if (!this.activeUserId || !this.profileRoot || !this.stateDir || !this.configPath) {
      throw new Error('set active user before starting OAuth');
    }

    for (const existing of this.providerOAuthFlows.values()) {
      if (
        existing.status === 'starting' ||
        existing.status === 'awaiting_auth' ||
        existing.status === 'awaiting_input' ||
        existing.status === 'completing'
      ) {
        if (existing.abortController) {
          existing.abortController.abort('superseded');
        }
        if (existing.inputResolver) {
          existing.inputResolver('');
        }
        existing.status = 'failed';
        existing.detail = 'Superseded by a newer OAuth session.';
        delete existing.inputResolver;
      }
    }

    const sessionId = randomUUID();
    const providerNormalized = provider.trim().toLowerCase();
    if (!providerNormalized) {
      throw new Error('provider is required');
    }
    const flow: ProviderOAuthFlow = {
      sessionId,
      provider: providerNormalized,
      status: 'starting',
      authUrl: null,
      instructions: null,
      promptMessage: null,
      promptPlaceholder: null,
      promptAllowEmpty: false,
      detail: `Initializing ${providerNormalized} OAuth...`,
      abortController: new AbortController(),
    };
    this.providerOAuthFlows.set(sessionId, flow);

    void (async () => {
      try {
        // pi-ai exposes OAuth helpers on the dedicated oauth entrypoint.
        const oauthModuleId = '@mariozechner/pi-ai/oauth';
        const oauthModule = await import(/* @vite-ignore */ oauthModuleId) as Record<string, unknown>;
        const getOAuthProviderValue = oauthModule.getOAuthProvider;
        if (typeof getOAuthProviderValue !== 'function') {
          throw new Error('pi-ai getOAuthProvider() unavailable');
        }
        const getOAuthProvider = getOAuthProviderValue as (id: string) => OAuthProviderInterface | undefined;
        const providerId = OAUTH_PROVIDER_MAP[providerNormalized] ?? providerNormalized;
        const oauthProvider = getOAuthProvider(providerId);
        if (!oauthProvider) {
          throw new Error(`OAuth provider not supported in runtime: ${providerId}`);
        }

        const onAuth = ({ url, instructions }: OAuthAuthInfo) => {
          const current = this.providerOAuthFlows.get(sessionId);
          if (!current) return;
          current.authUrl = url;
          current.instructions = instructions ?? null;
          current.status = 'awaiting_auth';
          current.detail = instructions ?? 'Browser opened. Complete auth.';
          this.appendLog('stdout', `[oauth] auth step ${JSON.stringify({
            provider: providerId,
            sessionId,
            url: summarizeOauthUrl(url),
            instructions: instructions ?? null,
          })}`);
        };

        const onPrompt = async (prompt: OAuthPrompt) => {
          this.appendLog('stdout', `[oauth] prompt ${JSON.stringify({
            provider: providerId,
            sessionId,
            message: prompt.message,
            placeholder: prompt.placeholder ?? null,
            allowEmpty: Boolean(prompt.allowEmpty),
          })}`);
          return await new Promise<string>((resolve) => {
            const current = this.providerOAuthFlows.get(sessionId);
            if (!current) {
              resolve('');
              return;
            }
            current.inputResolver = resolve;
            current.promptMessage = prompt.message;
            current.promptPlaceholder = prompt.placeholder ?? null;
            current.promptAllowEmpty = Boolean(prompt.allowEmpty);
            current.status = 'awaiting_input';
            current.detail = prompt.message || 'Waiting for OAuth input from app.';
          });
        };

        const onProgress = (message: string) => {
          const current = this.providerOAuthFlows.get(sessionId);
          if (!current) return;
          current.detail = message;
          this.appendLog('stdout', `[oauth] progress ${JSON.stringify({
            provider: providerId,
            sessionId,
            message,
          })}`);
        };

        const creds = await oauthProvider.login({
          onAuth,
          onPrompt,
          onProgress,
          onManualCodeInput: async () => await onPrompt({
            message: 'Paste OAuth input from browser.',
            placeholder: 'Paste OAuth code, token, or redirect URL',
            allowEmpty: false,
          }),
          signal: flow.abortController?.signal,
        });
        this.logOAuthDiagnostics(providerId, creds);

        const current = this.providerOAuthFlows.get(sessionId);
        if (current && current.status !== 'failed') {
          current.status = 'completing';
          current.detail = `Saving ${providerId} credentials...`;
        }

        const persisted = this.persistOAuthCredential(providerId, creds);
        this.appendLog('stdout', `[oauth] persisted ${JSON.stringify({
          provider: providerId,
          sessionId,
          profileId: persisted.profileId,
          hasEmail: typeof creds.email === 'string' && creds.email.trim().length > 0,
        })}`);
        await this.notifyCredentialStored({
          provider: providerId,
          profileId: persisted.profileId,
          token: persisted.token,
        });
        if (current && current.status !== 'failed') {
          current.status = 'completed';
          current.detail = `${providerId} OAuth completed and saved.`;
          current.profileId = persisted.profileId;
          delete current.inputResolver;
        }
      } catch (error) {
        const current = this.providerOAuthFlows.get(sessionId);
        if (current) {
          if (current.status === 'failed' && current.detail === 'Superseded by a newer OAuth session.') {
            delete current.inputResolver;
            return;
          }
          current.status = 'failed';
          current.detail = current.abortController?.signal.aborted
            ? 'OAuth session canceled.'
            : String(error);
          this.appendLog('stderr', `[oauth] failed ${JSON.stringify({
            provider: providerNormalized,
            sessionId,
            aborted: Boolean(current.abortController?.signal.aborted),
            error: String(error),
          })}`);
          delete current.inputResolver;
        }
      }
    })();

    return {
      sessionId,
      provider: flow.provider,
      status: flow.status,
      authUrl: flow.authUrl,
      instructions: flow.instructions,
      promptMessage: flow.promptMessage,
      promptPlaceholder: flow.promptPlaceholder,
      promptAllowEmpty: flow.promptAllowEmpty,
      detail: flow.detail,
    };
  }

  submitProviderOAuthInput(sessionId: string, inputValue: string) {
    const flow = this.providerOAuthFlows.get(sessionId) ?? null;
    if (!flow) {
      throw new Error('oauth session not found');
    }
    if (!flow.inputResolver) {
      throw new Error('oauth flow is not awaiting input yet');
    }
    if (!flow.promptAllowEmpty && !inputValue.trim()) {
      throw new Error('oauth input is required');
    }
    const payload = flow.promptAllowEmpty ? inputValue : inputValue.trim();
    flow.inputResolver(payload);
    flow.status = 'completing';
    flow.detail = 'Processing OAuth input...';
    delete flow.inputResolver;
    return { ok: true };
  }

  cancelProviderOAuthSession(sessionId: string) {
    const flow = this.providerOAuthFlows.get(sessionId) ?? null;
    if (!flow) {
      return { ok: false, found: false };
    }

    try {
      if (flow.abortController && !flow.abortController.signal.aborted) {
        flow.abortController.abort('canceled-by-user');
      }
    } catch {
      // noop
    }

    if (flow.inputResolver) {
      try {
        flow.inputResolver('');
      } catch {
        // noop
      }
      delete flow.inputResolver;
    }

    this.providerOAuthFlows.delete(sessionId);
    return { ok: true, found: true };
  }

  getProviderOAuthStatus(sessionId: string): ProviderOAuthStatus {
    const flow = this.providerOAuthFlows.get(sessionId);
    if (!flow) return { found: false };
    return {
      found: true,
      sessionId,
      provider: flow.provider,
      status: flow.status,
      authUrl: flow.authUrl,
      instructions: flow.instructions,
      promptMessage: flow.promptMessage,
      promptPlaceholder: flow.promptPlaceholder,
      promptAllowEmpty: flow.promptAllowEmpty,
      detail: flow.detail,
      profileId: flow.profileId ?? null,
    };
  }

  listAuthProfiles() {
    const authPath = this.authStorePath();
    if (!authPath || !fs.existsSync(authPath)) {
      return [] as AuthProfileSummary[];
    }
    const store = readJson(authPath);
    const profiles = (store.profiles && typeof store.profiles === 'object')
      ? (store.profiles as Record<string, unknown>)
      : {};
    return Object.entries(profiles)
      .map(([profileId, value]) => {
        const entry = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
        return {
          profileId,
          provider: typeof entry.provider === 'string' ? entry.provider : '',
          type: typeof entry.type === 'string' ? entry.type : '',
          hasAccess: typeof entry.access === 'string' && entry.access.trim().length > 0,
          hasRefresh: typeof entry.refresh === 'string' && entry.refresh.trim().length > 0,
          expires: typeof entry.expires === 'number' ? entry.expires : null,
          email: typeof entry.email === 'string' && entry.email.trim().length > 0
            ? entry.email.trim()
            : null,
        };
      })
      .filter((entry) => entry.provider);
  }

  getAuthStoreDiagnostics() {
    const authPath = this.authStorePath();
    const exists = Boolean(authPath && fs.existsSync(authPath));
    return {
      authStorePath: authPath,
      exists,
      profileCount: this.listAuthProfiles().length,
      profiles: this.listAuthProfiles(),
    };
  }

  private normalizeProviderAlias(provider: string): string {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) return normalized;
    if (normalized === 'openai') return 'openai-codex';
    if (normalized === 'claude') return 'anthropic';
    if (normalized === 'gemini') return 'google-gemini-cli';
    if (normalized === 'gemini-cli') return 'google-gemini-cli';
    return normalized;
  }

  private findBestAuthProfile(provider: string): { profileId: string; entry: Record<string, unknown> } | null {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) return null;

    // Build set of candidate provider names covering both user-facing names and stored pi-ai IDs.
    const targets = new Set<string>([normalized]);
    if (normalized === 'openai') targets.add('openai-codex');
    if (normalized === 'openai-codex') targets.add('openai');
    if (normalized === 'gemini') { targets.add('gemini-cli'); targets.add('google-gemini-cli'); }
    if (normalized === 'gemini-cli') { targets.add('gemini'); targets.add('google-gemini-cli'); }
    if (normalized === 'google-gemini-cli') { targets.add('gemini'); targets.add('gemini-cli'); }

    const authPath = this.authStorePath();
    if (!authPath || !fs.existsSync(authPath)) return null;
    const store = readJson(authPath);
    const profiles = (store.profiles && typeof store.profiles === 'object')
      ? (store.profiles as Record<string, unknown>)
      : {};

    const matches = Object.entries(profiles)
      .map(([profileId, value]) => ({
        profileId,
        entry: (value && typeof value === 'object') ? (value as Record<string, unknown>) : {},
      }))
      .filter((item) => {
        const p = typeof item.entry.provider === 'string' ? item.entry.provider.toLowerCase() : '';
        return targets.has(p);
      });

    if (matches.length === 0) return null;

    const withAccess = matches.find((item) => typeof item.entry.access === 'string' && item.entry.access.trim().length > 0);
    if (withAccess) return withAccess;

    const withToken = matches.find((item) => typeof item.entry.token === 'string' && item.entry.token.trim().length > 0);
    if (withToken) return withToken;

    return matches[0] ?? null;
  }

  private resolveProviderSecret(provider: string): { profileId: string; provider: string; token: string } {
    const profile = this.findBestAuthProfile(provider);
    if (!profile) {
      throw new Error(`no local auth profile found for provider=${provider}`);
    }
    const providerName = typeof profile.entry.provider === 'string' ? profile.entry.provider : provider;
    const token = typeof profile.entry.access === 'string'
      ? profile.entry.access.trim()
      : (typeof profile.entry.token === 'string' ? profile.entry.token.trim() : '');
    if (!token) {
      throw new Error(`auth profile ${profile.profileId} has no usable token`);
    }
    return {
      profileId: profile.profileId,
      provider: providerName,
      token,
    };
  }

  getProviderSecret(provider: string): { profileId: string; provider: string; token: string } {
    return this.resolveProviderSecret(provider);
  }

  getProviderSyncPayload(provider: string, profileId?: string): ProviderSyncPayload {
    const normalizedProvider = provider.trim().toLowerCase();
    if (!normalizedProvider) {
      throw new Error('provider is required');
    }

    let selected: { profileId: string; entry: Record<string, unknown> } | null = null;
    const profileIdTrimmed = profileId?.trim() ?? '';
    if (profileIdTrimmed) {
      const { profiles } = this.readAuthStore();
      const rawEntry = profiles[profileIdTrimmed];
      if (rawEntry && typeof rawEntry === 'object') {
        selected = {
          profileId: profileIdTrimmed,
          entry: rawEntry as Record<string, unknown>,
        };
      }
    }

    if (!selected) {
      selected = this.findBestAuthProfile(normalizedProvider);
    }

    if (!selected) {
      throw new Error(`no local auth profile found for provider=${provider}`);
    }

    const entry = selected.entry;
    const token = typeof entry.access === 'string'
      ? entry.access.trim()
      : (typeof entry.token === 'string' ? entry.token.trim() : '');
    if (!token) {
      throw new Error(`auth profile ${selected.profileId} has no usable token`);
    }

    const entryProvider = typeof entry.provider === 'string' ? entry.provider : normalizedProvider;
    const entryType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';

    if (entryType === 'oauth') {
      const oauthProviderId = normalizeOAuthProviderId(entryProvider) ?? normalizeOAuthProviderId(normalizedProvider);
      if (!oauthProviderId) {
        throw new Error(`cannot resolve oauthProviderId for provider=${entryProvider}`);
      }

      const email = typeof entry.email === 'string' ? entry.email.trim() : '';
      const refreshToken = typeof entry.refresh === 'string' ? entry.refresh.trim() : '';
      const expiresAtMs = typeof entry.expires === 'number' && Number.isFinite(entry.expires) && entry.expires > 0
        ? Math.floor(entry.expires)
        : undefined;
      const accountId = typeof entry.accountId === 'string' ? entry.accountId.trim() : '';
      const projectId = typeof entry.projectId === 'string' ? entry.projectId.trim() : '';

      return {
        token,
        tokenKind: 'oauth',
        oauthProviderId,
        ...(email ? { email } : {}),
        ...(refreshToken ? { refreshToken } : {}),
        ...(typeof expiresAtMs === 'number' ? { expiresAtMs } : {}),
        ...(accountId ? { accountId } : {}),
        ...(projectId ? { projectId } : {}),
      };
    }

    const piProviderId = normalizePiProviderId(entryProvider);
    return {
      token,
      tokenKind: 'api-key',
      ...(piProviderId ? { piProviderId } : {}),
    };
  }

  private updateAuthProfileCredentials(
    profileId: string,
    credentials: { access: string; refresh: string; expires: number },
  ) {
    const { store, profiles, order } = this.readAuthStore();
    const existing = profiles[profileId];
    if (!existing || typeof existing !== 'object') return;
    profiles[profileId] = {
      ...(existing as Record<string, unknown>),
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
    };
    this.writeAuthStore(profiles, order, store);
  }

  async listProviderModels(provider: string): Promise<Array<{ id: string; label: string }>> {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) return [];
    const moduleId = '@mariozechner/pi-ai';
    const piAi = await import(/* @vite-ignore */ moduleId);
    const getModelsValue = (piAi as Record<string, unknown>).getModels;
    if (typeof getModelsValue !== 'function') {
      throw new Error('pi-ai getModels() unavailable');
    }
    const getModels = getModelsValue as (providerName: string) => PiAiModelEntry[];
    const sourceProvider = normalized === 'openai'
      ? 'openai-codex'
      : normalized === 'gemini'
        ? 'google-gemini-cli'
        : normalized;
    const entries = getModels(sourceProvider);
    if (!Array.isArray(entries)) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string }> = [];
    for (const entry of entries) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = typeof entry?.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : id;
      out.push({ id, label });
    }
    return out;
  }

  async generateAssistantText(params: GenerateAssistantParams): Promise<{
    ok: true;
    text: string;
    provider: string;
    model: string;
    profileId: string;
    durationMs: number;
  }> {
    const provider = params.provider.trim().toLowerCase();
    const model = params.model.trim();
    const prompt = params.prompt.trim();
    const maxTokens = typeof params.maxTokens === 'number' && params.maxTokens > 0 ? Math.floor(params.maxTokens) : 16_000;
    const systemPrompt = params.system?.trim() || '';
    const thinking = params.thinking?.trim().toLowerCase() || 'low';
    if (!provider) throw new Error('provider is required');
    if (!model) throw new Error('model is required');
    if (!prompt) throw new Error('prompt is required');

    const started = Date.now();

    // 1. Find best auth profile for this provider
    const profile = this.findBestAuthProfile(provider);
    if (!profile) {
      throw new Error(`no local auth profile found for provider=${provider}`);
    }

    // 2. Load pi-ai module
    const moduleId = '@mariozechner/pi-ai';
    const piAi = await import(/* @vite-ignore */ moduleId) as Record<string, unknown>;
    if (typeof piAi.getModel !== 'function' || typeof piAi.completeSimple !== 'function') {
      throw new Error('pi-ai runtime helpers unavailable (getModel/completeSimple)');
    }

    // 3. Determine pi-ai provider ID and get API key (with OAuth refresh if needed)
    const { piProvider, apiKey } = await this.resolveApiKey(piAi, provider, profile);

    // 4. Get typed model from pi-ai registry (with fallback for stale model IDs)
    const selectedModel = this.normalizeModelId(piAi, piProvider, model);

    // 5. Map thinking level
    const reasoning = (
      thinking === 'off' ? 'minimal'
        : thinking === 'minimal' ? 'minimal'
          : thinking === 'medium' ? 'medium'
            : thinking === 'high' ? 'high'
              : 'low'
    ) as 'minimal' | 'low' | 'medium' | 'high';

    // 6. Call completeSimple — same path for all providers
    const completeSimple = piAi.completeSimple as (
      selectedModel: unknown,
      context: { systemPrompt?: string; messages: Array<{ role: 'user'; content: string; timestamp: number }> },
      options?: { apiKey?: string; maxTokens?: number; reasoning?: string },
    ) => Promise<{ content?: Array<{ type?: unknown; text?: unknown }> }>;

    const effectiveSystemPrompt = systemPrompt || 'You are a helpful assistant.';
    const response = await completeSimple(
      selectedModel,
      {
        systemPrompt: effectiveSystemPrompt,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      { apiKey, maxTokens, reasoning },
    );

    const responseRecord = response as Record<string, unknown>;
    const stopReason = typeof responseRecord.stopReason === 'string' ? responseRecord.stopReason : '';
    const errorMessage =
      typeof responseRecord.errorMessage === 'string'
        ? responseRecord.errorMessage
        : (typeof responseRecord.error === 'string' ? responseRecord.error : '');
    const content = Array.isArray(response.content) ? response.content : [];
    const contentTypes = content
      .map((part) => (part && typeof part === 'object' && typeof (part as { type?: unknown }).type === 'string'
        ? String((part as { type: string }).type)
        : 'unknown'))
      .join(',');

    if (stopReason === 'error' || stopReason === 'aborted') {
      const detail = errorMessage || `stopReason=${stopReason}`;
      this.appendLog('stderr', `[local-openclaw] ${provider}/${model} inference error: ${detail}`);
      throw new Error(`${provider} inference failed: ${detail}`);
    }

    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('\n')
      .trim();

    if (!text) {
      const outputText = typeof responseRecord.output_text === 'string' ? responseRecord.output_text.trim() : '';
      if (outputText) {
        return {
          ok: true,
          text: outputText,
          provider,
          model,
          profileId: profile.profileId,
          durationMs: Date.now() - started,
        };
      }
      const detail = [
        stopReason ? `stopReason=${stopReason}` : '',
        errorMessage ? `error=${errorMessage}` : '',
        contentTypes ? `contentTypes=${contentTypes}` : '',
      ].filter(Boolean).join(' ');
      this.appendLog('stderr', `[local-openclaw] ${provider}/${model} empty-text response ${detail}`.trim());
      throw new Error(`${provider} inference returned empty text${detail ? ` (${detail})` : ''}`);
    }

    return {
      ok: true,
      text,
      provider,
      model,
      profileId: profile.profileId,
      durationMs: Date.now() - started,
    };
  }

  private async resolveApiKey(
    piAi: Record<string, unknown>,
    provider: string,
    profile: { profileId: string; entry: Record<string, unknown> },
  ): Promise<{ piProvider: string; apiKey: string }> {
    const { entry, profileId } = profile;
    const entryType = typeof entry.type === 'string' ? entry.type.toLowerCase() : 'token';

    if (entryType !== 'oauth') {
      // Raw API key — no refresh needed
      const piProvider = APIKEY_PROVIDER_MAP[provider] ?? provider;
      const token = typeof entry.token === 'string' ? entry.token.trim() : '';
      if (!token) throw new Error(`auth profile ${profileId} has no usable token`);
      return { piProvider, apiKey: token };
    }

    // OAuth path — use getOAuthApiKey() for automatic token refresh
    const oauthProviderId = OAUTH_PROVIDER_MAP[provider];
    if (!oauthProviderId) {
      throw new Error(`[local-openclaw] no OAuth provider mapping for "${provider}"`);
    }
    if (typeof piAi.getOAuthApiKey !== 'function') {
      throw new Error('pi-ai getOAuthApiKey() unavailable');
    }

    const access = typeof entry.access === 'string' ? entry.access.trim() : '';
    const refresh = typeof entry.refresh === 'string' ? entry.refresh.trim() : '';
    const expires = typeof entry.expires === 'number' ? entry.expires : 0;
    if (!access || !refresh) {
      throw new Error(`auth profile ${profileId} missing access/refresh tokens`);
    }

    const getOAuthApiKey = piAi.getOAuthApiKey as (
      providerId: string,
      credentials: Record<string, { access: string; refresh: string; expires: number; [key: string]: unknown }>,
    ) => Promise<{ newCredentials: { access: string; refresh: string; expires: number; [key: string]: unknown }; apiKey: string } | null>;

    const result = await getOAuthApiKey(oauthProviderId, {
      [oauthProviderId]: { ...entry, access, refresh, expires },
    });
    if (!result?.apiKey) {
      throw new Error(`[local-openclaw] getOAuthApiKey returned null for ${oauthProviderId}`);
    }

    // Persist refreshed credentials if the access token changed
    if (result.newCredentials.access !== access) {
      this.updateAuthProfileCredentials(profileId, {
        access: result.newCredentials.access,
        refresh: result.newCredentials.refresh,
        expires: result.newCredentials.expires,
      });
      this.appendLog('stdout', `[local-openclaw] persisted refreshed ${oauthProviderId} credentials`);
    }

    return { piProvider: oauthProviderId, apiKey: result.apiKey };
  }

  private normalizeModelId(piAi: Record<string, unknown>, piProvider: string, requestedId: string): unknown {
    if (typeof piAi.getModel !== 'function') {
      throw new Error('pi-ai getModel() unavailable');
    }
    const getModel = piAi.getModel as (provider: string, modelId: string) => unknown;

    try {
      const m = getModel(piProvider, requestedId);
      if (m) return m;
    } catch {
      // fall through to default
    }

    // Fall back to the first available model for this provider
    if (typeof piAi.getModels === 'function') {
      const getModels = piAi.getModels as (provider: string) => Array<{ id?: unknown }>;
      const models = getModels(piProvider);
      if (Array.isArray(models) && models.length > 0) {
        const firstId = typeof models[0]?.id === 'string' ? models[0].id.trim() : '';
        if (firstId) {
          this.appendLog('stderr', `[local-openclaw] model "${requestedId}" not found for ${piProvider}, falling back to "${firstId}"`);
          return getModel(piProvider, firstId);
        }
      }
    }

    throw new Error(`[local-openclaw] model "${requestedId}" not found for provider ${piProvider}`);
  }

  getAuthProfileSecret(profileId: string) {
    const profileIdTrimmed = profileId.trim();
    if (!profileIdTrimmed) {
      throw new Error('profileId is required');
    }
    const authPath = this.authStorePath();
    if (!authPath || !fs.existsSync(authPath)) {
      throw new Error('auth store not found');
    }
    const store = readJson(authPath);
    const profiles = (store.profiles && typeof store.profiles === 'object')
      ? (store.profiles as Record<string, unknown>)
      : {};
    const value = profiles[profileIdTrimmed];
    const entry = (value && typeof value === 'object') ? (value as Record<string, unknown>) : null;
    if (!entry) {
      throw new Error(`auth profile not found: ${profileIdTrimmed}`);
    }
    const provider = typeof entry.provider === 'string' ? entry.provider : '';
    const token = typeof entry.access === 'string'
      ? entry.access
      : (typeof entry.token === 'string' ? entry.token : '');
    return {
      profileId: profileIdTrimmed,
      provider,
      token,
      tokenPreview: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : '',
      tokenLength: token.length,
      type: typeof entry.type === 'string' ? entry.type : '',
    };
  }

  async snapshotWithProbe(): Promise<LocalOpenclawSnapshot> {
    const gatewayProbe = await this.probeGatewayPort();
    const gatewayStatus = await this.probeGatewayStatus();
    this.reconcileExternalRuntimeObservation(gatewayProbe, gatewayStatus);
    return this.snapshot(gatewayProbe, gatewayStatus);
  }

  snapshot(
    gatewayProbe: { checkedAtMs: number; port: number; reachable: boolean; detail: string } = {
      checkedAtMs: Date.now(),
      port: LOCAL_GATEWAY_PORT,
      reachable: false,
      detail: 'probe not run',
    },
    gatewayStatus: { checkedAtMs: number; ok: boolean; detail: string; output: string } = {
      checkedAtMs: Date.now(),
      ok: false,
      detail: 'status not run',
      output: '',
    },
  ): LocalOpenclawSnapshot {
    return {
      activeUserId: this.activeUserId,
      profileRoot: this.profileRoot,
      stateDir: this.stateDir,
      configPath: this.configPath,
      status: this.status,
      detail: this.detail,
      launcherLabel: this.launcherLabel,
      pid: this.child?.pid ?? null,
      startedAtMs: this.startedAtMs,
      gatewayProbe,
      gatewayStatus,
      logTail: this.logTail.slice(0, 120),
    };
  }
}
