import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';

export function resolveOneShotRoot(): string {
  // apps/one-shot/tests/electron -> apps/one-shot
  return path.resolve(__dirname, '..', '..');
}

export async function pickFreePort(preferredPort: number, attempts = 40): Promise<number> {
  const basePort = Number.isFinite(preferredPort) && preferredPort > 0 ? preferredPort : 5173;
  for (let i = 0; i < attempts; i += 1) {
    const port = basePort + i;
    // If something is already listening, treat as taken.
    // eslint-disable-next-line no-await-in-loop
    const inUse = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (inUse) continue;

    // eslint-disable-next-line no-await-in-loop
    const isFree = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (isFree) return port;
  }
  throw new Error(`No free port found near ${basePort}.`);
}

export async function pickEphemeralPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => reject(err));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve ephemeral port.')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number, proc?: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`Dev server process exited early (code=${proc.exitCode}).`);
    }
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${host}:${port} to accept connections.`);
}

export type ViteDevServerHandle = {
  port: number;
  proc: ChildProcessWithoutNullStreams;
  logs: string[];
  stop: () => Promise<void>;
};

export async function startViteRendererDevServer(input?: { port?: number }): Promise<ViteDevServerHandle> {
  const port = typeof input?.port === 'number' ? await pickFreePort(input.port) : await pickEphemeralPort();
  const logs: string[] = [];
  const oneShotRoot = resolveOneShotRoot();

  const proc = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vite', '--config', 'vite.renderer.config.ts'],
    {
      cwd: oneShotRoot,
      env: {
        ...process.env,
        ONESHOT_RENDERER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (data: string) => logs.push(data));
  proc.stderr.on('data', (data: string) => logs.push(data));

  try {
    await waitForPort('127.0.0.1', port, 60_000, proc);
  } catch (error) {
    const tail = logs.join('').split('\n').slice(-40).join('\n');
    await (async () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    })();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n\n[vite logs tail]\n${tail}`,
    );
  }

  async function stop(): Promise<void> {
    if (proc.killed) return;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 4_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  return { port, proc, logs, stop };
}

export function createIsolatedUserDataDir(): string {
  const requested = String(process.env.ONESHOT_E2E_USER_DATA_DIR || '').trim();
  const reset = String(process.env.ONESHOT_E2E_RESET_USER_DATA || '').trim().toLowerCase();

  if (requested) {
    if (reset === '1' || reset === 'true') {
      try {
        fs.rmSync(requested, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    fs.mkdirSync(requested, { recursive: true });
    return requested;
  }

  // Default to a stable test profile directory so sign-in can persist across runs.
  // This avoids E2E flakiness when dev auto-sign-in is not configured.
  const stable = path.join(resolveOneShotRoot(), 'test-results', 'electron-user-data');
  if (reset === '1' || reset === 'true') {
    try {
      fs.rmSync(stable, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  fs.mkdirSync(stable, { recursive: true });
  return stable;
}

export function patchElectronMainEntry(input: { port: number; sourceEntry: string }): string {
  const target = `http://127.0.0.1:${input.port}`;
  const sourceDir = path.dirname(input.sourceEntry);
  const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.js'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneshot-electron-entry-'));

  let replaced = false;
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const patched = raw
      .replaceAll('http://localhost:5173', target)
      .replaceAll('http://127.0.0.1:5173', target);
    if (patched !== raw) {
      replaced = true;
    }
    fs.writeFileSync(path.join(outDir, file), patched, 'utf8');
  }

  if (!replaced) {
    throw new Error('Did not find expected dev server URL in Electron build output.');
  }

  return path.join(outDir, path.basename(input.sourceEntry));
}

export async function closeElectronApp(app: ElectronApplication | null): Promise<void> {
  if (!app) return;
  try {
    await app.close();
  } catch {
    // ignore
  }
}
