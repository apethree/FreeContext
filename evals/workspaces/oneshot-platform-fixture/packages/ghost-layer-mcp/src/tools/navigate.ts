import { z } from 'zod';
import { getPage } from '../browser.js';
import { resolveBrowserTarget } from '../../../annotation-core/src/browser-target.js';

export const navigateSchema = z.object({
  url: z.string().min(1),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  adaptOfficeDocs: z.boolean().optional(),
});

export type NavigateInput = z.infer<typeof navigateSchema>;

export async function navigateTool(input: NavigateInput) {
  const resolved = resolveBrowserTarget(input.url, {
    adaptOfficeDocs: input.adaptOfficeDocs !== false,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const page = await getPage();
  await page.goto(resolved.value.resolvedUrl, {
    waitUntil: input.waitUntil ?? 'domcontentloaded',
    timeout: 30_000,
  });
  const title = await page.title();
  const url = page.url();
  return {
    url,
    requestedUrl: resolved.value.canonicalUrl,
    resolvedUrl: resolved.value.resolvedUrl,
    surface: resolved.value.surface,
    adapter: resolved.value.adapter,
    title,
    status: 'navigated',
  };
}
