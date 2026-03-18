import type {
  AnnotationAsset,
  AnnotationSession,
  AnnotationSessionExportV2,
  AnnotationShape,
  AnnotationBundle,
  AnnotationStep,
  SurfaceResource,
} from './types.js';

type W3CAnnotation = {
  '@context': string;
  id: string;
  type: 'Annotation';
  motivation: string;
  body: W3CBody[];
  target: W3CTarget;
};

type W3CBody = {
  type: 'TextualBody';
  value: string;
  purpose: string;
};

type W3CTarget = {
  source: string;
  selector: W3CSelector;
};

type W3CSelector = {
  type: 'SvgSelector';
  value: string;
};

type W3CAnnotationCollection = {
  '@context': string;
  type: 'AnnotationCollection';
  label: string;
  total: number;
  items: W3CAnnotation[];
  metadata: {
    capturedAt: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
    surface?: {
      sourceUrl: string;
      resolvedUrl: string;
      surface: string;
      adapter: string;
      access: 'editable' | 'read-only' | 'converted';
      isEditable: boolean;
      sessionId?: string | null;
      reason?: string;
      resourceKey?: string;
      title?: string;
      mimeType?: string;
      fingerprint?: string;
    };
  };
};

export type SessionSerializationInput = {
  session: AnnotationSession;
  resources: SurfaceResource[];
  steps: AnnotationStep[];
  annotationsByStep: Record<string, AnnotationShape[]>;
  assets?: AnnotationAsset[];
};

function shapeToSvg(shape: AnnotationShape): string {
  const stroke = shape.color;
  const sw = 2;
  const fill = 'none';

  switch (shape.type) {
    case 'circle':
      return `<svg><circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"/></svg>`;
    case 'rect':
      return `<svg><rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"/></svg>`;
    case 'arrow': {
      const dx = shape.to.x - shape.from.x;
      const dy = shape.to.y - shape.from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0)
        return `<svg><line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = Math.min(12, len * 0.3);
      const lx = shape.to.x - headLen * (ux + uy * 0.4);
      const ly = shape.to.y - headLen * (uy - ux * 0.4);
      const rx = shape.to.x - headLen * (ux - uy * 0.4);
      const ry = shape.to.y - headLen * (uy + ux * 0.4);
      return `<svg><line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${stroke}" stroke-width="${sw}"/><polygon points="${shape.to.x},${shape.to.y} ${lx},${ly} ${rx},${ry}" fill="${stroke}"/></svg>`;
    }
    case 'line':
      return `<svg><line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
    case 'text':
      return `<svg><text x="${shape.x}" y="${shape.y}" fill="${stroke}" font-size="14">${escapeXml(shape.content)}</text></svg>`;
    case 'freehand': {
      if (shape.points.length < 2) return '<svg/>';
      const d = shape.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
        .join(' ');
      return `<svg><path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"/></svg>`;
    }
    case 'snapshot':
      return `<svg><rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}" stroke-dasharray="6 3"/></svg>`;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shapeToAnnotation(shape: AnnotationShape, sourceUrl: string): W3CAnnotation {
  const bodies: W3CBody[] = [];
  if (shape.note) {
    bodies.push({ type: 'TextualBody', value: shape.note, purpose: 'commenting' });
  }
  if (shape.type === 'text') {
    bodies.push({ type: 'TextualBody', value: shape.content, purpose: 'describing' });
  }

  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `urn:oneshot:annotation:${shape.id}`,
    type: 'Annotation',
    motivation: shape.note ? 'commenting' : 'highlighting',
    body: bodies,
    target: {
      source: sourceUrl,
      selector: {
        type: 'SvgSelector',
        value: shapeToSvg(shape),
      },
    },
  };
}

function sortSteps(session: AnnotationSession, steps: AnnotationStep[]): AnnotationStep[] {
  const order = new Map<string, number>();
  session.stepOrder.forEach((id, idx) => order.set(id, idx));
  return [...steps].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

function summarizeStepAnnotations(shapes: AnnotationShape[]): string {
  if (shapes.length === 0) return 'No annotations in this step.';
  const counters: Record<string, number> = {};
  for (const shape of shapes) {
    counters[shape.type] = (counters[shape.type] ?? 0) + 1;
  }
  const parts = Object.entries(counters)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, count]) => `${count} ${type}`);

  const notes = shapes
    .flatMap((shape) => {
      if (shape.type === 'text') {
        const value = shape.content.trim();
        return value ? [value] : [];
      }
      const note = shape.note?.trim();
      return note ? [note] : [];
    })
    .filter(Boolean)
    .slice(0, 2)
    .map((value) => `"${value.slice(0, 80)}${value.length > 80 ? '...' : ''}"`);

  if (notes.length === 0) {
    return `${shapes.length} annotations (${parts.join(', ')}).`;
  }
  return `${shapes.length} annotations (${parts.join(', ')}). Notes: ${notes.join('; ')}.`;
}

export function serializeSessionV2(input: SessionSerializationInput): AnnotationSessionExportV2 {
  const orderedSteps = sortSteps(input.session, input.steps);
  const resourceById = new Map(input.resources.map((resource) => [resource.id, resource]));

  const assets = [...(input.assets ?? [])];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const flattenedAnnotations: AnnotationShape[] = [];
  const stepSummaries: AnnotationSessionExportV2['narrative']['stepSummaries'] = [];
  const resourceSummaryMap = new Map<string, string[]>();

  for (const step of orderedSteps) {
    const stepAnnotations = input.annotationsByStep[step.id] ?? [];
    const normalizedStepShapes = stepAnnotations.map((shape) => {
      const baseShape: AnnotationShape = {
        ...shape,
        stepId: shape.stepId ?? step.id,
        resourceId: shape.resourceId ?? step.resourceId,
      };

      if (baseShape.type !== 'snapshot') {
        return baseShape;
      }

      const assetId = baseShape.assetId ?? `asset_${baseShape.id}`;
      if (baseShape.imageDataUrl && !assetById.has(assetId)) {
        const asset: AnnotationAsset = {
          id: assetId,
          kind: 'snapshot',
          mimeType: 'image/png',
          uri: baseShape.imageDataUrl,
          createdAt: new Date().toISOString(),
        };
        assets.push(asset);
        assetById.set(assetId, asset);
      }

      return {
        ...baseShape,
        assetId,
        imageDataUrl: null,
      };
    });

    flattenedAnnotations.push(...normalizedStepShapes);

    const stepSummary = summarizeStepAnnotations(normalizedStepShapes);
    stepSummaries.push({
      stepId: step.id,
      resourceId: step.resourceId,
      summary: stepSummary,
    });

    const resourceSummaries = resourceSummaryMap.get(step.resourceId) ?? [];
    resourceSummaries.push(stepSummary);
    resourceSummaryMap.set(step.resourceId, resourceSummaries);
  }

  const resourceSummaries: AnnotationSessionExportV2['narrative']['resourceSummaries'] = [];
  for (const resourceId of input.session.resourceOrder) {
    const resource = resourceById.get(resourceId);
    if (!resource) continue;
    const summaries = resourceSummaryMap.get(resourceId) ?? [];
    const summary = summaries.length > 0
      ? summaries.join(' ')
      : `No annotations captured for ${resource.sourceUrl}.`;
    resourceSummaries.push({ resourceId, summary });
  }

  return {
    schemaVersion: '2.0',
    exportedAt: new Date().toISOString(),
    session: input.session,
    resources: input.resources,
    steps: orderedSteps,
    annotations: flattenedAnnotations,
    assets,
    narrative: {
      stepSummaries,
      resourceSummaries,
    },
  };
}

export function serializeToW3C(bundle: AnnotationBundle): W3CAnnotationCollection {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'AnnotationCollection',
    label: `Annotations for ${bundle.url}`,
    total: bundle.annotations.length,
    items: bundle.annotations.map((shape) => shapeToAnnotation(shape, bundle.url)),
    metadata: {
      capturedAt: bundle.capturedAt,
      viewport: bundle.viewport,
      surface: bundle.surface,
    },
  };
}

export function serializeToSimple(bundle: AnnotationBundle): AnnotationBundle {
  return bundle;
}
