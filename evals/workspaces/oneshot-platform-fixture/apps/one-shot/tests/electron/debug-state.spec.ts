import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

async function getRendererWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => !w.url().startsWith('devtools://'));
    if (win) return win;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

test('diagnose: capture auth flow, console logs, screenshot', async () => {
  const appEntry = path.resolve(process.cwd(), '.vite', 'build', 'main.js');
  expect(fs.existsSync(appEntry), `Missing ${appEntry}`).toBe(true);

  const app = await electron.launch({ args: [appEntry] });

  const page = await getRendererWindow(app);
  if (!page) throw new Error('No renderer window found after 20s');

  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    // Print immediately so we can see auth flow in real time
    if (msg.type() === 'error' || msg.text().includes('AutoSignIn') || msg.text().includes('clerk') || msg.text().includes('Clerk')) {
      console.log('LIVE:', text);
    }
  });
  page.on('pageerror', (err) => {
    console.log('PAGE ERROR:', err.message);
    logs.push(`[pageerror] ${err.message}`);
  });

  await page.waitForLoadState('domcontentloaded');

  // Poll URL for up to 30s and log every change
  let lastUrl = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const url = page.url();
    if (url !== lastUrl) {
      console.log(`[${i * 500}ms] URL changed: ${url}`);
      lastUrl = url;
    }
    if (url.includes('/#/home') || url.includes('/#/auth')) break;
  }

  await page.waitForTimeout(2_000);

  const url = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '(eval failed)');

  const outDir = path.join(process.cwd(), 'test-results', 'debug');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'auth-flow.png'), fullPage: true });

  console.log('\n=== FINAL STATE ===');
  console.log('URL:', url);
  console.log('Body (first 600):\n', bodyText.slice(0, 600));
  console.log('\n--- All console logs ---');
  logs.forEach((l) => console.log(l));

  await app.close();
});
