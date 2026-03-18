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
    const windows = app.windows();
    const appWindow = windows.find((window) => !window.url().startsWith('devtools://'));
    if (appWindow) {
      return appWindow;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Could not find Electron renderer window (only DevTools windows detected).');
}

test('opens Electron and navigates to Create Project', async () => {
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
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.waitForLoadState('domcontentloaded');

    // Wait for the app to reach a signed-in route. The renderer may briefly
    // land on /#/auth while Clerk hydrates or AutoSignIn runs, so keep polling
    // until we see /#/home (or /#/home/create) or a terminal failure.
    let routeState: 'create' | 'home' | 'auth' | 'missing_key' | 'other' = 'other';
    await expect
      .poll(
        async () => {
          const url = page.url();
          if (url.includes('/#/home/create')) routeState = 'create';
          else if (url.includes('/#/home')) routeState = 'home';
          else if (url.includes('/#/auth')) routeState = 'auth';
          else if (await page.getByText('Missing').isVisible().catch(() => false)) routeState = 'missing_key';
          else routeState = 'other';
          // Only resolve when we reach a signed-in route or a terminal failure
          if (routeState === 'home' || routeState === 'create' || routeState === 'missing_key') {
            return routeState;
          }
          // Keep polling while on auth (AutoSignIn may still be running) or other
          return 'pending';
        },
        { timeout: 45_000 },
      )
      .not.toBe('pending');

    if (routeState === 'missing_key') {
      throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY; renderer cannot auto-sign in.');
    }

    if (routeState === 'auth') {
      throw new Error(
        'App stayed on /auth. Auto sign-in did not activate; configure Clerk session or dev auto-sign-in env.',
      );
    }

    if (!page.url().includes('/#/home/create')) {
      // Navigate directly via hash router
      await page.evaluate(() => (window.location.hash = '#/home/create'));
    }

    await expect
      .poll(() => page.url(), {
        timeout: 10_000,
      })
      .toContain('/#/home/create');

    console.log(`[electron-smoke] console messages captured: ${consoleMessages.length}`);
    if (consoleMessages.length > 0) {
      console.log(`[electron-smoke] latest: ${consoleMessages.slice(-3).join(' | ')}`);
    }
  } finally {
    await closeElectronApp(app);
    await vite.stop();
  }
});

