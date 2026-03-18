import type { AnnotationShape, Point, TextShape } from './types.js';
import {
  buildAnnotationObstacleRects,
  estimateConnectedLabelMetrics,
  type Rect,
} from './label-layout.js';

export type CurvedConnector = {
  from: Point;
  to: Point;
  cp1: Point;
  cp2: Point;
  path: string;
  curvature: number;
  laneOffset: number;
  bend: number;
  direction: Point;
  normal: Point;
};

type BoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 0.0001) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  );
}

function cubicBezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function curveObstacleHits(args: {
  from: Point;
  cp1: Point;
  cp2: Point;
  to: Point;
  obstacles: Rect[];
}): number {
  const { from, cp1, cp2, to, obstacles } = args;
  if (obstacles.length === 0) return 0;
  let hits = 0;
  const samples = 22;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = cubicBezierPoint(t, from, cp1, cp2, to);
    for (const obstacle of obstacles) {
      if (pointInRect(point, obstacle)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function nearestPointOnSegment(a: Point, b: Point, p: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 0.0001) return a;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };
}

function nearestRectEdgeMidpoint(
  rect: BoundingBox,
  target: Point,
): Point {
  const candidates: Point[] = [
    { x: rect.x, y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w / 2, y: rect.y },
    { x: rect.x + rect.w / 2, y: rect.y + rect.h },
  ];
  let best = candidates[0];
  let bestDist = distance(best, target);
  for (let i = 1; i < candidates.length; i += 1) {
    const d = distance(candidates[i], target);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return best;
}

function nearestPointOnFreehand(shape: Extract<AnnotationShape, { type: 'freehand' }>, target: Point): Point {
  if (shape.points.length === 0) return { x: 0, y: 0 };
  if (shape.points.length === 1) return shape.points[0];

  let best = shape.points[0];
  let bestDist = distance(best, target);
  for (let i = 1; i < shape.points.length; i += 1) {
    const candidate = nearestPointOnSegment(shape.points[i - 1], shape.points[i], target);
    const d = distance(candidate, target);
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return best;
}

function getTextBoundingBox(shape: Extract<AnnotationShape, { type: 'text' }>): BoundingBox {
  // Both connected and standalone text labels use chip metrics for consistent bounding box.
  const metrics = estimateConnectedLabelMetrics(shape.content || ' ');
  return {
    x: shape.x - metrics.paddingX,
    y: shape.y - metrics.baselineY,
    w: metrics.width,
    h: metrics.height,
  };
}

function getShapeBoundingBox(shape: AnnotationShape): BoundingBox {
  switch (shape.type) {
    case 'circle':
      return {
        x: shape.cx - shape.r,
        y: shape.cy - shape.r,
        w: shape.r * 2,
        h: shape.r * 2,
      };
    case 'rect':
    case 'snapshot':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'arrow':
    case 'line': {
      const x = Math.min(shape.from.x, shape.to.x);
      const y = Math.min(shape.from.y, shape.to.y);
      return {
        x,
        y,
        w: Math.abs(shape.to.x - shape.from.x),
        h: Math.abs(shape.to.y - shape.from.y),
      };
    }
    case 'freehand': {
      if (shape.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of shape.points) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text':
      return getTextBoundingBox(shape);
  }
}

function getEdgeExitVector(bbox: BoundingBox, anchor: Point): Point {
  const dLeft = Math.abs(anchor.x - bbox.x);
  const dRight = Math.abs(bbox.x + bbox.w - anchor.x);
  const dTop = Math.abs(anchor.y - bbox.y);
  const dBottom = Math.abs(bbox.y + bbox.h - anchor.y);
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { x: -1, y: 0 };
  if (min === dRight) return { x: 1, y: 0 };
  if (min === dTop) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export function getShapeConnectorAnchor(shape: AnnotationShape, target: Point): Point {
  switch (shape.type) {
    case 'circle': {
      const dir = normalize({ x: target.x - shape.cx, y: target.y - shape.cy });
      return {
        x: shape.cx + dir.x * shape.r,
        y: shape.cy + dir.y * shape.r,
      };
    }
    case 'rect':
      return nearestRectEdgeMidpoint(shape, target);
    case 'snapshot':
      return nearestRectEdgeMidpoint(shape, target);
    case 'arrow':
    case 'line':
      return nearestPointOnSegment(shape.from, shape.to, target);
    case 'freehand':
      return nearestPointOnFreehand(shape, target);
    case 'text': {
      return nearestRectEdgeMidpoint(getTextBoundingBox(shape), target);
    }
  }
}

export function getTextConnectorLaneOffset(
  text: TextShape,
  annotations: AnnotationShape[],
  laneSpacing = 10,
): number {
  if (!text.parentId) return 0;
  const siblings = annotations.filter(
    (shape): shape is TextShape => shape.type === 'text' && shape.parentId === text.parentId,
  );
  if (siblings.length <= 1) return 0;
  const index = siblings.findIndex((sibling) => sibling.id === text.id);
  if (index < 0) return 0;
  return (index - (siblings.length - 1) / 2) * laneSpacing;
}

export function buildCurvedConnector(args: {
  parent: AnnotationShape;
  text: TextShape;
  annotations: AnnotationShape[];
  curvatureMin?: number;
  curvatureMax?: number;
  laneSpacing?: number;
  obstacles?: Rect[];
  obstaclePadding?: number;
}): CurvedConnector {
  const {
    parent,
    text,
    annotations,
    curvatureMin = 24,
    curvatureMax = 96,
    laneSpacing = 10,
    obstacles,
    obstaclePadding = 6,
  } = args;
  const roughTextPoint: Point = { x: text.x, y: text.y };
  const from = getShapeConnectorAnchor(parent, roughTextPoint);
  const to: Point = text.parentId
    ? (() => {
        const textRect = getTextBoundingBox(text);
        return nearestRectEdgeMidpoint(textRect, from);
      })()
    : roughTextPoint;
  const laneOffset = getTextConnectorLaneOffset(text, annotations, laneSpacing);

  const dir = normalize({ x: to.x - from.x, y: to.y - from.y });
  const normal: Point = { x: -dir.y, y: dir.x };
  const connectorLength = distance(from, to);
  const curvature = clamp(connectorLength * 0.35, curvatureMin, curvatureMax);
  const autoBend = clamp(connectorLength * 0.22, 18, 56);
  const laneNudge = { x: normal.x * laneOffset, y: normal.y * laneOffset };
  const parentBbox = getShapeBoundingBox(parent);
  const textBbox = getShapeBoundingBox(text);
  const exitVec = getEdgeExitVector(parentBbox, from);
  const entryVec = getEdgeExitVector(textBbox, to);

  const obstacleRects = obstacles ?? buildAnnotationObstacleRects(annotations, {
    excludeIds: new Set([parent.id, text.id]),
    padding: obstaclePadding,
  });

  const buildCandidate = (bend: number) => {
    const bendNudge = {
      x: normal.x * (bend - laneOffset),
      y: normal.y * (bend - laneOffset),
    };
    const cp1 = {
      x: from.x + exitVec.x * curvature + laneNudge.x + bendNudge.x,
      y: from.y + exitVec.y * curvature + laneNudge.y + bendNudge.y,
    };
    const cp2 = {
      x: to.x + entryVec.x * curvature + laneNudge.x + bendNudge.x,
      y: to.y + entryVec.y * curvature + laneNudge.y + bendNudge.y,
    };
    const path = [
      `M ${from.x.toFixed(1)} ${from.y.toFixed(1)}`,
      `C ${cp1.x.toFixed(1)} ${cp1.y.toFixed(1)} ${cp2.x.toFixed(1)} ${cp2.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    ].join(' ');
    const hitCount = curveObstacleHits({ from, cp1, cp2, to, obstacles: obstacleRects });
    return { bend, cp1, cp2, path, hitCount };
  };

  const preferredSign = to.y < from.y ? -1 : 1;
  const preferredBend = laneOffset + autoBend * preferredSign;
  const oppositeBend = laneOffset - autoBend * preferredSign;

  const explicitBend = text.connector?.bend;
  const selected =
    typeof explicitBend === 'number'
      ? buildCandidate(explicitBend)
      : (() => {
          const candidateBends = [
            preferredBend,
            oppositeBend,
            laneOffset + autoBend * preferredSign * 1.8,
            laneOffset - autoBend * preferredSign * 1.8,
            laneOffset + autoBend * preferredSign * 3.2,
            laneOffset - autoBend * preferredSign * 3.2,
          ];
          const evaluated = candidateBends.map(buildCandidate);
          const minHits = Math.min(...evaluated.map((candidate) => candidate.hitCount));
          const ranked = evaluated
            .filter((candidate) => candidate.hitCount === minHits)
            .sort((a, b) => Math.abs(a.bend - preferredBend) - Math.abs(b.bend - preferredBend));
          return ranked[0] ?? evaluated[0];
        })();

  return {
    from,
    to,
    cp1: selected.cp1,
    cp2: selected.cp2,
    path: selected.path,
    curvature,
    laneOffset,
    bend: selected.bend,
    direction: dir,
    normal,
  };
}
