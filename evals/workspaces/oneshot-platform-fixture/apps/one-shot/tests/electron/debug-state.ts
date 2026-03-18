/**
 * Quick diagnostic: launch Electron, wait 15s, take a screenshot, dump the URL and page text.
 * Run: npx ts-node --esm tests/electron/debug-state.ts
 *   or: node --loader ts-node/esm tests/electron/debug-state.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const appEntry = path.resolve(process.cwd(), '.vite', 'build', 'main.js');
if (!fs.existsSync(appEntry)) {
  console.error('Missing', appEntry);
  process.exit(1);
}

const app = await electron.launch({ args: [appEntry] });

const windows = await new Promise<ReturnType<typeof app.windows>>((resolve) => {
  // give it up to 20s to open a non-devtools window
  const deadline = Date.now() + 20_000;
  const interval = setInterval(() => {
    const wins = app.windows().filter((w) => !w.url().startsWith('devtools://'));
    if (wins.length > 0 || Date.now() > deadline) {
      clearInterval(interval);
      resolve(app.windows());
    }
  }, 300);
});

const page = windows.find((w) => !w.url().startsWith('devtools://'));
if (!page) {
  console.error('No renderer window found');
  await app.close();
  process.exit(1);
}

// Collect console output
const logs: string[] = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

// Wait for something to render
await page.waitForLoadState('domcontentloaded');
await new Promise((r) => setTimeout(r, 8_000));

const url = page.url();
const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '(eval failed)');
const title = await page.title().catch(() => '(no title)');

const outDir = path.join(process.cwd(), 'test-results', 'debug');
fs.mkdirSync(outDir, { recursive: true });

await page.screenshot({ path: path.join(outDir, 'state.png'), fullPage: true });

console.log('\n=== DIAGNOSTIC RESULT ===');
console.log('URL:', url);
console.log('Title:', title);
console.log('Body text (first 800 chars):\n', bodyText.slice(0, 800));
console.log('\n--- Console logs (last 20) ---');
logs.slice(-20).forEach((l) => console.log(l));
console.log('\nScreenshot saved to test-results/debug/state.png');

await app.close();
