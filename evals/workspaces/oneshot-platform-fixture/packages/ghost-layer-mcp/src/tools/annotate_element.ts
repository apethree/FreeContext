import { z } from 'zod';
import { getPage, addAnnotation, injectAnnotationOverlay } from '../browser.js';
import { DEFAULT_ANNOTATION_COLOR } from '../../../annotation-core/src/types.js';

export const annotateElementSchema = z.object({
  selector: z.string().min(1),
  note: z.string().optional(),
  type: z.enum(['circle', 'rect']).optional(),
  color: z.string().optional(),
});

export type AnnotateElementInput = z.infer<typeof annotateElementSchema>;

export async function annotateElementTool(input: AnnotateElementInput) {
  const page = await getPage();
  const color = input.color ?? DEFAULT_ANNOTATION_COLOR;

  const box = await page.locator(input.selector).first().boundingBox();
  if (!box) {
    return {
      error: `Element not found or not visible: ${input.selector}`,
      status: 'failed',
    };
  }

  const shapeType = input.type ?? 'rect';
  let shape: Parameters<typeof addAnnotation>[0];

  if (shapeType === 'circle') {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const r = Math.max(box.width, box.height) / 2 + 4;
    shape = { type: 'circle', cx, cy, r, color, note: input.note };
  } else {
    shape = {
      type: 'rect',
      x: box.x - 2,
      y: box.y - 2,
      w: box.width + 4,
      h: box.height + 4,
      color,
      note: input.note,
    };
  }

  const annotation = addAnnotation(shape);
  await injectAnnotationOverlay();

  return {
    id: annotation.id,
    type: annotation.type,
    boundingBox: box,
    status: 'created',
  };
}
