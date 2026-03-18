import type { AnnotationShape, Point, Viewport } from './types.js';

export type NormalizedCoords = {
  xNorm: number;
  yNorm: number;
};

export function normalizePoint(point: Point, viewport: Viewport): NormalizedCoords {
  return {
    xNorm: point.x / viewport.width,
    yNorm: point.y / viewport.height,
  };
}

export function denormalizePoint(norm: NormalizedCoords, viewport: Viewport): Point {
  return {
    x: norm.xNorm * viewport.width,
    y: norm.yNorm * viewport.height,
  };
}

export function normalizeShape(
  shape: AnnotationShape,
  viewport: Viewport,
): AnnotationShape & { _normalized: true } {
  switch (shape.type) {
    case 'circle':
      return {
        ...shape,
        cx: shape.cx / viewport.width,
        cy: shape.cy / viewport.height,
        r: shape.r / Math.min(viewport.width, viewport.height),
        _normalized: true,
      };
    case 'rect':
      return {
        ...shape,
        x: shape.x / viewport.width,
        y: shape.y / viewport.height,
        w: shape.w / viewport.width,
        h: shape.h / viewport.height,
        _normalized: true,
      };
    case 'arrow':
    case 'line':
      return {
        ...shape,
        from: {
          x: shape.from.x / viewport.width,
          y: shape.from.y / viewport.height,
        },
        to: {
          x: shape.to.x / viewport.width,
          y: shape.to.y / viewport.height,
        },
        _normalized: true,
      };
    case 'text':
      return {
        ...shape,
        x: shape.x / viewport.width,
        y: shape.y / viewport.height,
        connector: shape.connector?.bend !== undefined
          ? {
              ...shape.connector,
              bend: shape.connector.bend / Math.min(viewport.width, viewport.height),
            }
          : shape.connector,
        _normalized: true,
      };
    case 'freehand':
      return {
        ...shape,
        points: shape.points.map((p) => ({
          x: p.x / viewport.width,
          y: p.y / viewport.height,
        })),
        _normalized: true,
      };
    case 'snapshot':
      return {
        ...shape,
        x: shape.x / viewport.width,
        y: shape.y / viewport.height,
        w: shape.w / viewport.width,
        h: shape.h / viewport.height,
        originX: (Number.isFinite(shape.originX) ? shape.originX : shape.x) / viewport.width,
        originY: (Number.isFinite(shape.originY) ? shape.originY : shape.y) / viewport.height,
        _normalized: true,
      };
  }
}

export function denormalizeShape(
  shape: AnnotationShape,
  viewport: Viewport,
): AnnotationShape {
  switch (shape.type) {
    case 'circle':
      return {
        ...shape,
        cx: shape.cx * viewport.width,
        cy: shape.cy * viewport.height,
        r: shape.r * Math.min(viewport.width, viewport.height),
      };
    case 'rect':
      return {
        ...shape,
        x: shape.x * viewport.width,
        y: shape.y * viewport.height,
        w: shape.w * viewport.width,
        h: shape.h * viewport.height,
      };
    case 'arrow':
    case 'line':
      return {
        ...shape,
        from: {
          x: shape.from.x * viewport.width,
          y: shape.from.y * viewport.height,
        },
        to: {
          x: shape.to.x * viewport.width,
          y: shape.to.y * viewport.height,
        },
      };
    case 'text':
      return {
        ...shape,
        x: shape.x * viewport.width,
        y: shape.y * viewport.height,
        connector: shape.connector?.bend !== undefined
          ? {
              ...shape.connector,
              bend: shape.connector.bend * Math.min(viewport.width, viewport.height),
            }
          : shape.connector,
      };
    case 'freehand':
      return {
        ...shape,
        points: shape.points.map((p) => ({
          x: p.x * viewport.width,
          y: p.y * viewport.height,
        })),
      };
    case 'snapshot':
      return {
        ...shape,
        x: shape.x * viewport.width,
        y: shape.y * viewport.height,
        w: shape.w * viewport.width,
        h: shape.h * viewport.height,
        originX: (Number.isFinite(shape.originX) ? shape.originX : shape.x) * viewport.width,
        originY: (Number.isFinite(shape.originY) ? shape.originY : shape.y) * viewport.height,
      };
  }
}
