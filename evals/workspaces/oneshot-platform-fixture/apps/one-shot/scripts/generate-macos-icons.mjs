import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const preferredSourceSvg = path.join(appRoot, 'public', 'one-shot-logo-mac.svg');
const fallbackSourceSvg = path.join(appRoot, 'public', 'one-shot-logo.svg');
const sourceSvg = fs.existsSync(preferredSourceSvg) ? preferredSourceSvg : fallbackSourceSvg;
const outputRoot = path.join(appRoot, 'resources', 'icons');
const macOutputDir = path.join(outputRoot, 'mac');
const iconsetDir = path.join(macOutputDir, 'icon.iconset');
const icnsPath = path.join(outputRoot, 'icon.icns');

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

if (process.platform !== 'darwin') {
  console.error('[icon-gen] macOS is required (uses Playwright + sips + iconutil).');
  process.exit(1);
}

if (!fs.existsSync(sourceSvg)) {
  console.error(`[icon-gen] Source SVG not found: ${sourceSvg}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`[icon-gen] Command failed (${command} ${args.join(' ')})`);
  }
}

function ensureTool(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`[icon-gen] Missing required tool: ${command}`);
  }
}

async function renderSvgToPng(svgPath, pngPath, size) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html>
<html>
  <body style="margin:0;background:transparent;overflow:hidden;">
    <div id="icon" style="width:${size}px;height:${size}px;">
      <img id="source" src="${svgDataUrl}" alt="" style="display:block;width:100%;height:100%;" />
    </div>
  </body>
</html>`);

    await page.waitForFunction(() => {
      const img = document.getElementById('source');
      return Boolean(img && 'complete' in img && img.complete && img.naturalWidth > 0);
    });

    await page.screenshot({
      path: pngPath,
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: true,
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  ensureTool('sips');
  ensureTool('iconutil');

  const tmpDir = fs.mkdtempSync(path.join(appRoot, '.tmp-icongen-'));
  try {
    fs.mkdirSync(macOutputDir, { recursive: true });
    fs.rmSync(iconsetDir, { recursive: true, force: true });
    fs.mkdirSync(iconsetDir, { recursive: true });

    const basePng = path.join(tmpDir, 'source-1024.png');
    await renderSvgToPng(sourceSvg, basePng, 1024);

    for (const [filename, size] of iconsetSizes) {
      run('sips', ['-z', String(size), String(size), basePng, '--out', path.join(iconsetDir, filename)], {
        stdio: 'ignore',
      });
    }

    run('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);

    // Keep a 1024px source PNG for App Store metadata and future exports.
    fs.copyFileSync(basePng, path.join(macOutputDir, 'icon_1024x1024.png'));

    console.log(`[icon-gen] Source SVG: ${sourceSvg}`);
    console.log(`[icon-gen] Generated iconset: ${iconsetDir}`);
    console.log(`[icon-gen] Generated icns: ${icnsPath}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
