#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const runtimeDir = path.join(root, 'resources', 'openclaw-runtime');
const binName = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
const targetBin = path.join(runtimeDir, binName);
const sourceBin = process.env.ONESHOT_OPENCLAW_RUNTIME_BIN?.trim() || '';

function ensureExecutable(file) {
  if (process.platform === 'win32') return;
  fs.chmodSync(file, 0o755);
}

fs.mkdirSync(runtimeDir, { recursive: true });

if (sourceBin) {
  if (!fs.existsSync(sourceBin)) {
    console.error(`[prepare-openclaw-runtime] ONESHOT_OPENCLAW_RUNTIME_BIN does not exist: ${sourceBin}`);
    process.exit(1);
  }
  fs.copyFileSync(sourceBin, targetBin);
  ensureExecutable(targetBin);
  console.log(`[prepare-openclaw-runtime] copied runtime: ${sourceBin} -> ${targetBin}`);
  process.exit(0);
}

if (fs.existsSync(targetBin)) {
  ensureExecutable(targetBin);
  console.log(`[prepare-openclaw-runtime] using existing runtime: ${targetBin}`);
  process.exit(0);
}

console.error('[prepare-openclaw-runtime] missing runtime binary.');
console.error(`[prepare-openclaw-runtime] provide ONESHOT_OPENCLAW_RUNTIME_BIN or place binary at ${targetBin}`);
process.exit(1);
