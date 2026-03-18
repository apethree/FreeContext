import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gatewayDevEntryScript = path.join(__dirname, 'gateway-dev-entry.mjs');

export const PROCESS_PREFIX = 'oneshot:';

export const orchestratorPaths = {
  appRoot: path.resolve(__dirname, '../..'),
};

orchestratorPaths.dir = path.join(orchestratorPaths.appRoot, 'dev-orchestrator');
orchestratorPaths.localConfig = path.join(orchestratorPaths.dir, 'worktrees.local.json');
orchestratorPaths.exampleConfig = path.join(orchestratorPaths.dir, 'worktrees.example.json');
orchestratorPaths.generatedEcosystem = path.join(orchestratorPaths.dir, 'ecosystem.generated.cjs');
orchestratorPaths.logsDir = path.join(orchestratorPaths.dir, 'logs');

function normalizeAbsolute(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/');
}

function stableWorktreeKey(worktreePath) {
  const normalized = normalizeAbsolute(worktreePath);
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = path.basename(normalized)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'worktree';
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

function worktreeAccentColor(worktreeKey, branch, override) {
  const normalizedOverride = String(override || '').trim();
  if (/^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/.test(normalizedOverride)) {
    return normalizedOverride;
  }
  if (branch === 'main') return '#374151';
  const digest = createHash('sha1').update(worktreeKey).digest('hex');
  const numeric = Number.parseInt(digest.slice(0, 8), 16);
  const index = Number.isFinite(numeric) ? numeric % WORKTREE_ACCENT_PALETTE.length : 0;
  return WORKTREE_ACCENT_PALETTE[index] || '#3b82f6';
}

function defaultConfig() {
  return {
    version: 2,
    discovery: {
      mode: 'git_worktree',
      repoRoot: normalizeAbsolute(path.resolve(orchestratorPaths.appRoot, '..', '..')),
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

function parseGitWorktreeList(raw) {
  const blocks = String(raw || '').trim().length > 0
    ? String(raw).trim().split(/\n\n+/)
    : [];
  const rows = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (!worktreeLine) continue;
    const worktreePath = normalizeAbsolute(worktreeLine.slice('worktree '.length).trim());
    const detached = lines.includes('detached');
    const branchLine = lines.find((line) => line.startsWith('branch '));
    const branch = detached
      ? 'detached'
      : String(branchLine ? branchLine.slice('branch '.length).trim() : 'detached').replace(/^refs\/heads\//, '');
    rows.push({ path: worktreePath, branch });
  }

  return rows;
}

function discoverWorktrees(config) {
  const repoRoot = normalizeAbsolute(config.discovery?.repoRoot || defaultConfig().discovery.repoRoot);
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

  const deduped = new Map();
  for (const row of parseGitWorktreeList(raw)) {
    deduped.set(row.path, row);
  }

  for (const extra of config.discovery?.extraPaths || []) {
    const normalized = normalizeAbsolute(extra);
    deduped.set(normalized, { path: normalized, branch: 'extra-path' });
  }

  let rows = [...deduped.values()];
  if (config.discovery?.includeMainWorktree === false) {
    rows = rows.filter((item) => item.path !== repoRoot);
  }
  return rows;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function migrateLegacyIfNeeded(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.instances)) {
    return { migrated: false, config: parsed };
  }

  const legacy = parsed.instances;
  if (!legacy.length) {
    return { migrated: false, config: defaultConfig() };
  }

  const migrated = defaultConfig();
  const minCloud = Math.min(...legacy.map((item) => Number(item.cloudPort || 8787)));
  const maxCloud = Math.max(...legacy.map((item) => Number(item.cloudPort || 8787)));
  const minApp = Math.min(...legacy.map((item) => Number(item.appPort || 5173)));
  const maxApp = Math.max(...legacy.map((item) => Number(item.appPort || 5173)));
  migrated.portPolicy.cloudRange = {
    start: minCloud,
    end: Math.min(65535, Math.max(minCloud + 20, maxCloud + 50)),
  };
  migrated.portPolicy.appRange = {
    start: minApp,
    end: Math.min(65535, Math.max(minApp + 20, maxApp + 50)),
  };

  for (const instance of legacy) {
    const worktreeRoot = normalizeAbsolute(instance.worktreeRoot || '');
    if (!worktreeRoot) continue;
    const key = stableWorktreeKey(worktreeRoot);
    migrated.worktrees[key] = {
      enabled: true,
      labelOverride: String(instance.label || key),
      colorOverride: String(instance.color || '').trim() || undefined,
      userDataDirOverride: String(instance.userDataDir || ''),
      cloudPort: Number(instance.cloudPort || 0) || undefined,
      appPort: Number(instance.appPort || 0) || undefined,
      pathSnapshot: worktreeRoot,
    };
  }

  return { migrated: true, config: migrated };
}

function normalizeConfig(parsed) {
  const base = defaultConfig();
  const input = parsed && typeof parsed === 'object' ? parsed : {};

  const discovery = input.discovery && typeof input.discovery === 'object' ? input.discovery : {};
  const profiles = input.profiles && typeof input.profiles === 'object' ? input.profiles : base.profiles;
  const profileRules = Array.isArray(input.profileRules) ? input.profileRules : [];
  const worktrees = input.worktrees && typeof input.worktrees === 'object' ? input.worktrees : {};
  const portPolicy = input.portPolicy && typeof input.portPolicy === 'object' ? input.portPolicy : base.portPolicy;

  const normalized = {
    version: 2,
    discovery: {
      mode: 'git_worktree',
      repoRoot: normalizeAbsolute(discovery.repoRoot || base.discovery.repoRoot),
      includeMainWorktree: discovery.includeMainWorktree !== false,
      extraPaths: Array.isArray(discovery.extraPaths) ? discovery.extraPaths.map((item) => normalizeAbsolute(item)) : [],
    },
    defaultProfile: String(input.defaultProfile || base.defaultProfile),
    profiles,
    profileRules,
    portPolicy: {
      cloudRange: {
        start: Number(portPolicy?.cloudRange?.start || base.portPolicy.cloudRange.start),
        end: Number(portPolicy?.cloudRange?.end || base.portPolicy.cloudRange.end),
      },
      appRange: {
        start: Number(portPolicy?.appRange?.start || base.portPolicy.appRange.start),
        end: Number(portPolicy?.appRange?.end || base.portPolicy.appRange.end),
      },
      stable: portPolicy?.stable !== false,
    },
    worktrees,
  };

  if (!normalized.profiles[normalized.defaultProfile]) {
    const first = Object.keys(normalized.profiles)[0];
    if (first) normalized.defaultProfile = first;
  }

  return normalized;
}

function writeLocalConfig(config) {
  fs.mkdirSync(orchestratorPaths.dir, { recursive: true });
  fs.writeFileSync(orchestratorPaths.localConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadWorktreeConfig({ allowExampleFallback = false } = {}) {
  const hasLocal = fs.existsSync(orchestratorPaths.localConfig);
  const hasExample = fs.existsSync(orchestratorPaths.exampleConfig);

  let sourcePath = hasLocal ? orchestratorPaths.localConfig : orchestratorPaths.exampleConfig;
  let parsed = null;

  if (hasLocal || (allowExampleFallback && hasExample)) {
    parsed = readJson(sourcePath);
  }

  if (!parsed) {
    const config = defaultConfig();
    writeLocalConfig(config);
    return { sourcePath: orchestratorPaths.localConfig, config, migrationInfo: { migrated: true, sourceSchema: 'default-created', message: `Created ${orchestratorPaths.localConfig}` } };
  }

  const migrated = migrateLegacyIfNeeded(parsed);
  const config = normalizeConfig(migrated.config);

  if (migrated.migrated || !hasLocal) {
    writeLocalConfig(config);
    sourcePath = orchestratorPaths.localConfig;
  }

  return {
    sourcePath,
    config,
    ...(migrated.migrated
      ? { migrationInfo: { migrated: true, sourceSchema: 'legacy-instances', message: `Migrated legacy instances[] to ${orchestratorPaths.localConfig}` } }
      : {}),
  };
}

function inRange(value, range) {
  return Number.isInteger(value) && value >= range.start && value <= range.end;
}

function nextAvailable(range, used) {
  for (let port = range.start; port <= range.end; port += 1) {
    if (!used.has(port)) return port;
  }
  return null;
}

export function resolveWorktrees(config) {
  const discovered = discoverWorktrees(config);
  const discoveredByKey = new Map(discovered.map((item) => [stableWorktreeKey(item.path), item]));
  const keys = new Set([...Object.keys(config.worktrees || {}), ...discoveredByKey.keys()]);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));

  const cloudRange = config.portPolicy.cloudRange;
  const appRange = config.portPolicy.appRange;
  const preferredCloudByKey = new Map();
  const preferredAppByKey = new Map();
  const usedCloud = new Set();
  const usedApp = new Set();

  for (const key of sorted) {
    const override = config.worktrees[key] || {};
    if (inRange(override.cloudPort, cloudRange) && !usedCloud.has(override.cloudPort)) {
      preferredCloudByKey.set(key, override.cloudPort);
      usedCloud.add(override.cloudPort);
      usedCloud.add(override.cloudPort + 1);
      usedCloud.add(override.cloudPort + 2);
    }
    if (inRange(override.appPort, appRange) && !usedApp.has(override.appPort)) {
      preferredAppByKey.set(key, override.appPort);
      usedApp.add(override.appPort);
    }
  }

  const worktrees = [];
  const apps = [];

  for (const key of sorted) {
    const override = config.worktrees[key] || {};
    const discoveredEntry = discoveredByKey.get(key);
    const stale = !discoveredEntry;

    const worktreePath = normalizeAbsolute(discoveredEntry?.path || override.pathSnapshot || path.join(config.discovery.repoRoot, key));
    const branch = discoveredEntry?.branch || override.branchSnapshot || 'detached';
    const enabled = override.enabled !== false;

    let blockedReason = '';
    let valid = true;

    if (!stale) {
      const gatewayDir = path.join(worktreePath, 'apps', 'gateway');
      const appDir = path.join(worktreePath, 'apps', 'one-shot');
      if (!fs.existsSync(gatewayDir) || !fs.existsSync(appDir)) {
        valid = false;
        blockedReason = `Missing apps/gateway or apps/one-shot under ${worktreePath}`;
      }
    } else {
      valid = false;
      blockedReason = 'Worktree no longer discovered (stale override).';
    }

    let profileName = null;
    let profileSource = 'default';

    if (override.profileOverride) {
      if (config.profiles[override.profileOverride]) {
        profileName = override.profileOverride;
        profileSource = 'override';
      } else {
        profileSource = 'invalid';
        blockedReason = blockedReason || `Unknown profile override: ${override.profileOverride}`;
      }
    }

    if (!profileName) {
      for (const rule of config.profileRules || []) {
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
            profileSource = 'invalid';
            blockedReason = blockedReason || `Profile rule resolved to unknown profile: ${rule.profile}`;
          }
          break;
        }
      }
    }

    if (!profileName && config.profiles[config.defaultProfile]) {
      profileName = config.defaultProfile;
      if (profileSource !== 'invalid') profileSource = 'default';
    }

    let cloudPort = preferredCloudByKey.get(key) ?? null;
    if (!cloudPort) {
      cloudPort = nextAvailable(cloudRange, usedCloud);
      if (cloudPort) {
        usedCloud.add(cloudPort);
        usedCloud.add(cloudPort + 1);
        usedCloud.add(cloudPort + 2);
      }
    }

    let appPort = preferredAppByKey.get(key) ?? null;
    if (!appPort) {
      appPort = nextAvailable(appRange, usedApp);
      if (appPort) usedApp.add(appPort);
    }

    if (!cloudPort) blockedReason = blockedReason || `No free cloud port in range ${cloudRange.start}-${cloudRange.end}.`;
    if (!appPort) blockedReason = blockedReason || `No free app port in range ${appRange.start}-${appRange.end}.`;

    const userDataDir = String(override.userDataDirOverride || path.join('/tmp', 'oneshot-user-data', key));
    const instanceLabel = String(override.labelOverride || `${branch} (${key.slice(0, 8)})`);
    const instanceColor = worktreeAccentColor(key, branch, override.colorOverride);

    config.worktrees[key] = {
      ...override,
      pathSnapshot: worktreePath,
      branchSnapshot: branch,
      enabled,
      cloudPort: cloudPort || undefined,
      appPort: appPort || undefined,
    };

    const cloudProcessName = processNameFor(key, 'cloud');
    const appProcessName = processNameFor(key, 'app');

    const profile = profileName ? config.profiles[profileName] : null;
    const shouldBuild = valid && !stale && enabled && profile && cloudPort && appPort && !blockedReason;

    if (shouldBuild) {
      fs.mkdirSync(userDataDir, { recursive: true });

      const commonEnv = {
        FORCE_COLOR: '1',
        ONESHOT_WORKTREE_KEY: key,
        ONESHOT_CLOUD_PORT: String(cloudPort),
        ONESHOT_APP_PORT: String(appPort),
      };

      apps.push({
        name: cloudProcessName,
        cwd: path.join(worktreePath, 'apps', 'gateway'),
        script: 'node',
        args: [gatewayDevEntryScript, '--port', String(cloudPort)],
        exec_mode: 'fork',
        interpreter: 'none',
        env: {
          ...commonEnv,
          REALTIME_PORT: String(cloudPort),
          API_PORT: String(cloudPort + 1),
          WORKERS_PORT: String(cloudPort + 2),
        },
        out_file: path.join(orchestratorPaths.logsDir, `${cloudProcessName}.out.log`),
        error_file: path.join(orchestratorPaths.logsDir, `${cloudProcessName}.err.log`),
        autorestart: false,
        max_restarts: 0,
      });

      apps.push({
        name: appProcessName,
        cwd: path.join(worktreePath, 'apps', 'one-shot'),
        script: 'npm',
        args: ['run', 'start'],
        exec_mode: 'fork',
        interpreter: 'none',
        env: {
          ...commonEnv,
          ONESHOT_RENDERER_PORT: String(appPort),
          VITE_ONESHOT_WS_URL: `ws://127.0.0.1:${cloudPort}/ws`,
          VITE_INSTANCE_LABEL: instanceLabel,
          VITE_INSTANCE_COLOR: instanceColor,
          ONESHOT_USER_DATA_DIR: userDataDir,
        },
        out_file: path.join(orchestratorPaths.logsDir, `${appProcessName}.out.log`),
        error_file: path.join(orchestratorPaths.logsDir, `${appProcessName}.err.log`),
        autorestart: false,
        max_restarts: 0,
      });
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
      label: instanceLabel,
      cloudPort,
      appPort,
      userDataDir,
      cloudProcessName,
      appProcessName,
      blockedReason,
    });
  }

  writeLocalConfig(config);

  return {
    config,
    worktrees,
    apps,
  };
}

export function processNameFor(worktreeKey, kind) {
  if (kind !== 'cloud' && kind !== 'app') {
    throw new Error(`unknown process kind: ${kind}`);
  }
  return `${PROCESS_PREFIX}${worktreeKey}:${kind}`;
}

export function loadResolvedWorktrees({ allowExampleFallback = true } = {}) {
  const loaded = loadWorktreeConfig({ allowExampleFallback });
  const resolved = resolveWorktrees(loaded.config);
  return {
    ...loaded,
    ...resolved,
  };
}

export function writeEcosystemFile(configOrResolved) {
  const resolved = configOrResolved?.apps
    ? configOrResolved
    : resolveWorktrees(configOrResolved.config ?? configOrResolved);

  fs.mkdirSync(orchestratorPaths.logsDir, { recursive: true });
  fs.mkdirSync(orchestratorPaths.dir, { recursive: true });

  const content = `// AUTO-GENERATED by scripts/dev-orchestrator/generate-ecosystem.mjs\nmodule.exports = ${JSON.stringify({ apps: resolved.apps }, null, 2)};\n`;
  fs.writeFileSync(orchestratorPaths.generatedEcosystem, content, 'utf8');

  return {
    path: orchestratorPaths.generatedEcosystem,
    appCount: resolved.apps.length,
    apps: resolved.apps,
  };
}

export function collectManagedProcessNames(resolved) {
  const names = [];
  for (const item of resolved.worktrees || []) {
    names.push(item.cloudProcessName, item.appProcessName);
  }
  return Array.from(new Set(names));
}

export function setWorktreeEnabled(worktreeKey, enabled) {
  const loaded = loadWorktreeConfig({ allowExampleFallback: true });
  loaded.config.worktrees[worktreeKey] = {
    ...(loaded.config.worktrees[worktreeKey] || {}),
    enabled: Boolean(enabled),
  };
  writeLocalConfig(loaded.config);
  return loadResolvedWorktrees({ allowExampleFallback: true });
}

export function setWorktreeProfile(worktreeKey, profile) {
  const loaded = loadWorktreeConfig({ allowExampleFallback: true });
  loaded.config.worktrees[worktreeKey] = {
    ...(loaded.config.worktrees[worktreeKey] || {}),
    profileOverride: profile ? String(profile) : undefined,
  };
  writeLocalConfig(loaded.config);
  return loadResolvedWorktrees({ allowExampleFallback: true });
}

export function cleanupStaleWorktrees() {
  const loaded = loadWorktreeConfig({ allowExampleFallback: true });
  const discovered = discoverWorktrees(loaded.config);
  const keys = new Set(discovered.map((item) => stableWorktreeKey(item.path)));
  for (const key of Object.keys(loaded.config.worktrees)) {
    if (!keys.has(key)) delete loaded.config.worktrees[key];
  }
  writeLocalConfig(loaded.config);
  return loadResolvedWorktrees({ allowExampleFallback: true });
}
