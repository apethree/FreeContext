#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import pm2 from 'pm2';
import {
  cleanupStaleWorktrees,
  collectManagedProcessNames,
  loadResolvedWorktrees,
  orchestratorPaths,
  setWorktreeEnabled,
  setWorktreeProfile,
  writeEcosystemFile,
} from './shared-config.mjs';

const args = process.argv.slice(2);
const command = String(args[0] || 'status').trim();
const rest = args.slice(1);
const outputJson = rest.includes('--json');

function connectPm2() {
  return new Promise((resolve, reject) => {
    pm2.connect((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function disconnectPm2() {
  try {
    pm2.disconnect();
  } catch {
    // no-op
  }
}

function listPm2() {
  return new Promise((resolve, reject) => {
    pm2.list((error, list) => {
      if (error) return reject(error);
      resolve(list || []);
    });
  });
}

function startDefinition(definition) {
  return new Promise((resolve, reject) => {
    pm2.start(definition, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function actionProcess(name, action) {
  return new Promise((resolve, reject) => {
    pm2[action](name, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function isTcpPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function printStatus(resolved, processList) {
  const byName = new Map(processList.map((item) => [item.name, item]));
  const rows = resolved.worktrees.map((worktree) => {
    const cloud = byName.get(worktree.cloudProcessName);
    const app = byName.get(worktree.appProcessName);
    const cloudStatus = cloud?.pm2_env?.status || 'missing';
    const appStatus = app?.pm2_env?.status || 'missing';
    return {
      worktreeKey: worktree.worktreeKey,
      enabled: worktree.enabled,
      profile: worktree.profile,
      path: worktree.path,
      branch: worktree.branch,
      cloudPort: worktree.cloudPort,
      appPort: worktree.appPort,
      cloudStatus,
      appStatus,
      blockedReason: worktree.blockedReason || '',
    };
  });

  if (outputJson) {
    console.log(JSON.stringify({
      ok: true,
      configPath: orchestratorPaths.localConfig,
      worktrees: rows,
    }, null, 2));
    return;
  }

  for (const row of rows) {
    const blocked = row.blockedReason ? ` blocked=${row.blockedReason}` : '';
    console.log(`${row.worktreeKey.padEnd(28)} cloud=${String(row.cloudStatus).padEnd(10)} app=${String(row.appStatus).padEnd(10)} enabled=${row.enabled ? 'yes' : 'no '} profile=${String(row.profile || '-').padEnd(12)} ports ${String(row.cloudPort || '-').padStart(4)}/${String(row.appPort || '-').padStart(4)}${blocked}`);
  }
}

async function run() {
  if (command === 'enable') {
    const key = String(rest[0] || '').trim();
    if (!key) throw new Error('Usage: pm2-worktrees.mjs enable <worktreeKey>');
    const resolved = setWorktreeEnabled(key, true);
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'disable') {
    const key = String(rest[0] || '').trim();
    if (!key) throw new Error('Usage: pm2-worktrees.mjs disable <worktreeKey>');
    const resolved = setWorktreeEnabled(key, false);
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'profile') {
    const key = String(rest[0] || '').trim();
    const profile = String(rest[1] || '').trim();
    if (!key || !profile) throw new Error('Usage: pm2-worktrees.mjs profile <worktreeKey> <profileName>');
    const resolved = setWorktreeProfile(key, profile);
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'cleanup-stale') {
    const resolved = cleanupStaleWorktrees();
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  const resolved = loadResolvedWorktrees({ allowExampleFallback: true });
  const managedNames = collectManagedProcessNames(resolved);

  if (command === 'rescan') {
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'start') {
    const generated = writeEcosystemFile(resolved);
    await connectPm2();
    try {
      const skipped = [];
      for (const definition of generated.apps) {
        const isCloud = String(definition.name || '').endsWith(':cloud');
        const portKey = isCloud ? 'ONESHOT_CLOUD_PORT' : 'ONESHOT_APP_PORT';
        const port = Number(definition?.env?.[portKey] || 0);
        if (Number.isFinite(port) && port > 0) {
          const isFree = await isTcpPortAvailable(port);
          if (!isFree) {
            skipped.push(`${definition.name} (${isCloud ? 'cloud' : 'app'} port ${port} already in use)`);
            continue;
          }
        }
        await startDefinition(definition);
      }
      const processList = await listPm2();
      console.log('[dev-orchestrator] started enabled + unblocked processes');
      if (skipped.length > 0) {
        for (const item of skipped) {
          console.log(`[dev-orchestrator] skipped ${item}`);
        }
      }
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'status') {
    await connectPm2();
    try {
      const processList = await listPm2();
      printStatus(resolved, processList);
    } finally {
      disconnectPm2();
    }
    return;
  }

  if (command === 'logs' || command === 'logs-live') {
    const localPm2Bin = path.join(
      orchestratorPaths.appRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'pm2.cmd' : 'pm2',
    );
    const pm2Bin = fs.existsSync(localPm2Bin)
      ? localPm2Bin
      : (process.platform === 'win32' ? 'pm2.cmd' : 'pm2');
    const args2 = ['logs', ...managedNames, '--lines', command === 'logs-live' ? '0' : '200'];
    const child = spawn(pm2Bin, args2, {
      cwd: orchestratorPaths.appRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  if (command !== 'stop' && command !== 'restart' && command !== 'delete') {
    throw new Error(`Unknown command: ${command}`);
  }

  await connectPm2();
  try {
    const processList = await listPm2();
    const existingNames = new Set(processList.map((item) => item.name));
    const targets = managedNames.filter((name) => existingNames.has(name));
    for (const name of targets) {
      await actionProcess(name, command);
    }
    const next = await listPm2();
    console.log(`[dev-orchestrator] ${command} complete`);
    printStatus(resolved, next);
  } finally {
    disconnectPm2();
  }
}

run().catch((error) => {
  disconnectPm2();
  console.error(`[dev-orchestrator] ${String(error)}`);
  process.exit(1);
});
