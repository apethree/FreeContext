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

test('openclaw demo route smoke', async () => {
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
      window.location.hash = '#/home/openclaw-demo';
    });
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('/#/home/openclaw-demo');

    await expect(page.getByTestId('openclaw-control-section')).toBeVisible();
    await expect(page.getByTestId('gateway-connection-section')).toBeVisible();
    await expect(page.getByTestId('gateway-activity-section')).toBeVisible();
    await expect(page.getByTestId('connected-devices-section')).toBeVisible();
    await expect(page.getByTestId('basic-chat-section')).toBeVisible();

    const enableButton = page.getByRole('button', { name: /^Enable OpenClaw$|^Disable OpenClaw$/ });
    await expect(enableButton).toBeVisible();
    await enableButton.click();

    await expect
      .poll(
        async () => {
          const controlText = await page.getByTestId('openclaw-control-section').innerText();
          const connectionText = await page.getByTestId('gateway-connection-section').innerText();
          if (connectionText.toLowerCase().includes('connected')) return 'connected';
          if (controlText.toLowerCase().includes('failed')) return 'failed';
          return 'pending';
        },
        { timeout: 90_000 },
      )
      .not.toBe('pending');

    const refreshDevicesButton = page.getByRole('button', { name: /refresh devices/i });
    await refreshDevicesButton.click();
    await expect
      .poll(
        () => page.getByTestId('openclaw-control-section').innerText(),
        { timeout: 30_000 },
      )
      .toMatch(/node\.list (loaded|failed)/i);

    const chatInput = page.getByTestId('openclaw-chat-input');
    await chatInput.fill('ping from openclaw-demo smoke test');
    await page.getByRole('button', { name: /^Send$/ }).click();

    await expect
      .poll(
        async () => {
          const chatText = await page.getByTestId('openclaw-chat-log').innerText();
          const sectionText = await page.getByTestId('basic-chat-section').innerText();
          if (chatText.includes('ping from openclaw-demo smoke test')) {
            if (/assistant|system/i.test(chatText)) return 'chat-updated';
          }
          if (/chat\.send failed|gateway .*failed|socket not connected/i.test(sectionText.toLowerCase())) {
            return 'chat-error';
          }
          return 'pending';
        },
        { timeout: 60_000 },
      )
      .not.toBe('pending');
  } finally {
    await closeElectronApp(app);
    await vite.stop();
  }
});
