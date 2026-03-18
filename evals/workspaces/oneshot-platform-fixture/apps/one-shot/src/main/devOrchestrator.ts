import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import pm2 from 'pm2';
import { z } from 'zod';

const PROCESS_PREFIX = 'oneshot:';
const CONFIG_VERSION = 2;

type ProcessKind = 'cloud' | 'app';
export type DevOrchestratorService = ProcessKind;
type DevOrchestratorServiceStatus =
  | 'online'
  | 'launching'
  | 'stopped'
  | 'blocked'
  | 'external'
  | 'error';

const legacyInstanceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  color: z.string().regex(/^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/).optional().default('#64748b'),
  worktreeRoot: z.string().min(1),
  cloudPort: z.number().int().min(1).max(65535),
  appPort: z.number().int().min(1).max(65535),
  userDataDir: z.string().min(1),
});

const portRangeSchema = z.object({
  start: z.number().int().min(1).max(65535),
  end: z.number().int().min(1).max(65535),
}).superRefine((value, ctx) => {
  if (value.end < value.start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'end must be greater than or equal to start',
      path: ['end'],
    });
  }
});

const worktreeOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  profileOverride: z.string().min(1).optional(),
  labelOverride: z.string().min(1).optional(),
  colorOverride: z.string().regex(/^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/).optional(),
  userDataDirOverride: z.string().min(1).optional(),
  cloudPort: z.number().int().min(1).max(65535).optional(),
  appPort: z.number().int().min(1).max(65535).optional(),
  pathSnapshot: z.string().min(1).optional(),
  branchSnapshot: z.string().min(1).optional(),
});

const profileSchema = z.object({
  mode: z.enum(['local', 'remote']).optional().default('local'),
});

const profileRuleSchema = z.object({
  branchRegex: z.string().min(1).optional(),
  pathRegex: z.string().min(1).optional(),
  profile: z.string().min(1),
});

const dynamicConfigSchema = z.object({
  version: z.number().int().optional(),
  discovery: z.object({
    mode: z.literal('git_worktree').optional().default('git_worktree'),
    repoRoot: z.string().min(1).optional(),
    includeMainWorktree: z.boolean().optional().default(true),
    extraPaths: z.array(z.string().min(1)).optional().default([]),
  }).optional(),
  defaultProfile: z.string().min(1).optional(),
  profiles: z.record(z.string().min(1), profileSchema).optional(),
  profileRules: z.array(profileRuleSchema).optional(),
  portPolicy: z.object({
    cloudRange: portRangeSchema,
    appRange: portRangeSchema,
    stable: z.boolean().optional().default(true),
  }).optional(),
  worktrees: z.record(z.string().min(1), worktreeOverrideSchema).optional(),
});

type WorktreeOverride = z.infer<typeof worktreeOverrideSchema>;
type CloudProfile = z.infer<typeof profileSchema>;
type ProfileRule = z.infer<typeof profileRuleSchema>;

type DynamicConfig = {
  version: number;
  discovery: {
    mode: 'git_worktree';
    repoRoot: string;
    includeMainWorktree: boolean;
    extraPaths: string[];
  };
  defaultProfile: string;
  profiles: Record<string, CloudProfile>;
  profileRules: ProfileRule[];
  portPolicy: {
    cloudRange: { start: number; end: number };
    appRange: { start: number; end: number };
    stable: boolean;
  };
  worktrees: Record<string, WorktreeOverride>;
};

type DiscoveredWorktree = {
  path: string;
  branch: string;
};

type WorktreeResolution = {
  worktreeKey: string;
  path: string;
  branch: string;
  enabled: boolean;
  stale: boolean;
  valid: boolean;
  profile: string | null;
  profileSource: 'override' | 'rule' | 'default' | 'invalid';
  label: string;
  cloudPort: number | null;
  appPort: number | null;
  userDataDir: string;
  cloudProcessName: string;
  appProcessName: string;
  blockedReason: string;
  blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
  cloudStatus: string;
  appStatus: string;
};

type ProcessSpec = {
  name: string;
  kind: ProcessKind;
  worktreeKey: string;
  cwd: string;
  script: string;
  args: string[];
  env: Record<string, string>;
  cloudPort: number;
  appPort: number;
};

type ResolvedState = {
  config: DynamicConfig;
  configPath: string;
  ecosystemPath: string;
  worktrees: WorktreeResolution[];
  processSpecs: ProcessSpec[];
  migrationInfo?: DevOrchestratorMigrationInfo;
};

export type DevOrchestratorScope =
  | { type: 'all' }
  | { type: 'worktree'; worktreeKey: string }
  | { type: 'process'; processName: string };

export type DevOrchestratorProcessState = {
  name: string;
  worktreeKey: string;
  kind: ProcessKind;
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
};

export type DevOrchestratorWorktreeState = {
  worktreeKey: string;
  path: string;
  branch: string;
  enabled: boolean;
  stale: boolean;
  valid: boolean;
  profile: string | null;
  profileSource: 'override' | 'rule' | 'default' | 'invalid';
  label: string;
  ports: {
    cloudPort: number | null;
    appPort: number | null;
  };
  userDataDir: string;
  cloudProcessName: string;
  appProcessName: string;
  status: {
    cloud: DevOrchestratorServiceStatus;
    app: DevOrchestratorServiceStatus;
  };
  blockedReason?: string;
  blockedCategory?: 'credentials' | 'port' | 'missing-dirs' | 'stale' | 'profile' | 'health-check' | 'startup-failed';
};

export type DevOrchestratorMigrationInfo = {
  migrated: boolean;
  sourceSchema: 'legacy-instances' | 'default-created' | 'example-promoted';
  message: string;
};

export type DevOrchestratorListResult = {
  ok: boolean;
  supported: boolean;
  updatedAtMs: number;
  configPath: string;
  ecosystemPath: string;
  discoveredWorktrees: DevOrchestratorWorktreeState[];
  processes: DevOrchestratorProcessState[];
  profiles: string[];
  portPolicy: {
    cloudRange: { start: number; end: number };
    appRange: { start: number; end: number };
    stable: boolean;
  };
  migrationInfo?: DevOrchestratorMigrationInfo;
  reason?: string;
};

export type DevOrchestratorActionResult = {
  ok: boolean;
  supported: boolean;
  action: 'start' | 'stop' | 'restart' | 'delete';
  scope: DevOrchestratorScope;
  services: DevOrchestratorService[];
  affected: string[];
  skipped: Array<{ name: string; reason: string }>;
  reason?: string;
};

export type DevOrchestratorCurrentWorktreeStatusResult = {
  ok: boolean;
  supported: boolean;
  worktreeKey: string | null;
  appOwnership: 'pm2' | 'external' | 'none';
  cloudOwnership: 'pm2' | 'external' | 'none';
  row: DevOrchestratorWorktreeState | null;
  reason?: string;
};

export type DevOrchestratorLogsResult = {
  ok: boolean;
  supported: boolean;
  processName: string;
  lines: number;
  stdout: string[];
  stderr: string[];
  reason?: string;
};

export type DevOrchestratorLogsCursor = {
  stdoutOffset: number;
  stderrOffset: number;
};

export type DevOrchestratorLiveLogsResult = {
  ok: boolean;
  supported: boolean;
  processName: string;
  stdout: string[];
  stderr: string[];
  cursor: DevOrchestratorLogsCursor;
  reason?: string;
};

export type DevOrchestratorHealthResult = {
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
  migrationInfo?: DevOrchestratorMigrationInfo;
  reason?: string;
};

function processNameFor(worktreeKey: string, kind: ProcessKind) {
  return `${PROCESS_PREFIX}${worktreeKey}:${kind}`;
}

function resolveAppRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json')) && fs.existsSync(path.join(cwd, 'src'))) {
    return cwd;
  }
  return app.getAppPath();
}

function resolvePaths() {
  const appRoot = resolveAppRoot();
  const orchestratorDir = path.join(appRoot, 'dev-orchestrator');
  return {
    appRoot,
    gatewayDevEntryScript: path.join(appRoot, 'scripts', 'dev-orchestrator', 'gateway-dev-entry.mjs'),
    orchestratorDir,
    localConfig: path.join(orchestratorDir, 'worktrees.local.json'),
    exampleConfig: path.join(orchestratorDir, 'worktrees.example.json'),
    generatedEcosystem: path.join(orchestratorDir, 'ecosystem.generated.cjs'),
  };
}

function normalizeAbsolute(value: string) {
  return path.resolve(value).replace(/\\/g, '/');
}

function ensureAbsolute(value: string, field: string) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path: ${value}`);
  }
}

function defaultRepoRoot(appRoot: string) {
  return normalizeAbsolute(path.resolve(appRoot, '..', '..'));
}

function defaultDynamicConfig(appRoot: string): DynamicConfig {
  return {
    version: CONFIG_VERSION,
    discovery: {
      mode: 'git_worktree',
      repoRoot: defaultRepoRoot(appRoot),
      includeMainWorktree: true,
      extraPaths: [],
    },
    defaultProfile: 'default',
    profiles: {
      default: {
        mode: 'local',
      },
    },
    profileRules: [],
    portPolicy: {
      cloudRange: { start: 8781, end: 8999 },
      appRange: { start: 5173, end: 5299 },
      stable: true,
    },
    worktrees: {},
  };
}

function stableWorktreeKey(worktreePath: string) {
  const normalized = normalizeAbsolute(worktreePath);
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = path.basename(normalized)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'worktree';
  return `${base}-${hash}`;
}

const WORKTREE_ACCENT_PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#14b8a6',
  '#ec4899',
  '#eab308',
  '#0ea5e9',
];

function worktreeAccentColor(worktreeKey: string, branch: string, override?: string): string {
  const normalizedOverride = (override ?? '').trim();
  if (/^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/.test(normalizedOverride)) {
    return normalizedOverride;
  }
  if (branch === 'main') return '#374151';
  const digest = createHash('sha1').update(worktreeKey).digest('hex');
  const numeric = Number.parseInt(digest.slice(0, 8), 16);
  const index = Number.isFinite(numeric) ? numeric % WORKTREE_ACCENT_PALETTE.length : 0;
  return WORKTREE_ACCENT_PALETTE[index] ?? '#3b82f6';
}

function formatBranch(raw: string | null) {
  if (!raw) return 'detached';
  return raw.replace(/^refs\/heads\//, '');
}

function parseGitWorktreeList(raw: string): DiscoveredWorktree[] {
  const blocks = raw.trim().length > 0
    ? raw.trim().split(/\n\n+/)
    : [];

  const parsed: DiscoveredWorktree[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (!worktreeLine) continue;

    const worktreePath = normalizeAbsolute(worktreeLine.slice('worktree '.length).trim());
    const branchLine = lines.find((line) => line.startsWith('branch '));
    const detached = lines.includes('detached');
    const branch = detached
      ? 'detached'
      : formatBranch(branchLine ? branchLine.slice('branch '.length).trim() : null);

    parsed.push({ path: worktreePath, branch });
  }
  return parsed;
}

function discoverWorktrees(config: DynamicConfig): DiscoveredWorktree[] {
  const repoRoot = normalizeAbsolute(config.discovery.repoRoot);
  ensureAbsolute(repoRoot, 'discovery.repoRoot');

  let raw = '';
  try {
    raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Unable to read git worktrees from ${repoRoot}: ${String(error)}`);
  }

  const deduped = new Map<string, DiscoveredWorktree>();
  for (const item of parseGitWorktreeList(raw)) {
    deduped.set(item.path, item);
  }

  for (const extra of config.discovery.extraPaths) {
    const normalized = normalizeAbsolute(extra);
    deduped.set(normalized, {
      path: normalized,
      branch: 'extra-path',
    });
  }

  const rows = [...deduped.values()];
  if (!config.discovery.includeMainWorktree) {
    return rows.filter((item) => item.path !== repoRoot);
  }
  return rows;
}

function loadAndNormalizeConfig(): { config: DynamicConfig; sourcePath: string; paths: ReturnType<typeof resolvePaths>; migrationInfo?: DevOrchestratorMigrationInfo } {
  const paths = resolvePaths();
  const baseDefault = defaultDynamicConfig(paths.appRoot);

  const hasLocal = fs.existsSync(paths.localConfig);
  const hasExample = fs.existsSync(paths.exampleConfig);

  let sourcePath = hasLocal ? paths.localConfig : paths.exampleConfig;
  let migrationInfo: DevOrchestratorMigrationInfo | undefined;
  let parsed: unknown = null;

  if (hasLocal || hasExample) {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse ${sourcePath}: ${String(error)}`);
    }
  }

  let shouldWriteLocal = false;
  let normalized: DynamicConfig = baseDefault;

  if (!parsed) {
    shouldWriteLocal = true;
    migrationInfo = {
      migrated: true,
      sourceSchema: 'default-created',
      message: `Created default orchestrator config at ${paths.localConfig}.`,
    };
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { instances?: unknown }).instances)) {
    const legacy = z.object({ instances: z.array(legacyInstanceSchema).min(1) }).parse(parsed);

    const minCloud = Math.min(...legacy.instances.map((item) => item.cloudPort));
    const maxCloud = Math.max(...legacy.instances.map((item) => item.cloudPort));
    const minApp = Math.min(...legacy.instances.map((item) => item.appPort));
    const maxApp = Math.max(...legacy.instances.map((item) => item.appPort));

    normalized = {
      ...baseDefault,
      portPolicy: {
        cloudRange: {
          start: minCloud,
          end: Math.min(65535, Math.max(minCloud + 20, maxCloud + 50)),
        },
        appRange: {
          start: minApp,
          end: Math.min(65535, Math.max(minApp + 20, maxApp + 50)),
        },
        stable: true,
      },
      worktrees: {},
    };

    for (const legacyInstance of legacy.instances) {
      const key = stableWorktreeKey(legacyInstance.worktreeRoot);
      normalized.worktrees[key] = {
        enabled: true,
        labelOverride: legacyInstance.label,
        colorOverride: legacyInstance.color,
        userDataDirOverride: legacyInstance.userDataDir,
        cloudPort: legacyInstance.cloudPort,
        appPort: legacyInstance.appPort,
        pathSnapshot: normalizeAbsolute(legacyInstance.worktreeRoot),
      };
    }

    shouldWriteLocal = true;
    migrationInfo = {
      migrated: true,
      sourceSchema: 'legacy-instances',
      message: `Migrated legacy instances[] config to dynamic worktree model at ${paths.localConfig}.`,
    };
  } else {
    const candidate = dynamicConfigSchema.parse(parsed);
    normalized = {
      version: CONFIG_VERSION,
      discovery: {
        mode: 'git_worktree',
        repoRoot: normalizeAbsolute(candidate.discovery?.repoRoot ?? baseDefault.discovery.repoRoot),
        includeMainWorktree: candidate.discovery?.includeMainWorktree ?? true,
        extraPaths: (candidate.discovery?.extraPaths ?? []).map((value) => normalizeAbsolute(value)),
      },
      defaultProfile: candidate.defaultProfile ?? baseDefault.defaultProfile,
      profiles: candidate.profiles ?? baseDefault.profiles,
      profileRules: candidate.profileRules ?? [],
      portPolicy: {
        cloudRange: candidate.portPolicy?.cloudRange ?? baseDefault.portPolicy.cloudRange,
        appRange: candidate.portPolicy?.appRange ?? baseDefault.portPolicy.appRange,
        stable: candidate.portPolicy?.stable ?? true,
      },
      worktrees: candidate.worktrees ?? {},
    };

    if (!hasLocal && hasExample) {
      shouldWriteLocal = true;
      sourcePath = paths.localConfig;
      migrationInfo = {
        migrated: true,
        sourceSchema: 'example-promoted',
        message: `Copied example config to local config at ${paths.localConfig}.`,
      };
    }
  }

  ensureAbsolute(normalized.discovery.repoRoot, 'discovery.repoRoot');
  if (!normalized.profiles[normalized.defaultProfile]) {
    const first = Object.keys(normalized.profiles)[0];
    if (!first) {
      throw new Error('At least one cloud profile is required.');
    }
    normalized.defaultProfile = first;
  }

  if (shouldWriteLocal) {
    fs.mkdirSync(paths.orchestratorDir, { recursive: true });
    fs.writeFileSync(paths.localConfig, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    sourcePath = paths.localConfig;
  }

  return {
    config: normalized,
    sourcePath,
    paths,
    migrationInfo,
  };
}

function buildResolvedState(): ResolvedState {
  const loaded = loadAndNormalizeConfig();
  const config = loaded.config;

  const discovered = discoverWorktrees(config);
  const discoveredByKey = new Map<string, DiscoveredWorktree>();
  for (const row of discovered) {
    discoveredByKey.set(stableWorktreeKey(row.path), row);
  }

  const worktreeKeys = new Set<string>([
    ...Object.keys(config.worktrees),
    ...discoveredByKey.keys(),
  ]);

  const sortedKeys = [...worktreeKeys].sort((a, b) => a.localeCompare(b));

  const cloudRange = config.portPolicy.cloudRange;
  const appRange = config.portPolicy.appRange;

  const preferredCloudByKey = new Map<string, number>();
  const preferredAppByKey = new Map<string, number>();
  const usedCloud = new Set<number>();
  const usedApp = new Set<number>();

  function inRange(value: number, range: { start: number; end: number }) {
    return value >= range.start && value <= range.end;
  }

  function nextAvailable(range: { start: number; end: number }, used: Set<number>) {
    for (let port = range.start; port <= range.end; port += 1) {
      if (!used.has(port)) return port;
    }
    return null;
  }

  for (const key of sortedKeys) {
    const override = config.worktrees[key] ?? {};
    if (typeof override.cloudPort === 'number' && inRange(override.cloudPort, cloudRange) && !usedCloud.has(override.cloudPort)) {
      preferredCloudByKey.set(key, override.cloudPort);
      usedCloud.add(override.cloudPort);
      usedCloud.add(override.cloudPort + 1);
      usedCloud.add(override.cloudPort + 2);
    }
    if (typeof override.appPort === 'number' && inRange(override.appPort, appRange) && !usedApp.has(override.appPort)) {
      preferredAppByKey.set(key, override.appPort);
      usedApp.add(override.appPort);
    }
  }

  const worktrees: WorktreeResolution[] = [];
  const processSpecs: ProcessSpec[] = [];

  for (const key of sortedKeys) {
    const override = config.worktrees[key] ?? {};
    const discoveredEntry = discoveredByKey.get(key);
    const stale = !discoveredEntry;

    const worktreePath = normalizeAbsolute(discoveredEntry?.path ?? override.pathSnapshot ?? path.join(config.discovery.repoRoot, key));
    const branch = discoveredEntry?.branch ?? override.branchSnapshot ?? 'detached';

    const enabled = override.enabled !== false;
    const label = override.labelOverride?.trim() || `${branch} (${key.slice(0, 8)})`;
    const instanceColor = worktreeAccentColor(key, branch, override.colorOverride);

    let blockedReason = '';
    let valid = true;

    let blockedCategory: WorktreeResolution['blockedCategory'];

    if (!stale) {
      const gatewayDir = path.join(worktreePath, 'apps', 'gateway');
      const appDir = path.join(worktreePath, 'apps', 'one-shot');
      if (!fs.existsSync(gatewayDir) || !fs.existsSync(appDir)) {
        valid = false;
        blockedReason = `Missing apps/gateway or apps/one-shot under ${worktreePath}`;
        blockedCategory = 'missing-dirs';
      }
    } else {
      valid = false;
      blockedReason = 'Worktree no longer discovered (stale override).';
      blockedCategory = 'stale';
    }

    let profileName: string | null = null;
    let profileSource: WorktreeResolution['profileSource'] = 'default';

    if (override.profileOverride) {
      if (config.profiles[override.profileOverride]) {
        profileName = override.profileOverride;
        profileSource = 'override';
      } else {
        profileSource = 'invalid';
        blockedReason = blockedReason || `Unknown profile override: ${override.profileOverride}`;
        blockedCategory = blockedCategory || 'profile';
      }
    }

    if (!profileName) {
      for (const rule of config.profileRules) {
        let branchMatch = true;
        let pathMatch = true;

        if (rule.branchRegex) {
          try {
            branchMatch = new RegExp(rule.branchRegex).test(branch);
          } catch {
            branchMatch = false;
          }
        }

        if (rule.pathRegex) {
          try {
            pathMatch = new RegExp(rule.pathRegex).test(worktreePath);
          } catch {
            pathMatch = false;
          }
        }

        if (branchMatch && pathMatch) {
          if (config.profiles[rule.profile]) {
            profileName = rule.profile;
            profileSource = 'rule';
          } else {
            blockedReason = blockedReason || `Profile rule resolved to unknown profile: ${rule.profile}`;
            blockedCategory = blockedCategory || 'profile';
            profileSource = 'invalid';
          }
          break;
        }
      }
    }

    if (!profileName && config.profiles[config.defaultProfile]) {
      profileName = config.defaultProfile;
      if (profileSource !== 'invalid') {
        profileSource = 'default';
      }
    }

    if (!profileName) {
      blockedReason = blockedReason || 'No valid cloud profile available.';
      blockedCategory = blockedCategory || 'profile';
    }

    let cloudPort = preferredCloudByKey.get(key) ?? null;
    if (!cloudPort) {
      cloudPort = nextAvailable(cloudRange, usedCloud);
      if (cloudPort) {
        usedCloud.add(cloudPort);
        usedCloud.add(cloudPort + 1);
        usedCloud.add(cloudPort + 2);
        config.worktrees[key] = {
          ...override,
          cloudPort,
        };
      }
    }

    let appPort = preferredAppByKey.get(key) ?? null;
    if (!appPort) {
      appPort = nextAvailable(appRange, usedApp);
      if (appPort) {
        usedApp.add(appPort);
        config.worktrees[key] = {
          ...config.worktrees[key],
          appPort,
        };
      }
    }

    if (!cloudPort) {
      blockedReason = blockedReason || `No free cloud port in range ${cloudRange.start}-${cloudRange.end}.`;
      blockedCategory = blockedCategory || 'port';
    }
    if (!appPort) {
      blockedReason = blockedReason || `No free app port in range ${appRange.start}-${appRange.end}.`;
      blockedCategory = blockedCategory || 'port';
    }

    const userDataDir = override.userDataDirOverride?.trim()
      || path.join(os.tmpdir(), 'oneshot-user-data', key);

    config.worktrees[key] = {
      ...config.worktrees[key],
      pathSnapshot: worktreePath,
      branchSnapshot: branch,
      enabled,
      labelOverride: override.labelOverride,
      userDataDirOverride: override.userDataDirOverride,
      profileOverride: override.profileOverride,
    };

    const cloudProcessName = processNameFor(key, 'cloud');
    const appProcessName = processNameFor(key, 'app');

    const shouldBuildSpecs = valid && !stale && Boolean(cloudPort && appPort && profileName);
    if (shouldBuildSpecs) {
      const assignedCloudPort = cloudPort as number;
      const assignedAppPort = appPort as number;

      if (!blockedReason) {
        fs.mkdirSync(userDataDir, { recursive: true });

        const baseEnv = {
          FORCE_COLOR: '1',
          ONESHOT_WORKTREE_KEY: key,
          ONESHOT_CLOUD_PORT: String(assignedCloudPort),
          ONESHOT_APP_PORT: String(assignedAppPort),
        };

        const cloudSpec: ProcessSpec = {
          name: cloudProcessName,
          kind: 'cloud',
          worktreeKey: key,
          cwd: path.join(worktreePath, 'apps', 'gateway'),
          script: 'node',
          args: [loaded.paths.gatewayDevEntryScript, '--port', String(assignedCloudPort)],
          env: {
            ...baseEnv,
            REALTIME_PORT: String(assignedCloudPort),
            API_PORT: String(assignedCloudPort + 1),
            WORKERS_PORT: String(assignedCloudPort + 2),
          },
          cloudPort: assignedCloudPort,
          appPort: assignedAppPort,
        };

        const appSpec: ProcessSpec = {
          name: appProcessName,
          kind: 'app',
          worktreeKey: key,
          cwd: path.join(worktreePath, 'apps', 'one-shot'),
          script: 'npm',
          args: ['run', 'start'],
          env: {
            ...baseEnv,
            ONESHOT_RENDERER_PORT: String(assignedAppPort),
            VITE_ONESHOT_WS_URL: `ws://127.0.0.1:${assignedCloudPort}/ws`,
            VITE_INSTANCE_LABEL: label,
            VITE_INSTANCE_COLOR: instanceColor,
            ONESHOT_USER_DATA_DIR: userDataDir,
          },
          cloudPort: assignedCloudPort,
          appPort: assignedAppPort,
        };

        processSpecs.push(cloudSpec, appSpec);
      }
    }

    worktrees.push({
      worktreeKey: key,
      path: worktreePath,
      branch,
      enabled,
      stale,
      valid,
      profile: profileName,
      profileSource,
      label,
      cloudPort,
      appPort,
      userDataDir,
      cloudProcessName,
      appProcessName,
      blockedReason,
      blockedCategory,
      cloudStatus: 'missing',
      appStatus: 'missing',
    });
  }

  fs.mkdirSync(path.dirname(loaded.sourcePath), { recursive: true });
  fs.writeFileSync(loaded.sourcePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return {
    config,
    configPath: loaded.sourcePath,
    ecosystemPath: loaded.paths.generatedEcosystem,
    worktrees,
    processSpecs,
    migrationInfo: loaded.migrationInfo,
  };
}

function toPm2StartSpec(spec: ProcessSpec) {
  return {
    name: spec.name,
    cwd: spec.cwd,
    script: spec.script,
    args: spec.args,
    env: spec.env,
    exec_mode: 'fork',
    interpreter: 'none',
    autorestart: false,
    max_restarts: 0,
  };
}

function isTcpPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function pm2Connect(timeoutMs = 3000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out connecting to PM2 after ${timeoutMs}ms`));
    }, timeoutMs);
    // In Electron, pm2 daemon mode can fork via process.execPath (Electron binary),
    // which spawns recursive Electron processes. Force no-daemon mode.
    pm2.connect(true, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) return reject(error);
      resolve();
    });
  });
}

function pm2Disconnect() {
  try {
    pm2.disconnect();
  } catch {
    // no-op
  }
}

let pm2Queue: Promise<void> = Promise.resolve();
let pm2SessionConnected = false;
let pm2ConnectInFlight: Promise<void> | null = null;

function resetPm2Session() {
  pm2SessionConnected = false;
  pm2ConnectInFlight = null;
}

async function ensurePm2Connected(): Promise<void> {
  if (pm2SessionConnected) return;
  if (pm2ConnectInFlight) {
    await pm2ConnectInFlight;
    return;
  }

  pm2ConnectInFlight = pm2Connect()
    .then(() => {
      pm2SessionConnected = true;
      pm2ConnectInFlight = null;
    })
    .catch((error) => {
      resetPm2Session();
      throw error;
    });

  await pm2ConnectInFlight;
}

function maybeResetPm2SessionOnError(error: unknown) {
  const message = String(error).toLowerCase();
  if (
    message.includes('rpc') ||
    message.includes('socket') ||
    message.includes('connection') ||
    message.includes('econn') ||
    message.includes('epipe') ||
    message.includes('closed')
  ) {
    resetPm2Session();
  }
}

app.once('before-quit', () => {
  // Do NOT delete PM2 processes on quit — they should persist across app restarts
  // so that the UI correctly detects running worktrees on the next launch.
  // Processes can be stopped explicitly via the UI's Stop buttons.
  pm2Disconnect();
  resetPm2Session();
});

function withPm2<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    await ensurePm2Connected();
    try {
      return await task();
    } catch (error) {
      maybeResetPm2SessionOnError(error);
      throw error;
    }
  };

  const next = pm2Queue.then(run, run);
  pm2Queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function pm2List() {
  return new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
    pm2.list((error, list) => {
      if (error) return reject(error);
      resolve(list || []);
    });
  });
}

function pm2Describe(name: string) {
  return new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
    pm2.describe(name, (error, list) => {
      if (error) return reject(error);
      resolve(list || []);
    });
  });
}

function pm2Start(spec: ProcessSpec) {
  return new Promise<void>((resolve, reject) => {
    pm2.start(toPm2StartSpec(spec), (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function pm2Action(name: string, action: 'stop' | 'restart' | 'delete') {
  return new Promise<void>((resolve, reject) => {
    pm2[action](name, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function asProcessState(spec: ProcessSpec, listByName: Map<string, pm2.ProcessDescription>): DevOrchestratorProcessState {
  const process = listByName.get(spec.name);
  const pmEnv = process?.pm2_env;
  const monit = process?.monit;
  return {
    name: spec.name,
    worktreeKey: spec.worktreeKey,
    kind: spec.kind,
    status: pmEnv?.status || 'missing',
    pid: typeof process?.pid === 'number' && process.pid > 0 ? process.pid : null,
    cpu: typeof monit?.cpu === 'number' ? monit.cpu : 0,
    memory: typeof monit?.memory === 'number' ? monit.memory : 0,
    uptimeMs: typeof pmEnv?.pm_uptime === 'number' ? Math.max(0, Date.now() - pmEnv.pm_uptime) : null,
    cwd: spec.cwd,
    cloudPort: spec.cloudPort,
    appPort: spec.appPort,
    outLogPath: typeof pmEnv?.pm_out_log_path === 'string' ? pmEnv.pm_out_log_path : null,
    errLogPath: typeof pmEnv?.pm_err_log_path === 'string' ? pmEnv.pm_err_log_path : null,
  };
}

function pm2Status(process: pm2.ProcessDescription | undefined): string {
  const status = process?.pm2_env?.status;
  return typeof status === 'string' ? status : 'missing';
}

function isPm2RunningLikeStatus(status: string): boolean {
  return status === 'online' || status === 'launching' || status === 'waiting restart';
}

function unsupportedResult(reason: string): DevOrchestratorListResult {
  const paths = resolvePaths();
  return {
    ok: false,
    supported: false,
    updatedAtMs: Date.now(),
    configPath: paths.localConfig,
    ecosystemPath: paths.generatedEcosystem,
    discoveredWorktrees: [],
    processes: [],
    profiles: [],
    portPolicy: {
      cloudRange: { start: 0, end: 0 },
      appRange: { start: 0, end: 0 },
      stable: true,
    },
    reason,
  };
}

function mapServiceStatus(
  pm2StatusValue: string,
  blockedReason: string,
  isExternal: boolean,
): DevOrchestratorServiceStatus {
  if (blockedReason) return 'blocked';
  if (pm2StatusValue === 'online') return 'online';
  if (pm2StatusValue === 'launching' || pm2StatusValue === 'waiting restart') return 'launching';
  if (pm2StatusValue === 'errored' || pm2StatusValue === 'error') return 'error';
  if (isExternal) return 'external';
  return 'stopped';
}

async function toListResult(
  state: ResolvedState,
  processStates: DevOrchestratorProcessState[],
  pm2Processes?: pm2.ProcessDescription[],
): Promise<DevOrchestratorListResult> {
  const statusByName = new Map(processStates.map((item) => [item.name, item.status]));
  if (pm2Processes) {
    for (const process of pm2Processes) {
      const name = process.name;
      if (!name || statusByName.has(name)) continue;
      statusByName.set(name, pm2Status(process));
    }
  }
  const rows: DevOrchestratorWorktreeState[] = [];
  for (const item of state.worktrees) {
    const cloudPm2Status = statusByName.get(item.cloudProcessName) ?? 'missing';
    const appPm2Status = statusByName.get(item.appProcessName) ?? 'missing';
    const cloudRunningByPm2 = isPm2RunningLikeStatus(cloudPm2Status);
    const appRunningByPm2 = isPm2RunningLikeStatus(appPm2Status);
    const cloudExternal = !cloudRunningByPm2 && item.cloudPort != null
      ? !(await isTcpPortAvailable(item.cloudPort))
      : false;
    const appExternal = !appRunningByPm2 && item.appPort != null
      ? !(await isTcpPortAvailable(item.appPort))
      : false;

    rows.push({
      worktreeKey: item.worktreeKey,
      path: item.path,
      branch: item.branch,
      enabled: item.enabled,
      stale: item.stale,
      valid: item.valid,
      profile: item.profile,
      profileSource: item.profileSource,
      label: item.label,
      ports: {
        cloudPort: item.cloudPort,
        appPort: item.appPort,
      },
      userDataDir: item.userDataDir,
      cloudProcessName: item.cloudProcessName,
      appProcessName: item.appProcessName,
      status: {
        cloud: mapServiceStatus(cloudPm2Status, item.blockedReason, cloudExternal),
        app: mapServiceStatus(appPm2Status, item.blockedReason, appExternal),
      },
      ...(item.blockedReason ? { blockedReason: item.blockedReason } : {}),
      ...(item.blockedCategory ? { blockedCategory: item.blockedCategory } : {}),
    });
  }

  return {
    ok: true,
    supported: true,
    updatedAtMs: Date.now(),
    configPath: state.configPath,
    ecosystemPath: state.ecosystemPath,
    discoveredWorktrees: rows,
    processes: processStates,
    profiles: Object.keys(state.config.profiles),
    portPolicy: state.config.portPolicy,
    ...(state.migrationInfo ? { migrationInfo: state.migrationInfo } : {}),
  };
}

function resolveActionTargets(
  action: DevOrchestratorActionResult['action'],
  scope: DevOrchestratorScope,
  state: ResolvedState,
  services: DevOrchestratorService[],
): { targetNames: string[]; startSpecs: ProcessSpec[]; skipped: Array<{ name: string; reason: string }> } {
  const byWorktree = new Map(state.worktrees.map((item) => [item.worktreeKey, item]));
  const specsByName = new Map(state.processSpecs.map((item) => [item.name, item]));

  const skipped: Array<{ name: string; reason: string }> = [];

  const collectWorktree = (worktreeKey: string) => {
    const row = byWorktree.get(worktreeKey);
    if (!row) {
      return {
        names: [],
        specs: [],
      };
    }

    const names = services.map((service) => (
      service === 'cloud' ? row.cloudProcessName : row.appProcessName
    ));
    const specs = names
      .map((name) => specsByName.get(name))
      .filter((spec): spec is ProcessSpec => Boolean(spec));

    if ((action === 'start' || action === 'restart') && !row.enabled) {
      skipped.push({ name: row.worktreeKey, reason: 'worktree disabled' });
      return { names: [], specs: [] };
    }

    if ((action === 'start' || action === 'restart') && row.blockedReason) {
      skipped.push({ name: row.worktreeKey, reason: row.blockedReason });
      return { names: [], specs: [] };
    }

    return { names, specs };
  };

  if (scope.type === 'process') {
    const spec = specsByName.get(scope.processName);
    return {
      targetNames: [scope.processName],
      startSpecs: spec && services.includes(spec.kind) ? [spec] : [],
      skipped,
    };
  }

  if (scope.type === 'worktree') {
    const resolved = collectWorktree(scope.worktreeKey);
    return {
      targetNames: resolved.names,
      startSpecs: resolved.specs,
      skipped,
    };
  }

  const targetNames: string[] = [];
  const startSpecs: ProcessSpec[] = [];

  for (const row of state.worktrees) {
    const resolved = collectWorktree(row.worktreeKey);
    targetNames.push(...resolved.names);
    startSpecs.push(...resolved.specs);
  }

  return {
    targetNames,
    startSpecs,
    skipped,
  };
}

function normalizeServices(services?: DevOrchestratorService[]): DevOrchestratorService[] {
  if (!services || services.length === 0) return ['cloud', 'app'];
  const deduped = Array.from(new Set(services.filter((service) => service === 'cloud' || service === 'app')));
  return deduped.length > 0 ? deduped : ['cloud', 'app'];
}

function tailLines(filePath: string | null, lines: number): string[] {
  if (!filePath || filePath === '/dev/null') return [];
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = content.split(/\r?\n/);
  while (rows.length > 0 && rows[rows.length - 1] === '') {
    rows.pop();
  }
  return rows.slice(-lines);
}

function normalizeOffset(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (typeof value !== 'number') return fallback;
  const rounded = Math.floor(value);
  if (rounded < 0) return fallback;
  return rounded;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCloudReady(
  cloudPort: number,
  host = '127.0.0.1',
): Promise<{ ready: boolean; attempts: number; elapsedMs: number; error?: string }> {
  const maxAttempts = 30;
  const overallTimeoutMs = 45_000;
  const initialDelayMs = 300;
  const maxDelayMs = 3_000;
  const startedAt = Date.now();

  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= overallTimeoutMs) {
      return { ready: false, attempts: attempt - 1, elapsedMs: elapsed, error: 'Overall timeout exceeded' };
    }

    await sleep(delay);

    try {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(`http://${host}:${cloudPort}/health`, {
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);
      if (response.ok) {
        return { ready: true, attempts: attempt, elapsedMs: Date.now() - startedAt };
      }
    } catch {
      // not ready yet
    }

    delay = Math.min(delay * 1.5, maxDelayMs);
  }

  return {
    ready: false,
    attempts: maxAttempts,
    elapsedMs: Date.now() - startedAt,
    error: `Health check failed after ${maxAttempts} attempts`,
  };
}

function lastNonEmptyLine(lines: string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return '';
}

function processStartFailureReason(
  process: pm2.ProcessDescription | undefined,
  fallback: string,
): string {
  if (!process) return fallback;
  const pmEnv = process.pm2_env;
  const status = typeof pmEnv?.status === 'string' ? pmEnv.status : 'missing';
  const errPath = typeof pmEnv?.pm_err_log_path === 'string' ? pmEnv.pm_err_log_path : null;
  const outPath = typeof pmEnv?.pm_out_log_path === 'string' ? pmEnv.pm_out_log_path : null;
  const lastErr = lastNonEmptyLine(tailLines(errPath, 20));
  const lastOut = lastNonEmptyLine(tailLines(outPath, 20));
  const detail = lastErr || lastOut;
  return detail
    ? `${fallback} (status: ${status}) — ${detail}`
    : `${fallback} (status: ${status})`;
}

function fileSize(filePath: string | null): number {
  if (!filePath || filePath === '/dev/null') return 0;
  try {
    if (!fs.existsSync(filePath)) return 0;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return 0;
    return stat.size;
  } catch {
    return 0;
  }
}

function readLiveChunk(filePath: string | null, requestedOffset: number, maxBytes: number): { lines: string[]; nextOffset: number } {
  if (!filePath || filePath === '/dev/null') {
    return { lines: [], nextOffset: 0 };
  }

  try {
    if (!fs.existsSync(filePath)) {
      return { lines: [], nextOffset: 0 };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { lines: [], nextOffset: 0 };
    }

    const size = stat.size;
    let start = Math.min(Math.max(0, requestedOffset), size);
    if (requestedOffset > size) {
      start = 0;
    }
    if (size <= start) {
      return { lines: [], nextOffset: size };
    }

    const delta = size - start;
    if (delta > maxBytes) {
      start = size - maxBytes;
    }

    const bytesToRead = size - start;
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, start);
      const text = buffer.toString('utf8');
      const rows = text.split(/\r?\n/);
      while (rows.length > 0 && rows[rows.length - 1] === '') {
        rows.pop();
      }
      return {
        lines: rows,
        nextOffset: size,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { lines: [], nextOffset: 0 };
  }
}

function updateWorktreeOverride(
  worktreeKey: string,
  updater: (current: WorktreeOverride) => WorktreeOverride,
): ResolvedState {
  const loaded = loadAndNormalizeConfig();
  const current = loaded.config.worktrees[worktreeKey] ?? {};
  loaded.config.worktrees[worktreeKey] = updater(current);
  fs.writeFileSync(loaded.sourcePath, `${JSON.stringify(loaded.config, null, 2)}\n`, 'utf8');
  return buildResolvedState();
}

function resolveCurrentWorktreeKey(state: ResolvedState): string | null {
  const appRootWorktree = normalizeAbsolute(path.resolve(resolvePaths().appRoot, '..', '..'));
  const directMatch = state.worktrees.find((row) => normalizeAbsolute(row.path) === appRootWorktree);
  if (directMatch) return directMatch.worktreeKey;

  const cwd = normalizeAbsolute(process.cwd());
  const fallback = state.worktrees.find((row) => {
    const rowPath = normalizeAbsolute(row.path);
    return cwd === rowPath || cwd.startsWith(`${rowPath}/`);
  });
  return fallback?.worktreeKey ?? null;
}

function serviceOwnership(status: DevOrchestratorServiceStatus): 'pm2' | 'external' | 'none' {
  if (status === 'external') return 'external';
  if (status === 'online' || status === 'launching') return 'pm2';
  return 'none';
}

export async function devOrchestratorRescan(): Promise<DevOrchestratorListResult> {
  return await devOrchestratorList();
}

export async function devOrchestratorStatusCurrentWorktree(): Promise<DevOrchestratorCurrentWorktreeStatusResult> {
  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      worktreeKey: null,
      appOwnership: 'none',
      cloudOwnership: 'none',
      row: null,
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  let state: ResolvedState;
  try {
    state = buildResolvedState();
  } catch (error) {
    return {
      ok: false,
      supported: true,
      worktreeKey: null,
      appOwnership: 'none',
      cloudOwnership: 'none',
      row: null,
      reason: String(error),
    };
  }

  const worktreeKey = resolveCurrentWorktreeKey(state);
  if (!worktreeKey) {
    return {
      ok: false,
      supported: true,
      worktreeKey: null,
      appOwnership: 'none',
      cloudOwnership: 'none',
      row: null,
      reason: 'Could not map current app process to a discovered worktree.',
    };
  }

  try {
    return await withPm2(async () => {
      const list = await pm2List();
      const listByName = new Map(list.map((item) => [item.name ?? '', item]));
      const processStates = state.processSpecs.map((spec) => asProcessState(spec, listByName));
      const listResult = await toListResult(state, processStates, list);
      const row = listResult.discoveredWorktrees.find((item) => item.worktreeKey === worktreeKey) ?? null;
      if (!row) {
        return {
          ok: false,
          supported: true,
          worktreeKey,
          appOwnership: 'none' as const,
          cloudOwnership: 'none' as const,
          row: null,
          reason: `Current worktree key ${worktreeKey} not found in discovered rows.`,
        };
      }
      return {
        ok: true,
        supported: true,
        worktreeKey,
        appOwnership: serviceOwnership(row.status.app),
        cloudOwnership: serviceOwnership(row.status.cloud),
        row,
      };
    });
  } catch (error) {
    return {
      ok: false,
      supported: true,
      worktreeKey,
      appOwnership: 'none',
      cloudOwnership: 'none',
      row: null,
      reason: String(error),
    };
  }
}

export async function devOrchestratorStartCurrentWorktreeCloud(): Promise<DevOrchestratorActionResult> {
  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      action: 'start',
      scope: { type: 'all' },
      services: ['cloud'],
      affected: [],
      skipped: [],
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  let state: ResolvedState;
  try {
    state = buildResolvedState();
  } catch (error) {
    return {
      ok: false,
      supported: true,
      action: 'start',
      scope: { type: 'all' },
      services: ['cloud'],
      affected: [],
      skipped: [],
      reason: String(error),
    };
  }

  const worktreeKey = resolveCurrentWorktreeKey(state);
  if (!worktreeKey) {
    return {
      ok: false,
      supported: true,
      action: 'start',
      scope: { type: 'all' },
      services: ['cloud'],
      affected: [],
      skipped: [],
      reason: 'Could not map current app process to a discovered worktree.',
    };
  }

  return await devOrchestratorControl(
    'start',
    { type: 'worktree', worktreeKey },
    ['cloud'],
  );
}

export async function devOrchestratorSetWorktreeEnabled(worktreeKey: string, enabled: boolean): Promise<DevOrchestratorListResult> {
  if (app.isPackaged) {
    return unsupportedResult('Dev orchestrator is available only in development builds.');
  }

  try {
    const state = updateWorktreeOverride(worktreeKey, (current) => ({
      ...current,
      enabled,
    }));

    return await withPm2(async () => {
      const list = await pm2List();
      const listByName = new Map(list.map((item) => [item.name ?? '', item]));
      const processStates = state.processSpecs.map((spec) => asProcessState(spec, listByName));
      return toListResult(state, processStates, list);
    });
  } catch (error) {
    return {
      ...unsupportedResult(String(error)),
      supported: true,
    };
  }
}

export async function devOrchestratorSetWorktreeProfile(worktreeKey: string, profile: string | null): Promise<DevOrchestratorListResult> {
  if (app.isPackaged) {
    return unsupportedResult('Dev orchestrator is available only in development builds.');
  }

  try {
    const state = updateWorktreeOverride(worktreeKey, (current) => ({
      ...current,
      profileOverride: profile && profile.trim() ? profile.trim() : undefined,
    }));

    return await withPm2(async () => {
      const list = await pm2List();
      const listByName = new Map(list.map((item) => [item.name ?? '', item]));
      const processStates = state.processSpecs.map((spec) => asProcessState(spec, listByName));
      return toListResult(state, processStates, list);
    });
  } catch (error) {
    return {
      ...unsupportedResult(String(error)),
      supported: true,
    };
  }
}

export async function devOrchestratorSetWorktreeLabel(worktreeKey: string, label: string | null): Promise<DevOrchestratorListResult> {
  if (app.isPackaged) {
    return unsupportedResult('Dev orchestrator is available only in development builds.');
  }

  try {
    const state = updateWorktreeOverride(worktreeKey, (current) => ({
      ...current,
      labelOverride: label && label.trim() ? label.trim() : undefined,
    }));

    return await withPm2(async () => {
      const list = await pm2List();
      const listByName = new Map(list.map((item) => [item.name ?? '', item]));
      const processStates = state.processSpecs.map((spec) => asProcessState(spec, listByName));
      return toListResult(state, processStates, list);
    });
  } catch (error) {
    return {
      ...unsupportedResult(String(error)),
      supported: true,
    };
  }
}

export async function devOrchestratorCleanupStale(): Promise<DevOrchestratorListResult> {
  if (app.isPackaged) {
    return unsupportedResult('Dev orchestrator is available only in development builds.');
  }

  try {
    const loaded = loadAndNormalizeConfig();
    const discovered = discoverWorktrees(loaded.config);
    const keys = new Set(discovered.map((item) => stableWorktreeKey(item.path)));
    for (const key of Object.keys(loaded.config.worktrees)) {
      if (!keys.has(key)) {
        delete loaded.config.worktrees[key];
      }
    }
    fs.writeFileSync(loaded.sourcePath, `${JSON.stringify(loaded.config, null, 2)}\n`, 'utf8');

    return await devOrchestratorList();
  } catch (error) {
    return {
      ...unsupportedResult(String(error)),
      supported: true,
    };
  }
}

export async function devOrchestratorList(): Promise<DevOrchestratorListResult> {
  if (app.isPackaged) {
    return unsupportedResult('Dev orchestrator is available only in development builds.');
  }

  let state: ResolvedState;
  try {
    state = buildResolvedState();
  } catch (error) {
    return {
      ...unsupportedResult(String(error)),
      supported: true,
    };
  }

  try {
    return await withPm2(async () => {
      const list = await pm2List();
      const listByName = new Map(list.map((item) => [item.name ?? '', item]));
      const processStates = state.processSpecs.map((spec) => asProcessState(spec, listByName));
      return toListResult(state, processStates, list);
    });
  } catch (error) {
    return {
      ok: false,
      supported: true,
      updatedAtMs: Date.now(),
      configPath: state.configPath,
      ecosystemPath: state.ecosystemPath,
      discoveredWorktrees: [],
      processes: [],
      profiles: Object.keys(state.config.profiles),
      portPolicy: state.config.portPolicy,
      ...(state.migrationInfo ? { migrationInfo: state.migrationInfo } : {}),
      reason: String(error),
    };
  }
}

export async function devOrchestratorControl(
  action: 'start' | 'stop' | 'restart' | 'delete',
  scope: DevOrchestratorScope,
  services?: DevOrchestratorService[],
): Promise<DevOrchestratorActionResult> {
  const requestedServices = normalizeServices(services);
  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      action,
      scope,
      services: requestedServices,
      affected: [],
      skipped: [],
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  let state: ResolvedState;
  try {
    state = buildResolvedState();
  } catch (error) {
    return {
      ok: false,
      supported: true,
      action,
      scope,
      services: requestedServices,
      affected: [],
      skipped: [],
      reason: String(error),
    };
  }

  const targets = resolveActionTargets(action, scope, state, requestedServices);

  try {
    return await withPm2(async () => {
      const current = await pm2List();
      const currentByName = new Map(current.map((item) => [item.name ?? '', item]));
      const blockedWorktreeStarts = new Set<string>();
      const affected: string[] = [];
      const startSpecsByName = new Map(targets.startSpecs.map((spec) => [spec.name, spec]));

      for (const name of targets.targetNames) {
        const existingProcess = currentByName.get(name);
        const existingStatus = pm2Status(existingProcess);
        const existsAndRunning = isPm2RunningLikeStatus(existingStatus);

        if (action === 'start') {
          if (existsAndRunning) {
            targets.skipped.push({ name, reason: 'already running under pm2' });
            continue;
          }
          const startSpec = startSpecsByName.get(name);
          if (!startSpec) {
            targets.skipped.push({ name, reason: 'process is blocked or invalid for start' });
            continue;
          }
          if (startSpec.kind === 'app' && blockedWorktreeStarts.has(startSpec.worktreeKey)) {
            targets.skipped.push({ name, reason: 'cloud process failed to start for this worktree' });
            continue;
          }
          const requiredPort = startSpec.kind === 'cloud' ? startSpec.cloudPort : startSpec.appPort;
          const isPortFree = await isTcpPortAvailable(requiredPort);
          if (!isPortFree) {
            targets.skipped.push({
              name,
              reason: existingProcess
                ? `${startSpec.kind} port ${requiredPort} is already in use`
                : `${startSpec.kind} appears to be running externally on port ${requiredPort}`,
            });
            if (startSpec.kind === 'cloud') {
              blockedWorktreeStarts.add(startSpec.worktreeKey);
            }
            continue;
          }
          if (existingProcess) {
            await pm2Action(name, 'restart');
          } else {
            await pm2Start(startSpec);
          }
          if (startSpec.kind === 'cloud') {
            const readiness = await waitForCloudReady(startSpec.cloudPort);
            if (!readiness.ready) {
              targets.skipped.push({
                name,
                reason: `Cloud started but health check failed after ${readiness.elapsedMs}ms: ${readiness.error}`,
              });
              blockedWorktreeStarts.add(startSpec.worktreeKey);
              try { await pm2Action(name, 'delete'); } catch { /* no-op */ }
              continue;
            }
          } else {
            await sleep(500);
          }
          const described = await pm2Describe(name);
          const started = described[0];
          const status = started?.pm2_env?.status ?? 'missing';
          if (status === 'errored' || status === 'stopped') {
            targets.skipped.push({
              name,
              reason: processStartFailureReason(started, `${startSpec.kind} process failed to start`),
            });
            if (startSpec.kind === 'cloud') {
              blockedWorktreeStarts.add(startSpec.worktreeKey);
            }
            try {
              await pm2Action(name, 'delete');
            } catch {
              // no-op
            }
            continue;
          }
          affected.push(name);
          currentByName.set(name, started ?? existingProcess ?? ({} as pm2.ProcessDescription));
          continue;
        }

        if (action === 'restart') {
          if (existingProcess) {
            await pm2Action(name, 'restart');
            affected.push(name);
            continue;
          }
          const startSpec = startSpecsByName.get(name);
          if (!startSpec) {
            targets.skipped.push({ name, reason: 'process is blocked or invalid for start' });
            continue;
          }
          if (startSpec.kind === 'app' && blockedWorktreeStarts.has(startSpec.worktreeKey)) {
            targets.skipped.push({ name, reason: 'cloud process failed to start for this worktree' });
            continue;
          }
          const requiredPort = startSpec.kind === 'cloud' ? startSpec.cloudPort : startSpec.appPort;
          const isPortFree = await isTcpPortAvailable(requiredPort);
          if (!isPortFree) {
            targets.skipped.push({
              name,
              reason: existingProcess
                ? `${startSpec.kind} port ${requiredPort} is already in use`
                : `${startSpec.kind} appears to be running externally on port ${requiredPort}`,
            });
            if (startSpec.kind === 'cloud') {
              blockedWorktreeStarts.add(startSpec.worktreeKey);
            }
            continue;
          }
          await pm2Start(startSpec);
          if (startSpec.kind === 'cloud') {
            const readiness = await waitForCloudReady(startSpec.cloudPort);
            if (!readiness.ready) {
              targets.skipped.push({
                name,
                reason: `Cloud started but health check failed after ${readiness.elapsedMs}ms: ${readiness.error}`,
              });
              blockedWorktreeStarts.add(startSpec.worktreeKey);
              try { await pm2Action(name, 'delete'); } catch { /* no-op */ }
              continue;
            }
          } else {
            await sleep(500);
          }
          const described = await pm2Describe(name);
          const started = described[0];
          const status = started?.pm2_env?.status ?? 'missing';
          if (status === 'errored' || status === 'stopped') {
            targets.skipped.push({
              name,
              reason: processStartFailureReason(started, `${startSpec.kind} process failed to start`),
            });
            if (startSpec.kind === 'cloud') {
              blockedWorktreeStarts.add(startSpec.worktreeKey);
            }
            try {
              await pm2Action(name, 'delete');
            } catch {
              // no-op
            }
            continue;
          }
          affected.push(name);
          currentByName.set(name, started ?? existingProcess ?? ({} as pm2.ProcessDescription));
          continue;
        }

        if (!existingProcess) {
          const spec = startSpecsByName.get(name);
          if (spec) {
            const requiredPort = spec.kind === 'cloud' ? spec.cloudPort : spec.appPort;
            const isPortFree = await isTcpPortAvailable(requiredPort);
            if (!isPortFree) {
              targets.skipped.push({
                name,
                reason: `${spec.kind} is running externally on port ${requiredPort} (stop disabled for unmanaged process)`,
              });
              continue;
            }
          }
          targets.skipped.push({ name, reason: 'process not currently managed by pm2' });
          continue;
        }

        await pm2Action(name, action);
        affected.push(name);
      }

      return {
        ok: true,
        supported: true,
        action,
        scope,
        services: requestedServices,
        affected,
        skipped: targets.skipped,
      };
    });
  } catch (error) {
    return {
      ok: false,
      supported: true,
      action,
      scope,
      services: requestedServices,
      affected: targets.targetNames,
      skipped: targets.skipped,
      reason: String(error),
    };
  }
}

export async function devOrchestratorLogs(processName: string, lines: number): Promise<DevOrchestratorLogsResult> {
  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      processName,
      lines,
      stdout: [],
      stderr: [],
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  try {
    return await withPm2(async () => {
      const described = await pm2Describe(processName);
      const process = described[0];
      if (!process) {
        return {
          ok: false,
          supported: true,
          processName,
          lines,
          stdout: [],
          stderr: [],
          reason: `Unknown process: ${processName}`,
        };
      }

      const pmEnv = process.pm2_env;
      const outPath = typeof pmEnv?.pm_out_log_path === 'string' ? pmEnv.pm_out_log_path : null;
      const errPath = typeof pmEnv?.pm_err_log_path === 'string' ? pmEnv.pm_err_log_path : null;

      return {
        ok: true,
        supported: true,
        processName,
        lines,
        stdout: tailLines(outPath, lines),
        stderr: tailLines(errPath, lines),
      };
    });
  } catch (error) {
    return {
      ok: false,
      supported: true,
      processName,
      lines,
      stdout: [],
      stderr: [],
      reason: String(error),
    };
  }
}

export async function devOrchestratorLiveLogs(
  processName: string,
  cursor?: DevOrchestratorLogsCursor,
  fromNow = false,
  maxBytes = 256 * 1024,
): Promise<DevOrchestratorLiveLogsResult> {
  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      processName,
      stdout: [],
      stderr: [],
      cursor: {
        stdoutOffset: 0,
        stderrOffset: 0,
      },
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  try {
    return await withPm2(async () => {
      const described = await pm2Describe(processName);
      const process = described[0];
      if (!process) {
        return {
          ok: false,
          supported: true,
          processName,
          stdout: [],
          stderr: [],
          cursor: {
            stdoutOffset: 0,
            stderrOffset: 0,
          },
          reason: `Unknown process: ${processName}`,
        };
      }

      const pmEnv = process.pm2_env;
      const outPath = typeof pmEnv?.pm_out_log_path === 'string' ? pmEnv.pm_out_log_path : null;
      const errPath = typeof pmEnv?.pm_err_log_path === 'string' ? pmEnv.pm_err_log_path : null;

      const currentOutSize = fileSize(outPath);
      const currentErrSize = fileSize(errPath);
      if (fromNow) {
        return {
          ok: true,
          supported: true,
          processName,
          stdout: [],
          stderr: [],
          cursor: {
            stdoutOffset: currentOutSize,
            stderrOffset: currentErrSize,
          },
        };
      }

      const safeMaxBytes = Math.max(4 * 1024, Math.min(1024 * 1024, Math.floor(maxBytes)));
      const stdoutOffset = normalizeOffset(cursor?.stdoutOffset, currentOutSize);
      const stderrOffset = normalizeOffset(cursor?.stderrOffset, currentErrSize);
      const stdoutChunk = readLiveChunk(outPath, stdoutOffset, safeMaxBytes);
      const stderrChunk = readLiveChunk(errPath, stderrOffset, safeMaxBytes);

      return {
        ok: true,
        supported: true,
        processName,
        stdout: stdoutChunk.lines,
        stderr: stderrChunk.lines,
        cursor: {
          stdoutOffset: stdoutChunk.nextOffset,
          stderrOffset: stderrChunk.nextOffset,
        },
      };
    });
  } catch (error) {
    return {
      ok: false,
      supported: true,
      processName,
      stdout: [],
      stderr: [],
      cursor: {
        stdoutOffset: cursor?.stdoutOffset ?? 0,
        stderrOffset: cursor?.stderrOffset ?? 0,
      },
      reason: String(error),
    };
  }
}

export async function devOrchestratorHealth(): Promise<DevOrchestratorHealthResult> {
  const paths = resolvePaths();

  if (app.isPackaged) {
    return {
      ok: false,
      supported: false,
      pm2Connected: false,
      hasLocalConfig: fs.existsSync(paths.localConfig),
      hasExampleConfig: fs.existsSync(paths.exampleConfig),
      hasGeneratedEcosystem: fs.existsSync(paths.generatedEcosystem),
      configPath: paths.localConfig,
      ecosystemPath: paths.generatedEcosystem,
      worktreeCount: 0,
      enabledCount: 0,
      reason: 'Dev orchestrator is available only in development builds.',
    };
  }

  let state: ResolvedState | null = null;
  let reason = '';
  try {
    state = buildResolvedState();
  } catch (error) {
    reason = String(error);
  }

  let pm2Connected = false;
  try {
    await withPm2(async () => {
      pm2Connected = true;
    });
  } catch (error) {
    reason = reason || String(error);
  }

  const worktreeCount = state?.worktrees.length ?? 0;
  const enabledCount = state?.worktrees.filter((row) => row.enabled).length ?? 0;

  return {
    ok: Boolean(pm2Connected && state),
    supported: true,
    pm2Connected,
    hasLocalConfig: fs.existsSync(paths.localConfig),
    hasExampleConfig: fs.existsSync(paths.exampleConfig),
    hasGeneratedEcosystem: fs.existsSync(paths.generatedEcosystem),
    configPath: state?.configPath ?? paths.localConfig,
    ecosystemPath: state?.ecosystemPath ?? paths.generatedEcosystem,
    worktreeCount,
    enabledCount,
    ...(state?.migrationInfo ? { migrationInfo: state.migrationInfo } : {}),
    ...(reason ? { reason } : {}),
  };
}
