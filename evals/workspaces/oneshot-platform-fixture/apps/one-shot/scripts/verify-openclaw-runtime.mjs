#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const runtimeDir = path.join(root, 'resources', 'openclaw-runtime');
const binName = process.platform === 'win32' ? 'openclaw.exe' : 'openclaw';
const runtimePath = path.join(runtimeDir, binName);

if (!fs.existsSync(runtimePath)) {
  const listed = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir).join(', ') : '(missing directory)';
  console.error(`[verify-openclaw-runtime] missing runtime binary: ${runtimePath}`);
  console.error(`[verify-openclaw-runtime] found in runtime dir: ${listed || '(empty)'}`);
  console.error('[verify-openclaw-runtime] run prepare:runtime first or set ONESHOT_OPENCLAW_RUNTIME_BIN during build.');
  process.exit(1);
}

if (process.platform !== 'win32') {
  const stat = fs.statSync(runtimePath);
  const executableMask = 0o111;
  if ((stat.mode & executableMask) === 0) {
    console.error(`[verify-openclaw-runtime] runtime is not executable: ${runtimePath}`);
    console.error('[verify-openclaw-runtime] chmod +x the runtime binary or re-run prepare:runtime.');
    process.exit(1);
  }
}

console.log(`[verify-openclaw-runtime] runtime present and valid: ${runtimePath}`);
