export type Point = {
  x: number;
  y: number;
};

export type NormalizedPoint = {
  xNorm: number;
  yNorm: number;
};

export type SurfaceAnchor = {
  pageIndex?: number;
  fragment?: string;
  zoom?: number;
  scrollX?: number;
  scrollY?: number;
  // Backward compatible field used by previous payload versions.
  scrollOffset?: Point;
};

export type AnnotationShapeBase = {
  id: string;
  color: string;
  note?: string;
  resourceId?: string;
  stepId?: string;
  surfaceAnchor?: SurfaceAnchor;
};

export type CircleShape = AnnotationShapeBase & {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
};

export type RectShape = AnnotationShapeBase & {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ArrowShape = AnnotationShapeBase & {
  type: 'arrow';
  from: Point;
  to: Point;
};

export type LineShape = AnnotationShapeBase & {
  type: 'line';
  from: Point;
  to: Point;
};

export type TextShape = AnnotationShapeBase & {
  type: 'text';
  x: number;
  y: number;
  content: string;
  parentId?: string;
  labelMode?: 'auto' | 'manual';
  connector?: {
    mode?: 'auto' | 'manual';
    bend?: number;
  };
};

export type FreehandShape = AnnotationShapeBase & {
  type: 'freehand';
  points: Point[];
  strokeWidth?: number;
  lineStyle?: 'solid' | 'dashed';
};

export type SnapshotShape = AnnotationShapeBase & {
  type: 'snapshot';
  x: number;
  y: number;
  w: number;
  h: number;
  originX: number;
  originY: number;
  imageDataUrl: string | null;
  assetId?: string;
  label?: string;
};

export type AnnotationShape =
  | CircleShape
  | RectShape
  | ArrowShape
  | LineShape
  | TextShape
  | FreehandShape
  | SnapshotShape;

export type AnnotationToolType = AnnotationShape['type'] | 'select' | 'grab' | 'eraser' | 'lasso';

export type Viewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
};

export type SurfaceAccessMode = 'editable' | 'read-only' | 'converted';

export type SurfaceDescriptor = {
  sourceUrl: string;
  resolvedUrl: string;
  surface: string;
  adapter: string;
  access: SurfaceAccessMode;
  isEditable: boolean;
  sessionId?: string | null;
  reason?: string;
  resourceKey?: string;
  title?: string;
  mimeType?: string;
  fingerprint?: string;
};

export type AnnotationBundle = {
  url: string;
  capturedAt: string;
  viewport: Viewport;
  annotations: AnnotationShape[];
  surface?: SurfaceDescriptor;
};

export type AnnotationSessionMode = 'multi-resource' | 'single-resource';

export type AnnotationSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: AnnotationSessionMode;
  activeStepId: string | null;
  resourceOrder: string[];
  stepOrder: string[];
};

export type SurfaceResource = {
  id: string;
  key: string;
  surface: string;
  adapter: string;
  sourceUrl: string;
  resolvedUrl: string;
  title?: string;
  mimeType?: string;
  fingerprint?: string;
  editable: boolean;
  access: SurfaceAccessMode;
  createdAt: string;
  lastSeenAt: string;
  revision: number;
};

export type AnnotationStep = {
  id: string;
  resourceId: string;
  index: number;
  title?: string;
  startedAt: string;
  endedAt?: string;
  viewport?: Viewport;
  scroll?: Point;
  zoom?: number;
  fragment?: string;
  annotationIds: string[];
  previewAssetId?: string;
};

export type AnnotationAssetKind = 'snapshot' | 'thumbnail' | 'screenshot' | 'attachment';

export type AnnotationAsset = {
  id: string;
  kind: AnnotationAssetKind;
  mimeType: string;
  uri: string;
  sha256?: string;
  width?: number;
  height?: number;
  createdAt: string;
};

export type SessionStepNarrative = {
  stepId: string;
  resourceId: string;
  summary: string;
};

export type SessionResourceNarrative = {
  resourceId: string;
  summary: string;
};

export type AnnotationSessionExportV2 = {
  schemaVersion: '2.0';
  exportedAt: string;
  session: AnnotationSession;
  resources: SurfaceResource[];
  steps: AnnotationStep[];
  annotations: AnnotationShape[];
  assets: AnnotationAsset[];
  narrative: {
    stepSummaries: SessionStepNarrative[];
    resourceSummaries: SessionResourceNarrative[];
  };
};

export const ANNOTATION_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
] as const;

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[4]; // blue
