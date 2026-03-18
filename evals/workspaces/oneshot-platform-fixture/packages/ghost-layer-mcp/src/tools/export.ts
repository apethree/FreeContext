import { z } from 'zod';
import { getAnnotations, getPage, getViewport, takeScreenshot } from '../browser.js';
import { serializeToW3C, serializeToSimple } from '../../../annotation-core/src/serialize.js';
import type { AnnotationBundle } from '../../../annotation-core/src/types.js';

export const exportSchema = z.object({
  format: z.enum(['w3c', 'simple']).optional(),
});

export type ExportInput = z.infer<typeof exportSchema>;

export async function exportTool(input: ExportInput) {
  const page = await getPage();
  const viewport = await getViewport();
  const annotations = getAnnotations();
  const url = page.url();

  const bundle: AnnotationBundle = {
    url,
    capturedAt: new Date().toISOString(),
    viewport,
    annotations,
  };

  const format = input.format ?? 'w3c';
  const serialized = format === 'w3c' ? serializeToW3C(bundle) : serializeToSimple(bundle);

  // Take screenshot with annotations
  const screenshotBuffer = await takeScreenshot();
  const screenshot = screenshotBuffer.toString('base64');

  return {
    jsonld: JSON.stringify(serialized, null, 2),
    screenshot,
    screenshotMimeType: 'image/png',
    annotationCount: annotations.length,
    url,
    format,
  };
}
