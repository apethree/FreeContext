export type {
  Point,
  NormalizedPoint,
  SurfaceAnchor,
  AnnotationShapeBase,
  CircleShape,
  RectShape,
  ArrowShape,
  LineShape,
  TextShape,
  FreehandShape,
  SnapshotShape,
  AnnotationShape,
  AnnotationToolType,
  Viewport,
  SurfaceAccessMode,
  SurfaceDescriptor,
  AnnotationBundle,
  AnnotationSessionMode,
  AnnotationSession,
  SurfaceResource,
  AnnotationStep,
  AnnotationAssetKind,
  AnnotationAsset,
  SessionStepNarrative,
  SessionResourceNarrative,
  AnnotationSessionExportV2,
} from './types.js';

export { ANNOTATION_COLORS, DEFAULT_ANNOTATION_COLOR } from './types.js';

export {
  annotationShapeSchema,
  annotationBundleSchema,
  viewportSchema,
  surfaceDescriptorSchema,
  annotationSessionSchema,
  surfaceResourceSchema,
  annotationStepSchema,
  annotationAssetSchema,
  sessionStepNarrativeSchema,
  sessionResourceNarrativeSchema,
  annotationSessionExportV2Schema,
  circleSchema,
  rectSchema,
  arrowSchema,
  lineSchema,
  textSchema,
  freehandSchema,
  snapshotSchema,
} from './schema.js';

export {
  normalizePoint,
  denormalizePoint,
  normalizeShape,
  denormalizeShape,
} from './normalize.js';

export {
  serializeSessionV2,
  serializeToW3C,
  serializeToSimple,
} from './serialize.js';

export type { SessionSerializationInput } from './serialize.js';

export { renderAnnotationsSvg } from './composite.js';

export {
  getShapeConnectorAnchor,
  getTextConnectorLaneOffset,
  buildCurvedConnector,
} from './connector.js';

export {
  estimateConnectedLabelMetrics,
  getTextShapeRect,
  getShapeBounds,
  buildAnnotationObstacleRects,
  placeConnectedLabel,
  relayoutConnectedLabels,
} from './label-layout.js';

export type {
  BrowserSurfaceKind,
  BrowserTargetAdapter,
  ResolvedBrowserTarget,
  BrowserTargetResolution,
} from './browser-target.js';
export {
  classifyBrowserSurface,
  describeBrowserSurface,
  resolveBrowserTarget,
} from './browser-target.js';
