import type { AnnotationShape, TextShape, Viewport } from './types.js';

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ConnectedLabelMetrics = {
  width: number;
  height: number;
  paddingX: number;
  baselineY: number;
};

export type LabelPlacement = {
  x: number;
  y: number;
  rect: Rect;
  placement: string;
  score: number;
};

const CONNECTED_LABEL_MIN_WIDTH = 72;
const CONNECTED_LABEL_MAX_WIDTH = 320;
const CONNECTED_LABEL_HEIGHT = 30;
const CONNECTED_LABEL_PADDING_X = 10;
const CONNECTED_LABEL_BASELINE_Y = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rectOverlapArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

function expandRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    w: rect.w + by * 2,
    h: rect.h + by * 2,
  };
}

function toTextPoint(rect: Rect, metrics: ConnectedLabelMetrics): { x: number; y: number } {
  return {
    x: rect.x + metrics.paddingX,
    y: rect.y + metrics.baselineY,
  };
}

function getConnectedLabelRectFromPoint(x: number, y: number, content: string): Rect {
  const metrics = estimateConnectedLabelMetrics(content);
  return {
    x: x - metrics.paddingX,
    y: y - metrics.baselineY,
    w: metrics.width,
    h: metrics.height,
  };
}

export function estimateConnectedLabelMetrics(content: string): ConnectedLabelMetrics {
  const roughWidth = content.trim().length * 7.5 + 20;
  return {
    width: clamp(roughWidth, CONNECTED_LABEL_MIN_WIDTH, CONNECTED_LABEL_MAX_WIDTH),
    height: CONNECTED_LABEL_HEIGHT,
    paddingX: CONNECTED_LABEL_PADDING_X,
    baselineY: CONNECTED_LABEL_BASELINE_Y,
  };
}

export function getTextShapeRect(shape: TextShape): Rect {
  // Both connected and standalone text labels use the same chip metrics for a unified look.
  return getConnectedLabelRectFromPoint(shape.x, shape.y, shape.content || ' ');
}

export function getShapeBounds(shape: AnnotationShape): Rect {
  switch (shape.type) {
    case 'circle':
      return {
        x: shape.cx - shape.r,
        y: shape.cy - shape.r,
        w: shape.r * 2,
        h: shape.r * 2,
      };
    case 'rect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'snapshot':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'arrow':
    case 'line': {
      const x = Math.min(shape.from.x, shape.to.x);
      const y = Math.min(shape.from.y, shape.to.y);
      return {
        x,
        y,
        w: Math.max(1, Math.abs(shape.to.x - shape.from.x)),
        h: Math.max(1, Math.abs(shape.to.y - shape.from.y)),
      };
    }
    case 'freehand': {
      if (shape.points.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of shape.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return {
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
      };
    }
    case 'text':
      return getTextShapeRect(shape);
  }
}

export function buildAnnotationObstacleRects(
  annotations: AnnotationShape[],
  options?: {
    excludeIds?: Set<string>;
    padding?: number;
  },
): Rect[] {
  const excludeIds = options?.excludeIds ?? new Set<string>();
  const padding = options?.padding ?? 8;
  return annotations
    .filter((shape) => !excludeIds.has(shape.id))
    .map((shape) => expandRect(getShapeBounds(shape), padding));
}

function candidateLabelRects(parentBounds: Rect, metrics: ConnectedLabelMetrics): Array<{ placement: string; rect: Rect }> {
  const gap = 14;
  const cx = parentBounds.x + parentBounds.w / 2;
  const cy = parentBounds.y + parentBounds.h / 2;
  const mw = metrics.width;
  const mh = metrics.height;
  return [
    { placement: 'right', rect: { x: parentBounds.x + parentBounds.w + gap, y: cy - mh / 2, w: mw, h: mh } },
    { placement: 'top-right', rect: { x: parentBounds.x + parentBounds.w + gap, y: parentBounds.y - mh - gap, w: mw, h: mh } },
    { placement: 'bottom-right', rect: { x: parentBounds.x + parentBounds.w + gap, y: parentBounds.y + parentBounds.h + gap, w: mw, h: mh } },
    { placement: 'left', rect: { x: parentBounds.x - mw - gap, y: cy - mh / 2, w: mw, h: mh } },
    { placement: 'top-left', rect: { x: parentBounds.x - mw - gap, y: parentBounds.y - mh - gap, w: mw, h: mh } },
    { placement: 'bottom-left', rect: { x: parentBounds.x - mw - gap, y: parentBounds.y + parentBounds.h + gap, w: mw, h: mh } },
    { placement: 'top', rect: { x: cx - mw / 2, y: parentBounds.y - mh - gap, w: mw, h: mh } },
    { placement: 'bottom', rect: { x: cx - mw / 2, y: parentBounds.y + parentBounds.h + gap, w: mw, h: mh } },
  ];
}

function outsideViewportPenalty(rect: Rect, viewport: Pick<Viewport, 'width' | 'height'>): number {
  const overflowLeft = Math.max(0, -rect.x);
  const overflowTop = Math.max(0, -rect.y);
  const overflowRight = Math.max(0, rect.x + rect.w - viewport.width);
  const overflowBottom = Math.max(0, rect.y + rect.h - viewport.height);
  const overflowArea = (overflowLeft + overflowRight) * rect.h + (overflowTop + overflowBottom) * rect.w;
  if (overflowArea <= 0) return 0;
  return 1000 + overflowArea * 25;
}

function scoreCandidate(args: {
  candidate: Rect;
  parentBounds: Rect;
  obstacles: Rect[];
  viewport?: Pick<Viewport, 'width' | 'height'>;
}): number {
  const { candidate, parentBounds, obstacles, viewport } = args;
  const parentCenter = {
    x: parentBounds.x + parentBounds.w / 2,
    y: parentBounds.y + parentBounds.h / 2,
  };
  const candidateCenter = {
    x: candidate.x + candidate.w / 2,
    y: candidate.y + candidate.h / 2,
  };
  let score = Math.hypot(candidateCenter.x - parentCenter.x, candidateCenter.y - parentCenter.y) * 0.03;

  for (const obstacle of obstacles) {
    const overlap = rectOverlapArea(candidate, obstacle);
    if (overlap > 0) {
      score += 1800 + overlap * 15;
    } else {
      const dist = rectDistance(candidate, obstacle);
      if (dist < 12) {
        score += (12 - dist) * 18;
      }
    }
  }

  if (viewport) {
    score += outsideViewportPenalty(candidate, viewport);
  }
  return score;
}

export function placeConnectedLabel(args: {
  parent: AnnotationShape;
  annotations: AnnotationShape[];
  content: string;
  viewport?: Pick<Viewport, 'width' | 'height'>;
  excludeIds?: Set<string>;
}): LabelPlacement {
  const { parent, annotations, content, viewport } = args;
  const excludeIds = args.excludeIds ?? new Set<string>();
  const metrics = estimateConnectedLabelMetrics(content);
  const parentBounds = getShapeBounds(parent);
  const obstacles = buildAnnotationObstacleRects(annotations, {
    excludeIds,
    padding: 8,
  });
  const candidates = candidateLabelRects(parentBounds, metrics);

  let best = candidates[0];
  let bestScore = scoreCandidate({
    candidate: best.rect,
    parentBounds,
    obstacles,
    viewport,
  });

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreCandidate({
      candidate: candidate.rect,
      parentBounds,
      obstacles,
      viewport,
    });
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  const point = toTextPoint(best.rect, metrics);
  return {
    x: point.x,
    y: point.y,
    rect: best.rect,
    placement: best.placement,
    score: bestScore,
  };
}

export function relayoutConnectedLabels(args: {
  annotations: AnnotationShape[];
  parentId: string;
  viewport?: Pick<Viewport, 'width' | 'height'>;
}): AnnotationShape[] {
  const { annotations, parentId, viewport } = args;
  const parent = annotations.find((shape) => shape.id === parentId);
  if (!parent) return annotations;

  let next = annotations.slice();
  const children = next.filter(
    (shape): shape is TextShape => shape.type === 'text' && shape.parentId === parentId,
  );

  for (const child of children) {
    if (child.labelMode === 'manual') continue;
    const placement = placeConnectedLabel({
      parent,
      annotations: next,
      content: child.content,
      viewport,
      excludeIds: new Set([parentId, child.id]),
    });
    next = next.map((shape) => {
      if (shape.id !== child.id || shape.type !== 'text') return shape;
      return {
        ...shape,
        x: placement.x,
        y: placement.y,
        labelMode: 'auto',
        connector: shape.connector?.mode === 'manual'
          ? shape.connector
          : { ...(shape.connector ?? {}), mode: 'auto' },
      };
    });
  }

  return next;
}
