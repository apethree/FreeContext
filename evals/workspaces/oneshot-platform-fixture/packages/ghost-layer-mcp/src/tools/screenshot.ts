import { z } from 'zod';
import { takeScreenshot } from '../browser.js';

export const screenshotSchema = z.object({
  fullPage: z.boolean().optional(),
});

export type ScreenshotInput = z.infer<typeof screenshotSchema>;

export async function screenshotTool(input: ScreenshotInput) {
  const buffer = await takeScreenshot({ fullPage: input.fullPage });
  return {
    screenshot: buffer.toString('base64'),
    mimeType: 'image/png',
  };
}
