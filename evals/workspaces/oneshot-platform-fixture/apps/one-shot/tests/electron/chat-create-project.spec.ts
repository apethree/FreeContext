/**
 * End-to-end: Launch Electron, open Create Project, click starter prompt, answer first question,
 * and verify the assistant resumes streaming.
 *
 * This test is self-contained:
 * - Starts its own Vite renderer dev server on a free port (does NOT require 5173).
 * - Patches the built Electron main entry (.vite/build/main.js) to point to that port.
 * - Launches Electron with an isolated Chromium profile (`--user-data-dir`) so it can run even
 *   if another one-shot instance is already open.
 */
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

type NetworkLogLine = {
  at: string;
  kind: 'request' | 'response' | 'requestfailed';
  method?: string;
  url: string;
  status?: number;
  errorText?: string;
};

const SCREENSHOT_DIRNAME = path.join('test-results', 'chat-create');

async function getAppWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => !w.url().startsWith('devtools://'));
    if (win) return win;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('No renderer window found (only DevTools windows detected).');
}

async function waitForSignedIn(page: Page) {
  await expect
    .poll(
      () => {
        const url = page.url();
        if (url.includes('/#/home')) return 'home';
        if (url.includes('/#/auth')) return 'auth';
        return 'pending';
      },
      { timeout: 90_000, message: 'Timed out waiting for app to reach /home or /auth' },
    )
    .not.toBe('pending');

  const url = page.url();
  if (!url.includes('/#/home')) {
    throw new Error(
      `App did not sign in automatically (landed on ${url}). Sign in once using the E2E profile and rerun.`,
    );
  }
}

function iso() {
  return new Date().toISOString();
}

test('create project chat: answer first question and verify resume', async () => {
  test.setTimeout(150_000);

  const oneShotRoot = resolveOneShotRoot();
  const screenshotDir = path.join(oneShotRoot, SCREENSHOT_DIRNAME);
  fs.mkdirSync(screenshotDir, { recursive: true });

  const sourceEntry = path.resolve(oneShotRoot, '.vite', 'build', 'main.js');
  if (!fs.existsSync(sourceEntry)) {
    throw new Error(`Missing ${sourceEntry}. Start the desktop app once to generate .vite/build.`);
  }

  const networkLogs: NetworkLogLine[] = [];
  const consoleLogs: string[] = [];

  const vite = await startViteRendererDevServer();
  const patchedEntry = patchElectronMainEntry({ port: vite.port, sourceEntry });
  const userDataDir = createIsolatedUserDataDir();

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [patchedEntry, `--user-data-dir=${userDataDir}`],
    });
    const page = await getAppWindow(app);

    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    // Capture renderer-level fetch/network issues too (important when Vite port or backend CORS breaks).
    page.on('requestfailed', (req) => {
      if (req.url().includes('/assistant/agent/')) return;
      const err = req.failure()?.errorText;
      if (!err) return;
      consoleLogs.push(`[requestfailed] ${req.method()} ${req.url()} :: ${err}`);
    });

    page.on('request', (req) => {
      const url = req.url();
      if (!url.includes('/assistant/agent/')) return;
      networkLogs.push({ at: iso(), kind: 'request', method: req.method(), url });
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (!url.includes('/assistant/agent/')) return;
      networkLogs.push({
        at: iso(),
        kind: 'requestfailed',
        method: req.method(),
        url,
        errorText: req.failure()?.errorText,
      });
    });
    page.on('response', (res) => {
      const url = res.url();
      if (!url.includes('/assistant/agent/')) return;
      networkLogs.push({ at: iso(), kind: 'response', url, status: res.status() });
    });

    const snap = (name: string) =>
      page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });

    await page.waitForLoadState('domcontentloaded');

    // 1) Wait for auth to resolve → /#/home
    await waitForSignedIn(page);
    await snap('01-signed-in');

    // 2) Navigate to create project via quick actions (preferred UX path). Fall back to direct route.
    if (!page.url().includes('/#/home/create')) {
      const quickActions = page.getByRole('button', { name: /quick actions/i });
      const hasQuickActions = await quickActions.isVisible().catch(() => false);
      if (hasQuickActions) {
        await quickActions.click();
        await page.getByRole('menuitem', { name: /create project/i }).click();
        await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('/#/home/create');
      } else {
        await page.evaluate(() => (window.location.hash = '#/home/create'));
        await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('/#/home/create');
      }
    }
    await page.waitForTimeout(1_000);
    await snap('02-create-page');

    // 3) Verify Create Project page is present (heading can vary while chat loads).
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });

    // 4) Click the first starter prompt card (game)
    const starterCard = page.locator('text=Game app scaffold').first();
    await expect(starterCard).toBeVisible({ timeout: 20_000 });
    await starterCard.click();
    await snap('03-starter-selected');

    // 5) Wait for backend connection (status label "Connecting" disappears when session is ready)
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    const connectingLabel = page.locator('text=Connecting').first();
    await expect(connectingLabel).toBeHidden({ timeout: 40_000 });

    // 6) Send message via Enter
    await textarea.press('Enter');
    await page.waitForTimeout(1_500);
    await snap('04-message-sent');

    // 7) Wait for question UI to appear (freeform placeholder is the most stable selector)
    const freeform = page.getByPlaceholder('Type your answer...').first();
    await expect(freeform).toBeVisible({ timeout: 60_000 });
    await snap('05-question-visible');

    await freeform.fill('single player');
    await page.getByRole('button', { name: /^Submit$/ }).first().click();
    await expect(page.getByText(/Response submitted/i).first()).toBeVisible({ timeout: 15_000 });
    await snap('06-question-submitted');

    // 8) Verify assistant resumes (new streaming content, plan card, or approval card).
    await expect
      .poll(
        async () => {
          const waitingCount = await page.getByText(/Waiting for assistant/i).count().catch(() => 0);
          const bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
          const hasPlanSignals = await page
            .locator('text=/Request revision|Implement now|approval/i')
            .count()
            .catch(() => 0);

          if (hasPlanSignals > 0) return 'resumed';
          if (waitingCount === 0 && bodyLen > 800) return 'resumed';
          return `waiting:${waitingCount}:${bodyLen}`;
        },
        { timeout: 60_000, message: 'Waiting for assistant to resume after question answer' },
      )
      .toBe('resumed');

    await snap('07-resumed');

    // Print diagnostics if any
    const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    if (errors.length > 0) {
      console.log(`[test] console errors (${errors.length}) tail:`);
      errors.slice(-8).forEach((e) => console.log('  ', e));
    }
  } catch (error) {
    // Dump network logs to help debug stalls.
    const oneShotRoot = resolveOneShotRoot();
    const out = path.join(oneShotRoot, SCREENSHOT_DIRNAME, 'network-log.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(networkLogs, null, 2), 'utf8');
    const consoleOut = path.join(oneShotRoot, SCREENSHOT_DIRNAME, 'console-log.txt');
    fs.writeFileSync(consoleOut, consoleLogs.join('\n') + '\n', 'utf8');
    throw error;
  } finally {
    await closeElectronApp(app);
    await vite.stop();
  }
});
