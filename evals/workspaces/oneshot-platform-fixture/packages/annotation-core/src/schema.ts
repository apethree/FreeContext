import { z } from 'zod';

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const surfaceAnchorSchema = z.object({
  pageIndex: z.number().int().min(0).optional(),
  fragment: z.string().optional(),
  zoom: z.number().positive().optional(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  scrollOffset: pointSchema.optional(),
});

const baseSchema = z.object({
  id: z.string().min(1),
  color: z.string().min(1),
  note: z.string().optional(),
  resourceId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  surfaceAnchor: surfaceAnchorSchema.optional(),
});

export const circleSchema = baseSchema.extend({
  type: z.literal('circle'),
  cx: z.number(),
  cy: z.number(),
  r: z.number().positive(),
});

export const rectSchema = baseSchema.extend({
  type: z.literal('rect'),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const arrowSchema = baseSchema.extend({
  type: z.literal('arrow'),
  from: pointSchema,
  to: pointSchema,
});

export const lineSchema = baseSchema.extend({
  type: z.literal('line'),
  from: pointSchema,
  to: pointSchema,
});

export const textSchema = baseSchema.extend({
  type: z.literal('text'),
  x: z.number(),
  y: z.number(),
  content: z.string(),
  parentId: z.string().optional(),
  labelMode: z.enum(['auto', 'manual']).optional(),
  connector: z.object({
    mode: z.enum(['auto', 'manual']).optional(),
    bend: z.number().optional(),
  }).optional(),
});

export const freehandSchema = baseSchema.extend({
  type: z.literal('freehand'),
  points: z.array(pointSchema).min(2),
  strokeWidth: z.number().positive().optional(),
  lineStyle: z.enum(['solid', 'dashed']).optional(),
});

export const snapshotSchema = baseSchema.extend({
  type: z.literal('snapshot'),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  originX: z.number(),
  originY: z.number(),
  imageDataUrl: z.string().nullable(),
  assetId: z.string().optional(),
  label: z.string().optional(),
});

export const annotationShapeSchema = z.discriminatedUnion('type', [
  circleSchema,
  rectSchema,
  arrowSchema,
  lineSchema,
  textSchema,
  freehandSchema,
  snapshotSchema,
]);

export const viewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  devicePixelRatio: z.number().positive(),
});

export const surfaceDescriptorSchema = z.object({
  sourceUrl: z.string().min(1),
  resolvedUrl: z.string().min(1),
  surface: z.string().min(1),
  adapter: z.string().min(1),
  access: z.enum(['editable', 'read-only', 'converted']),
  isEditable: z.boolean(),
  sessionId: z.string().nullable().optional(),
  reason: z.string().optional(),
  resourceKey: z.string().optional(),
  title: z.string().optional(),
  mimeType: z.string().optional(),
  fingerprint: z.string().optional(),
});

export const annotationBundleSchema = z.object({
  url: z.string().url(),
  capturedAt: z.string(),
  viewport: viewportSchema,
  annotations: z.array(annotationShapeSchema),
  surface: surfaceDescriptorSchema.optional(),
});

export const annotationSessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  mode: z.enum(['multi-resource', 'single-resource']),
  activeStepId: z.string().nullable(),
  resourceOrder: z.array(z.string().min(1)),
  stepOrder: z.array(z.string().min(1)),
});

export const surfaceResourceSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  surface: z.string().min(1),
  adapter: z.string().min(1),
  sourceUrl: z.string().min(1),
  resolvedUrl: z.string().min(1),
  title: z.string().optional(),
  mimeType: z.string().optional(),
  fingerprint: z.string().optional(),
  editable: z.boolean(),
  access: z.enum(['editable', 'read-only', 'converted']),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  revision: z.number().int().min(0),
});

export const annotationStepSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  index: z.number().int().min(0),
  title: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  viewport: viewportSchema.optional(),
  scroll: pointSchema.optional(),
  zoom: z.number().positive().optional(),
  fragment: z.string().optional(),
  annotationIds: z.array(z.string().min(1)),
  previewAssetId: z.string().optional(),
});

export const annotationAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['snapshot', 'thumbnail', 'screenshot', 'attachment']),
  mimeType: z.string().min(1),
  uri: z.string().min(1),
  sha256: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  createdAt: z.string(),
});

export const sessionStepNarrativeSchema = z.object({
  stepId: z.string().min(1),
  resourceId: z.string().min(1),
  summary: z.string(),
});

export const sessionResourceNarrativeSchema = z.object({
  resourceId: z.string().min(1),
  summary: z.string(),
});

export const annotationSessionExportV2Schema = z.object({
  schemaVersion: z.literal('2.0'),
  exportedAt: z.string(),
  session: annotationSessionSchema,
  resources: z.array(surfaceResourceSchema),
  steps: z.array(annotationStepSchema),
  annotations: z.array(annotationShapeSchema),
  assets: z.array(annotationAssetSchema),
  narrative: z.object({
    stepSummaries: z.array(sessionStepNarrativeSchema),
    resourceSummaries: z.array(sessionResourceNarrativeSchema),
  }),
});
