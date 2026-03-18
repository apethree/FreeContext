import { z } from 'zod';
import { addAnnotation, injectAnnotationOverlay } from '../browser.js';
import { DEFAULT_ANNOTATION_COLOR } from '../../../annotation-core/src/types.js';

const pointSchema = z.object({ x: z.number(), y: z.number() });

export const annotateSchema = z.object({
  type: z.enum(['circle', 'rect', 'arrow', 'line', 'text', 'freehand']),
  coords: z.union([
    z.object({ x: z.number(), y: z.number(), r: z.number().optional() }),
    z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    z.object({ from: pointSchema, to: pointSchema }),
    z.object({ points: z.array(pointSchema) }),
  ]),
  note: z.string().optional(),
  color: z.string().optional(),
  content: z.string().optional(),
});

export type AnnotateInput = z.infer<typeof annotateSchema>;

export async function annotateTool(input: AnnotateInput) {
  const color = input.color ?? DEFAULT_ANNOTATION_COLOR;
  const coords = input.coords as Record<string, unknown>;

  let shape: Parameters<typeof addAnnotation>[0];

  switch (input.type) {
    case 'circle':
      shape = {
        type: 'circle',
        cx: coords.x as number,
        cy: coords.y as number,
        r: (coords.r as number) ?? 20,
        color,
        note: input.note,
      };
      break;
    case 'rect':
      shape = {
        type: 'rect',
        x: coords.x as number,
        y: coords.y as number,
        w: (coords.w as number) ?? 100,
        h: (coords.h as number) ?? 50,
        color,
        note: input.note,
      };
      break;
    case 'arrow':
      shape = {
        type: 'arrow',
        from: coords.from as { x: number; y: number },
        to: coords.to as { x: number; y: number },
        color,
        note: input.note,
      };
      break;
    case 'line':
      shape = {
        type: 'line',
        from: coords.from as { x: number; y: number },
        to: coords.to as { x: number; y: number },
        color,
        note: input.note,
      };
      break;
    case 'text':
      shape = {
        type: 'text',
        x: coords.x as number,
        y: coords.y as number,
        content: input.content ?? input.note ?? 'Note',
        color,
      };
      break;
    case 'freehand':
      shape = {
        type: 'freehand',
        points: coords.points as { x: number; y: number }[],
        color,
        note: input.note,
      };
      break;
    default:
      throw new Error(`Unknown annotation type: ${input.type}`);
  }

  const annotation = addAnnotation(shape);
  await injectAnnotationOverlay();

  return {
    id: annotation.id,
    type: annotation.type,
    status: 'created',
  };
}
