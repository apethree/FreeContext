import { chromium, type Browser, type Page } from 'playwright';
import type { AnnotationShape, Viewport } from '../../annotation-core/src/types.js';
import { renderAnnotationsSvg } from '../../annotation-core/src/composite.js';

let browser: Browser | null = null;
let page: Page | null = null;
let annotations: AnnotationShape[] = [];
let annotationIdCounter = 0;

export async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }
  if (!page || page.isClosed()) {
    const context = browser.contexts()[0] ?? await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }
  return { browser, page };
}

export async function getPage(): Promise<Page> {
  const { page: p } = await ensureBrowser();
  return p;
}

export function getAnnotations(): AnnotationShape[] {
  return [...annotations];
}

export function addAnnotation(shape: Omit<AnnotationShape, 'id'>): AnnotationShape {
  annotationIdCounter += 1;
  const id = `mcp_ann_${annotationIdCounter}`;
  const annotation = { ...shape, id } as AnnotationShape;
  annotations.push(annotation);
  return annotation;
}

export function clearAnnotations(): number {
  const count = annotations.length;
  annotations = [];
  return count;
}

export async function getViewport(): Promise<Viewport> {
  const p = await getPage();
  const size = p.viewportSize() ?? { width: 1280, height: 800 };
  return {
    width: size.width,
    height: size.height,
    devicePixelRatio: 2,
  };
}

export async function injectAnnotationOverlay(): Promise<void> {
  const p = await getPage();
  const viewport = await getViewport();
  const svg = renderAnnotationsSvg(annotations, viewport);

  await p.evaluate((svgContent: string) => {
    let overlay = document.getElementById('__ghost_layer_overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__ghost_layer_overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;pointer-events:none;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = svgContent;
  }, svg);
}

export async function takeScreenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
  const p = await getPage();

  // Inject annotations before screenshot
  if (annotations.length > 0) {
    await injectAnnotationOverlay();
  }

  const buffer = await p.screenshot({
    fullPage: options?.fullPage ?? false,
    type: 'png',
  });

  return Buffer.from(buffer);
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
  annotations = [];
  annotationIdCounter = 0;
}
