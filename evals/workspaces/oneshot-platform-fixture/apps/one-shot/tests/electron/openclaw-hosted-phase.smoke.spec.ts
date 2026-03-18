import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron, expect, test } from '@playwright/test';
import {
  closeElectronApp,
  createIsolatedUserDataDir,
  patchElectronMainEntry,
  resolveOneShotRoot,
  startViteRendererDevServer,
} from './e2eHarness';

async function getAppWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((window) => !window.url().startsWith('devtools://'));
    if (win) return win;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Could not find Electron renderer window (only DevTools windows detected).');
}

async function waitForSignedIn(page: Page) {
  let state: 'home' | 'auth' | 'missing_key' | 'pending' = 'pending';
  await expect
    .poll(
      async () => {
        const url = page.url();
        if (url.includes('/#/home')) state = 'home';
        else if (url.includes('/#/auth')) state = 'auth';
        else if (await page.getByText('Missing').isVisible().catch(() => false)) state = 'missing_key';
        else state = 'pending';
        return state;
      },
      { timeout: 45_000 },
    )
    .not.toBe('pending');

  if (state === 'missing_key') {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY; renderer cannot auto-sign in.');
  }
  if (state === 'auth') {
    throw new Error('App stayed on /auth. Auto sign-in did not activate.');
  }
}

test('openclaw hosted phase route smoke', async () => {
  const oneShotRoot = resolveOneShotRoot();
  const sourceEntry = path.resolve(oneShotRoot, '.vite', 'build', 'main.js');
  if (!fs.existsSync(sourceEntry)) {
    throw new Error(
      `Missing Electron entry at ${sourceEntry}. Start the desktop app once to generate .vite/build.`,
    );
  }

  const vite = await startViteRendererDevServer();
  const patchedEntry = patchElectronMainEntry({ port: vite.port, sourceEntry });
  const userDataDir = createIsolatedUserDataDir();

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [patchedEntry, `--user-data-dir=${userDataDir}`],
    });

    const page = await getAppWindow(app);
    await page.waitForLoadState('domcontentloaded');
    await waitForSignedIn(page);

    await page.evaluate(() => {
      window.location.hash = '#/home/openclaw-hosted-phase';
    });
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('/#/home/openclaw-hosted-phase');

    await expect(page.getByTestId('openclaw-hosted-phase-page')).toBeVisible();
    await expect(page.getByRole('button', { name: /Use Clerk Session Token/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect \+ Start Loop/i })).toBeVisible();
    await expect(page.getByText('phase1-incomplete')).toBeVisible();
    await expect(page.getByText('phase2-incomplete')).toBeVisible();
    await expect(page.getByText('device.register')).toBeVisible();
    await expect(page.getByText('node.connect')).toBeVisible();
    await expect(page.getByText('node.ping')).toBeVisible();

    await expect.poll(async () => {
      const profileRoot = await page.getByText('Profile Root').locator('..').textContent();
      return profileRoot || '';
    }, { timeout: 10_000 }).toContain('.oneshot/profiles/');

    await page.getByRole('button', { name: /Start Local OpenClaw/i }).click();
    await expect.poll(async () => {
      const content = await page.getByTestId('openclaw-hosted-phase-page').textContent();
      return content || '';
    }, { timeout: 15_000 }).toContain('gateway:');

    await page.getByPlaceholder('Paste Claude setup-token').fill('test-claude-setup-token');
    await page.getByRole('button', { name: /Save Claude setup-token/i }).click();
    await page.getByRole('button', { name: /List Local Auth Profiles/i }).click();
    await page.getByRole('button', { name: /Check Local Auth Store/i }).click();

    await expect.poll(async () => {
      const eventLog = await page.getByText('Event Log').locator('..').textContent();
      return eventLog || '';
    }, { timeout: 10_000 }).toContain('claude setup-token saved to profile anthropic:manual');
    await expect.poll(async () => {
      const eventLog = await page.getByText('Event Log').locator('..').textContent();
      return eventLog || '';
    }, { timeout: 10_000 }).toContain('auth-store: exists=true');
  } finally {
    await closeElectronApp(app);
    await vite.stop();
  }
});
