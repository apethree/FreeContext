#!/usr/bin/env node
/**
 * Sync the openclaw runtime binary from a source repo into resources/openclaw-runtime/.
 *
 * Usage:
 *   node scripts/sync-openclaw-runtime.mjs [openclaw-repo-root]
 *
 * If no argument is provided, reads OPENCLAW_REPO_ROOT from the environment.
 * The script expects the openclaw repo to have already been built before running.
 *
 * What counts as the "built binary" is resolved in order:
 *   1. <repo>/dist/openclaw          (compiled standalone binary)
 *   2. <repo>/openclaw.mjs           (bundled ESM script — runs via Node shim)
 *
 * On macOS / Linux the result is placed at:
 *   resources/openclaw-runtime/openclaw
 *
 * On Windows:
 *   resources/openclaw-runtime/openclaw.exe
 *
 * Example — build openclaw then sync:
 *   cd /path/to/openclaw && pnpm build
 *   cd /path/to/oneshot-platform/apps/one-shot
 *   node scripts/sync-openclaw-runtime.mjs /path/to/openclaw
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoArg = process.argv[2] || process.env.OPENCLAW_REPO_ROOT || '';
if (!repoArg) {
  console.error('[sync-openclaw-runtime] usage: node scripts/sync-openclaw-runtime.mjs <openclaw-repo-root>');
  console.error('[sync-openclaw-runtime] or set OPENCLAW_REPO_ROOT env var');
  process.exit(1);
}

const repoRoot = path.resolve(repoArg);
if (!fs.existsSync(repoRoot)) {
  console.error(`[sync-openclaw-runtime] repo root does not exist: ${repoRoot}`);
  process.exit(1);
}

// Resolve the source binary from the openclaw repo.
// Candidates tried in order — first one that exists wins.
const sourceCandidates = [
  path.join(repoRoot, 'dist', 'openclaw'),
  path.join(repoRoot, 'dist', 'openclaw.exe'),
  path.join(repoRoot, 'openclaw.mjs'),
];

let sourceBin = '';
for (const candidate of sourceCandidates) {
  if (fs.existsSync(candidate)) {
    sourceBin = candidate;
    break;
  }
}

if (!sourceBin) {
  console.error('[sync-openclaw-runtime] could not find a built binary in the openclaw repo.');
  console.error('[sync-openclaw-runtime] tried:');
  for (const c of sourceCandidates) {
    console.error(`  ${c}`);
  }
  console.error('[sync-openclaw-runtime] build openclaw first (e.g. pnpm build) then retry.');
  process.exit(1);
}

const appRoot = process.cwd();
const runtimeDir = path.join(appRoot, 'resources', 'openclaw-runtime');
const binName = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
const targetBin = path.join(runtimeDir, binName);

// If source is a .mjs script, write a Node shim so the binary contract is met.
const isMjs = sourceBin.endsWith('.mjs');
fs.mkdirSync(runtimeDir, { recursive: true });

if (isMjs) {
  const shimContent = `#!/usr/bin/env bash\nset -euo pipefail\nexec node ${JSON.stringify(sourceBin)} "$@"\n`;
  fs.writeFileSync(targetBin, shimContent, { mode: 0o755 });
  console.log(`[sync-openclaw-runtime] wrote node shim -> ${targetBin}`);
  console.log(`[sync-openclaw-runtime] shim points to: ${sourceBin}`);
} else {
  fs.copyFileSync(sourceBin, targetBin);
  if (process.platform !== 'win32') {
    fs.chmodSync(targetBin, 0o755);
  }
  console.log(`[sync-openclaw-runtime] copied ${sourceBin} -> ${targetBin}`);
}

console.log('[sync-openclaw-runtime] done. Run "npm run check:runtime" to verify.');
