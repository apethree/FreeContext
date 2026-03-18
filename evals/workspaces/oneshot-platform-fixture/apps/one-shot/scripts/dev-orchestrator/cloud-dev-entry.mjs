#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const parsed = {
    port: '',
    persistTo: '',
    env: '',
    dbName: 'openclaw_hosted',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--port' && next) {
      parsed.port = String(next);
      i += 1;
      continue;
    }
    if (token === '--persist-to' && next) {
      parsed.persistTo = String(next);
      i += 1;
      continue;
    }
    if (token === '--env' && next) {
      parsed.env = String(next);
      i += 1;
      continue;
    }
    if (token === '--db-name' && next) {
      parsed.dbName = String(next);
      i += 1;
      continue;
    }
  }
  return parsed;
}

function runOrFail(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.port.trim()) {
    throw new Error('Missing required --port argument.');
  }
  if (!args.persistTo.trim()) {
    throw new Error('Missing required --persist-to argument.');
  }

  const cloudCwd = process.cwd();
  const schemaFile = path.join(cloudCwd, 'src', 'db', 'schema.sql');
  if (!fs.existsSync(schemaFile)) {
    throw new Error(`Cloud schema file not found: ${schemaFile}`);
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const baseD1Args = [
    'exec',
    '--',
    'wrangler',
    'd1',
    'execute',
    args.dbName,
    '--local',
    '--persist-to',
    args.persistTo,
  ];
  if (args.env.trim()) {
    baseD1Args.push('--env', args.env.trim());
  }

  runOrFail(
    npmCmd,
    [...baseD1Args, '--file', schemaFile],
    { cwd: cloudCwd, stdio: 'inherit', env: process.env },
  );

  const devArgs = [
    'run',
    'dev',
    '--',
    '--local',
    '--port',
    args.port,
    '--persist-to',
    args.persistTo,
  ];
  if (args.env.trim()) {
    devArgs.push('--env', args.env.trim());
  }

  const child = spawn(npmCmd, devArgs, {
    cwd: cloudCwd,
    stdio: 'inherit',
    env: process.env,
  });

  const forwardSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of forwardSignals) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[dev-orchestrator] cloud bootstrap failed: ${message}`);
  process.exit(1);
}
