#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const parsed = { port: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--port' && next) {
      parsed.port = String(next);
      i += 1;
    }
  }
  return parsed;
}

function loadDotEnv(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Don't override already-set port vars
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.port.trim()) {
    throw new Error('Missing required --port argument.');
  }

  const realtimePort = parseInt(args.port, 10);
  if (!Number.isFinite(realtimePort) || realtimePort <= 0) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  const apiPort = realtimePort + 1;
  const workersPort = realtimePort + 2;

  const gatewayCwd = process.cwd();

  // Merge apps/gateway/.env.local without overriding already-set port vars
  loadDotEnv(path.join(gatewayCwd, '.env.local'));

  const children = [];
  let lastNonZeroExit = 0;
  let exited = 0;

  function spawnService(portVar, portValue, serverPath) {
    const env = { ...process.env, PORT: String(portValue), [portVar]: String(portValue) };
    const child = spawn('npx', ['tsx', serverPath], {
      cwd: gatewayCwd,
      stdio: 'inherit',
      env,
    });
    children.push(child);
    child.on('exit', (code) => {
      if (code != null && code !== 0) lastNonZeroExit = code;
      exited += 1;
      if (exited === 3) {
        process.exit(lastNonZeroExit);
      }
    });
    return child;
  }

  spawnService('REALTIME_PORT', realtimePort, 'src/realtime/server.ts');
  spawnService('API_PORT', apiPort, 'src/api/server.ts');
  spawnService('WORKERS_PORT', workersPort, 'src/workers/server.ts');

  const forwardSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of forwardSignals) {
    process.on(signal, () => {
      for (const child of children) {
        if (!child.killed) child.kill(signal);
      }
    });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[dev-orchestrator] gateway bootstrap failed: ${message}`);
  process.exit(1);
}
