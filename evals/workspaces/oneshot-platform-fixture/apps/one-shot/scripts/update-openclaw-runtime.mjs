#!/usr/bin/env node
/**
 * Update One Shot's bundled OpenClaw runtime with a single command.
 *
 * Workflow:
 *   1) Resolve OpenClaw repo root (arg/env/auto-detect/clone)
 *   2) Ensure clean git tree (unless OPENCLAW_ALLOW_DIRTY=1)
 *   3) Sync local patched branch with upstream main:
 *      - fetch origin + upstream
 *      - merge upstream/main into current branch (or ff-only when configured)
 *   4) Install deps + build
 *   5) Sync built runtime into resources/openclaw-runtime
 *   6) Verify runtime exists and is executable
 *
 * Usage:
 *   node scripts/update-openclaw-runtime.mjs [openclaw-repo-root]
 *
 * Env:
 *   OPENCLAW_REPO_ROOT       Optional repo root
 *   OPENCLAW_REPO_URL        Used only when cloning is required
 *   OPENCLAW_UPSTREAM_URL    Upstream OpenClaw repo URL (if remote missing)
 *   OPENCLAW_UPSTREAM_REMOTE Upstream remote name (default: upstream)
 *   OPENCLAW_BASE_BRANCH     Base branch name (default: main)
 *   OPENCLAW_UPDATE_MODE     merge | ff-only (default: merge)
 *   OPENCLAW_ALLOW_DIRTY=1   Skip clean-tree guard
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const appRoot = process.cwd();
const syncScript = path.join(appRoot, 'scripts', 'sync-openclaw-runtime.mjs');
const verifyScript = path.join(appRoot, 'scripts', 'verify-openclaw-runtime.mjs');

function run(cmd, args, cwd) {
  const pretty = `${cmd} ${args.join(' ')}`.trim();
  console.log(`[update-openclaw-runtime] $ ${pretty}${cwd ? ` (cwd=${cwd})` : ''}`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`command failed (${res.status ?? 'unknown'}): ${pretty}`);
  }
}

function capture(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: process.env,
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  return String(res.stdout || '').trim();
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const arg = process.argv[2]?.trim();
  const envRoot = (process.env.OPENCLAW_REPO_ROOT || '').trim();
  const explicit = arg || envRoot;
  if (explicit) return path.resolve(explicit);

  // Common local layout: ~/github/oneshot-platform/apps/one-shot and sibling ~/github/openclaw
  const siblingCandidate = path.resolve(appRoot, '..', '..', '..', 'openclaw');
  if (exists(path.join(siblingCandidate, '.git'))) return siblingCandidate;

  return null;
}

function ensureRepo(repoRoot) {
  if (repoRoot && exists(path.join(repoRoot, '.git'))) {
    return repoRoot;
  }

  const repoUrl = (process.env.OPENCLAW_REPO_URL || '').trim();
  if (!repoUrl) {
    throw new Error(
      'OpenClaw repo not found. Pass repo path arg, set OPENCLAW_REPO_ROOT, or set OPENCLAW_REPO_URL for cloning.',
    );
  }

  const target = repoRoot || path.join(os.homedir(), '.oneshot', 'openclaw-main');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!exists(target)) {
    run('git', ['clone', repoUrl, target], appRoot);
  } else if (!exists(path.join(target, '.git'))) {
    throw new Error(`target exists but is not a git repo: ${target}`);
  }
  return target;
}

function ensureClean(repoRoot) {
  if (process.env.OPENCLAW_ALLOW_DIRTY === '1') return;
  const status = capture('git', ['status', '--porcelain'], repoRoot);
  if (status === null) {
    throw new Error(`failed to read git status in ${repoRoot}`);
  }
  if (status.length > 0) {
    throw new Error(
      `openclaw repo has uncommitted changes at ${repoRoot}. Commit/stash first, or set OPENCLAW_ALLOW_DIRTY=1.`,
    );
  }
}

function hasRemote(repoRoot, remoteName) {
  const out = capture('git', ['remote'], repoRoot);
  if (out === null) return false;
  return out.split(/\s+/).filter(Boolean).includes(remoteName);
}

function ensureUpstreamRemote(repoRoot) {
  const remoteName = (process.env.OPENCLAW_UPSTREAM_REMOTE || 'upstream').trim() || 'upstream';
  if (hasRemote(repoRoot, remoteName)) {
    return remoteName;
  }

  const upstreamUrl = (process.env.OPENCLAW_UPSTREAM_URL || '').trim();
  if (!upstreamUrl) {
    // No upstream configured; caller can still use origin fallback.
    return null;
  }

  run('git', ['remote', 'add', remoteName, upstreamUrl], repoRoot);
  return remoteName;
}

function syncBranchWithUpstream(repoRoot) {
  const baseBranch = (process.env.OPENCLAW_BASE_BRANCH || 'main').trim() || 'main';
  const mode = (process.env.OPENCLAW_UPDATE_MODE || 'merge').trim() || 'merge';
  if (mode !== 'merge' && mode !== 'ff-only') {
    throw new Error(`invalid OPENCLAW_UPDATE_MODE "${mode}" (expected merge or ff-only)`);
  }

  const currentBranch = capture('git', ['branch', '--show-current'], repoRoot);
  if (!currentBranch) {
    throw new Error('detached HEAD in openclaw repo; checkout your patched branch first.');
  }

  // Always refresh origin refs.
  run('git', ['fetch', 'origin', '--tags'], repoRoot);

  const upstreamRemote = ensureUpstreamRemote(repoRoot);
  if (upstreamRemote) {
    run('git', ['fetch', upstreamRemote, baseBranch, '--tags'], repoRoot);
    const upstreamRef = `${upstreamRemote}/${baseBranch}`;
    if (mode === 'ff-only') {
      run('git', ['merge', '--ff-only', upstreamRef], repoRoot);
    } else {
      run('git', ['merge', '--no-edit', upstreamRef], repoRoot);
    }
    return { currentBranch, sourceRef: upstreamRef };
  }

  // Fallback when no upstream remote is configured.
  const originRef = `origin/${baseBranch}`;
  if (mode === 'ff-only') {
    run('git', ['merge', '--ff-only', originRef], repoRoot);
  } else {
    run('git', ['merge', '--no-edit', originRef], repoRoot);
  }
  return { currentBranch, sourceRef: originRef };
}

function detectPackageManager(repoRoot) {
  if (exists(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(repoRoot, 'bun.lock')) || exists(path.join(repoRoot, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function installAndBuild(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!exists(packageJsonPath)) {
    throw new Error(`missing package.json in openclaw repo: ${repoRoot}`);
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!pkg?.scripts?.build) {
    throw new Error('openclaw package.json has no "build" script.');
  }

  const pm = detectPackageManager(repoRoot);
  if (pm === 'pnpm') {
    run('pnpm', ['install'], repoRoot);
    run('pnpm', ['build'], repoRoot);
    return;
  }
  if (pm === 'yarn') {
    run('yarn', ['install'], repoRoot);
    run('yarn', ['build'], repoRoot);
    return;
  }
  if (pm === 'bun') {
    run('bun', ['install'], repoRoot);
    run('bun', ['run', 'build'], repoRoot);
    return;
  }

  run('npm', ['install'], repoRoot);
  run('npm', ['run', 'build'], repoRoot);
}

function main() {
  const initialRoot = resolveRepoRoot();
  const repoRoot = ensureRepo(initialRoot);
  console.log(`[update-openclaw-runtime] using repo: ${repoRoot}`);

  ensureClean(repoRoot);
  const sync = syncBranchWithUpstream(repoRoot);
  console.log(`[update-openclaw-runtime] branch ${sync.currentBranch} synced from ${sync.sourceRef}`);
  installAndBuild(repoRoot);

  run('node', [syncScript, repoRoot], appRoot);
  run('node', [verifyScript], appRoot);

  console.log('[update-openclaw-runtime] runtime updated to latest origin/main and verified.');
}

try {
  main();
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[update-openclaw-runtime] ${msg}`);
  process.exit(1);
}
