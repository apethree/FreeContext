import { z } from 'zod';
import { getPage } from '../browser.js';

export const highlightSchema = z.object({
  selector: z.string().min(1),
  color: z.string().optional(),
});

export type HighlightInput = z.infer<typeof highlightSchema>;

export async function highlightTool(input: HighlightInput) {
  const page = await getPage();
  const color = input.color ?? '#3b82f6';

  const result = await page.evaluate(
    ({ selector, color }: { selector: string; color: string }) => {
      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) return { found: 0 };

      elements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.outline = `3px solid ${color}`;
        htmlEl.style.outlineOffset = '2px';
        htmlEl.dataset.ghostHighlight = 'true';
      });

      return { found: elements.length };
    },
    { selector: input.selector, color },
  );

  return {
    selector: input.selector,
    highlightedCount: result.found,
    color,
    status: result.found > 0 ? 'highlighted' : 'not_found',
  };
}
