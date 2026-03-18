import React, { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { cn } from '@/lib/utils';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { AnnotationOverlay } from './AnnotationOverlay';
import { AnnotationToolbar } from './AnnotationToolbar';
import { AnnotationModeToggle } from './AnnotationModeToggle';
import { ReviewPanel } from './ReviewPanel';
import { useAnnotationExport } from './useAnnotationExport';
import { useAnnotationSTT } from './useAnnotationSTT';
import {
  describeBrowserSurface,
  resolveBrowserTarget,
  type BrowserSurfaceKind,
  type BrowserTargetAdapter,
} from '@oneshot/annotation-core';
import { placeConnectedLabel } from '@oneshot/annotation-core/label-layout';
import {
  ghostLayerAnnotatingAtom,
  ghostLayerActiveToolAtom,
  ghostLayerAnnotationsAtom,
  ghostLayerActiveColorAtom,
  ghostLayerSelectedShapeIdAtom,
  ghostLayerUndoStackAtom,
  ghostLayerRedoStackAtom,
  ghostLayerAutoMicAtom,
  ghostLayerStopPhraseAtom,
  ghostLayerSessionAtom,
  ghostLayerResourcesAtom,
  ghostLayerStepsAtom,
  ghostLayerAnnotationsByStepAtom,
  ghostLayerAssetsAtom,
  ghostLayerModeAtom,
  ghostLayerActiveStepIdAtom,
  ghostLayerUndoStacksByStepAtom,
  ghostLayerRedoStacksByStepAtom,
  ghostLayerEditingNoteIdAtom,
  ghostLayerResetSessionAtom,
} from './annotation-state';
import type {
  AnnotationAsset,
  AnnotationSessionMode,
  AnnotationStep,
  AnnotationToolType,
  Point,
  SnapshotShape,
  SurfaceAccessMode,
  SurfaceDescriptor,
  SurfaceResource,
  Viewport,
} from '@oneshot/annotation-core/types';
import {
  classifySurfaceUrl,
  computeCanonicalResourceKey,
  resolveSurfaceTarget,
} from './surface-adapters';

type WebviewNavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  currentUrl: string;
  sourceUrl: string;
  surface: BrowserSurfaceKind;
  adapter: BrowserTargetAdapter;
  access: SurfaceAccessMode;
  isEditable: boolean;
  sessionId: string | null;
  title: string;
  loadError: string | null;
};

function defaultAccess(surface: BrowserSurfaceKind, adapter: BrowserTargetAdapter): SurfaceAccessMode {
  if (adapter === 'office-local-preview') return 'converted';
  if (surface === 'office' || adapter === 'office-web-viewer') return 'read-only';
  return 'editable';
}

function buildDefaultSurface(): SurfaceDescriptor {
  const resolved = resolveBrowserTarget('https://example.com');
  if (resolved.ok) {
    const value = resolved.value;
    const access = defaultAccess(value.surface, value.adapter);
    const descriptor: SurfaceDescriptor = {
      sourceUrl: value.canonicalUrl,
      resolvedUrl: value.resolvedUrl,
      surface: value.surface,
      adapter: value.adapter,
      access,
      isEditable: access === 'editable',
      sessionId: null,
    };
    descriptor.resourceKey = computeCanonicalResourceKey(descriptor);
    return descriptor;
  }
  const fallback: SurfaceDescriptor = {
    sourceUrl: 'https://example.com/',
    resolvedUrl: 'https://example.com/',
    surface: 'web',
    adapter: 'none',
    access: 'editable',
    isEditable: true,
    sessionId: null,
  };
  fallback.resourceKey = computeCanonicalResourceKey(fallback);
  return fallback;
}

const DEFAULT_SURFACE = buildDefaultSurface();

function extractFragment(sourceUrl: string): string | undefined {
  try {
    const parsed = new URL(sourceUrl);
    const fragment = parsed.hash.replace(/^#/, '').trim();
    return fragment || undefined;
  } catch {
    return undefined;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getResourceTitle(sourceUrl: string, fallbackSurface: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname || fallbackSurface;
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${host}${path}`;
  } catch {
    return sourceUrl || fallbackSurface;
  }
}

export function GhostLayerPage() {
  const [inputUrl, setInputUrl] = useState(DEFAULT_SURFACE.sourceUrl);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_SURFACE.resolvedUrl);
  const [surfaceDescriptor, setSurfaceDescriptor] = useState<SurfaceDescriptor>(DEFAULT_SURFACE);
  const [webviewNode, setWebviewNode] = useState<Electron.WebviewTag | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [surfaceAdaptersV2Enabled, setSurfaceAdaptersV2Enabled] = useState(true);
  const [officeEditingEnabled, setOfficeEditingEnabled] = useState(true);
  const [docStatusMessage, setDocStatusMessage] = useState<string | null>(null);

  // Dock V3 state
  const [isDockCollapsed, setIsDockCollapsed] = useState(true);
  const [activeDockPanel, setActiveDockPanel] = useState<'none' | 'settings' | 'share'>('none');
  const [dockOffset, setDockOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dockDragRef = useRef<{ startPointer: { x: number; y: number }; startOffset: { x: number; y: number } } | null>(null);
  const [modeToggleOffset, setModeToggleOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isModeToggleDragging, setIsModeToggleDragging] = useState(false);
  const [isModeToggleCollapsed, setIsModeToggleCollapsed] = useState(false);
  const modeToggleDragRef = useRef<{ startPointer: { x: number; y: number }; startOffset: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const modeToggleRef = useRef<HTMLDivElement>(null);
  const [isAnnotating, setIsAnnotating] = useAtom(ghostLayerAnnotatingAtom);
  const [activeTool, setActiveTool] = useAtom(ghostLayerActiveToolAtom);
  const [annotations, setAnnotations] = useAtom(ghostLayerAnnotationsAtom);
  const activeColor = useAtomValue(ghostLayerActiveColorAtom);
  const [, setSelectedId] = useAtom(ghostLayerSelectedShapeIdAtom);
  const [autoMic, setAutoMic] = useAtom(ghostLayerAutoMicAtom);
  const [stopPhrase, setStopPhrase] = useAtom(ghostLayerStopPhraseAtom);
  const [, setUndoStack] = useAtom(ghostLayerUndoStackAtom);
  const [, setRedoStack] = useAtom(ghostLayerRedoStackAtom);
  const [, setEditingNoteId] = useAtom(ghostLayerEditingNoteIdAtom);

  const [session, setSession] = useAtom(ghostLayerSessionAtom);
  const [mode, setMode] = useAtom(ghostLayerModeAtom);
  const [resources, setResources] = useAtom(ghostLayerResourcesAtom);
  const [steps, setSteps] = useAtom(ghostLayerStepsAtom);
  const [annotationsByStep, setAnnotationsByStep] = useAtom(ghostLayerAnnotationsByStepAtom);
  const [, setAssets] = useAtom(ghostLayerAssetsAtom);
  const [activeStepId, setActiveStepId] = useAtom(ghostLayerActiveStepIdAtom);
  const [, setUndoStacksByStep] = useAtom(ghostLayerUndoStacksByStepAtom);
  const [, setRedoStacksByStep] = useAtom(ghostLayerRedoStacksByStepAtom);
  const [, resetSession] = useAtom(ghostLayerResetSessionAtom);

  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const activeSessionIdRef = useRef<string | null>(DEFAULT_SURFACE.sessionId ?? null);
  const initializedContextRef = useRef(false);

  const [navState, setNavState] = useState<WebviewNavigationState>({
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    currentUrl: DEFAULT_SURFACE.resolvedUrl,
    sourceUrl: DEFAULT_SURFACE.sourceUrl,
    surface: DEFAULT_SURFACE.surface as BrowserSurfaceKind,
    adapter: DEFAULT_SURFACE.adapter as BrowserTargetAdapter,
    access: DEFAULT_SURFACE.access,
    isEditable: DEFAULT_SURFACE.isEditable,
    sessionId: DEFAULT_SURFACE.sessionId ?? null,
    title: 'Ghost Layer',
    loadError: null,
  });

  const viewport: Viewport = useMemo(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }), []);

  const activeStep = useMemo(
    () => steps.find((step) => step.id === activeStepId) ?? null,
    [steps, activeStepId],
  );

  const activeResource = useMemo(
    () => resources.find((resource) => resource.id === activeStep?.resourceId) ?? null,
    [resources, activeStep?.resourceId],
  );

  const { exportAsSessionV2, exportToChat } = useAnnotationExport();

  const {
    isRecording,
    isTextDictating,
    dictatingTextId,
    transcript,
    sttState,
    sttErrorDetail,
    startRecording,
    stopRecording,
    startTextDictation,
    startTextShapeDictation,
  } = useAnnotationSTT();

  // Auto-mic callback: create text shape and start dictation
  const onAutoMicStart = useCallback(
    (position: Point, parentId?: string) => {
      void startTextDictation(position, parentId);
    },
    [startTextDictation],
  );

  const onTextMicStart = useCallback(
    (textId: string) => {
      if (isRecording && dictatingTextId === textId) {
        void stopRecording();
        return;
      }
      void startTextShapeDictation(textId);
    },
    [dictatingTextId, isRecording, startTextShapeDictation, stopRecording],
  );

  const generateId = useCallback(
    () => `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-49), annotations]);
    setRedoStack([]);
  }, [annotations, setUndoStack, setRedoStack]);

  const initializeSessionForSurface = useCallback((descriptor: SurfaceDescriptor) => {
    const now = new Date().toISOString();
    const resourceId = createId('res');
    const stepId = createId('step');
    const resource: SurfaceResource = {
      id: resourceId,
      key: descriptor.resourceKey || computeCanonicalResourceKey(descriptor),
      surface: descriptor.surface,
      adapter: descriptor.adapter,
      sourceUrl: descriptor.sourceUrl,
      resolvedUrl: descriptor.resolvedUrl,
      title: descriptor.title || getResourceTitle(descriptor.sourceUrl, descriptor.surface),
      mimeType: descriptor.mimeType,
      fingerprint: descriptor.fingerprint,
      editable: descriptor.isEditable,
      access: descriptor.access,
      createdAt: now,
      lastSeenAt: now,
      revision: 0,
    };
    const step: AnnotationStep = {
      id: stepId,
      resourceId,
      index: 0,
      title: `Step 1`,
      startedAt: now,
      viewport,
      scroll: { x: 0, y: 0 },
      zoom: 1,
      fragment: extractFragment(descriptor.sourceUrl),
      annotationIds: [],
    };

    setResources([resource]);
    setSteps([step]);
    setAnnotationsByStep({ [stepId]: [] });
    setAssets([]);
    setUndoStacksByStep({ [stepId]: [] });
    setRedoStacksByStep({ [stepId]: [] });
    setSelectedId(null);
    setEditingNoteId(null);
    setActiveStepId(stepId);
    setSession((prev) => ({
      ...prev,
      mode,
      activeStepId: stepId,
      resourceOrder: [resourceId],
      stepOrder: [stepId],
      updatedAt: now,
      createdAt: prev.resourceOrder.length === 0 ? now : prev.createdAt,
    }));
    return { resourceId, stepId };
  }, [mode, setResources, setSteps, setAnnotationsByStep, setAssets, setUndoStacksByStep, setRedoStacksByStep, setSelectedId, setEditingNoteId, setActiveStepId, setSession, viewport]);

  const syncSurfaceContext = useCallback((descriptor: SurfaceDescriptor, options?: { preferredStepId?: string | null }) => {
    const resourceKey = descriptor.resourceKey || computeCanonicalResourceKey(descriptor);
    const now = new Date().toISOString();

    if (mode === 'single-resource') {
      const sameResource = activeResource?.key === resourceKey;
      if (sameResource && activeStepId) {
        setResources((prev) => prev.map((resource) => (
          resource.id === activeResource.id
            ? {
                ...resource,
                sourceUrl: descriptor.sourceUrl,
                resolvedUrl: descriptor.resolvedUrl,
                surface: descriptor.surface,
                adapter: descriptor.adapter,
                access: descriptor.access,
                editable: descriptor.isEditable,
                fingerprint: descriptor.fingerprint ?? resource.fingerprint,
                mimeType: descriptor.mimeType ?? resource.mimeType,
                title: descriptor.title ?? resource.title,
                lastSeenAt: now,
              }
            : resource
        )));
        setSession((prev) => ({
          ...prev,
          updatedAt: now,
        }));
        return;
      }

      initializeSessionForSurface(descriptor);
      return;
    }

    const currentResources = [...resources];
    const currentSteps = [...steps];
    const currentByStep = { ...annotationsByStep };
    const currentResourceOrder = [...session.resourceOrder];
    const currentStepOrder = [...session.stepOrder];

    let resource = currentResources.find((item) => item.key === resourceKey) ?? null;
    if (!resource) {
      const resourceId = createId('res');
      resource = {
        id: resourceId,
        key: resourceKey,
        surface: descriptor.surface,
        adapter: descriptor.adapter,
        sourceUrl: descriptor.sourceUrl,
        resolvedUrl: descriptor.resolvedUrl,
        title: descriptor.title || getResourceTitle(descriptor.sourceUrl, descriptor.surface),
        mimeType: descriptor.mimeType,
        fingerprint: descriptor.fingerprint,
        editable: descriptor.isEditable,
        access: descriptor.access,
        createdAt: now,
        lastSeenAt: now,
        revision: 0,
      };
      currentResources.push(resource);
      currentResourceOrder.push(resource.id);
    } else {
      const fingerprintChanged = Boolean(
        descriptor.fingerprint
          && resource.fingerprint
          && descriptor.fingerprint !== resource.fingerprint,
      );
      resource = {
        ...resource,
        sourceUrl: descriptor.sourceUrl,
        resolvedUrl: descriptor.resolvedUrl,
        surface: descriptor.surface,
        adapter: descriptor.adapter,
        access: descriptor.access,
        editable: descriptor.isEditable,
        title: descriptor.title ?? resource.title,
        mimeType: descriptor.mimeType ?? resource.mimeType,
        fingerprint: descriptor.fingerprint ?? resource.fingerprint,
        lastSeenAt: now,
        revision: fingerprintChanged ? resource.revision + 1 : resource.revision,
      };
      const idx = currentResources.findIndex((item) => item.id === resource?.id);
      if (idx >= 0) {
        currentResources[idx] = resource;
      }
      if (!currentResourceOrder.includes(resource.id)) {
        currentResourceOrder.push(resource.id);
      }
    }

    if (!resource) {
      return;
    }

    const resourceSteps = currentSteps
      .filter((step) => step.resourceId === resource?.id)
      .sort((a, b) => a.index - b.index);

    let nextActiveStep = resourceSteps[resourceSteps.length - 1] ?? null;

    if (options?.preferredStepId) {
      const preferred = resourceSteps.find((step) => step.id === options.preferredStepId);
      if (preferred) {
        nextActiveStep = preferred;
      }
    }

    if (!nextActiveStep) {
      nextActiveStep = {
        id: createId('step'),
        resourceId: resource.id,
        index: currentStepOrder.length,
        title: `Step ${currentStepOrder.length + 1}`,
        startedAt: now,
        viewport,
        scroll: { x: 0, y: 0 },
        zoom: 1,
        fragment: extractFragment(descriptor.sourceUrl),
        annotationIds: [],
      };
      currentSteps.push(nextActiveStep);
      currentStepOrder.push(nextActiveStep.id);
      currentByStep[nextActiveStep.id] = [];
      setUndoStacksByStep((prev) => ({ ...prev, [nextActiveStep.id]: [] }));
      setRedoStacksByStep((prev) => ({ ...prev, [nextActiveStep.id]: [] }));
    } else if (!currentStepOrder.includes(nextActiveStep.id)) {
      currentStepOrder.push(nextActiveStep.id);
    }

    if (!currentByStep[nextActiveStep.id]) {
      currentByStep[nextActiveStep.id] = [];
    }

    setResources(currentResources);
    setSteps(currentSteps);
    setAnnotationsByStep(currentByStep);
    setSelectedId(null);
    setEditingNoteId(null);
    setActiveStepId(nextActiveStep.id);
    setSession((prev) => ({
      ...prev,
      mode,
      activeStepId: nextActiveStep.id,
      resourceOrder: currentResourceOrder,
      stepOrder: currentStepOrder,
      updatedAt: now,
    }));
  }, [mode, activeResource?.id, activeResource?.key, activeStepId, resources, steps, annotationsByStep, session.resourceOrder, session.stepOrder, initializeSessionForSurface, setResources, setSteps, setAnnotationsByStep, setUndoStacksByStep, setRedoStacksByStep, setSelectedId, setEditingNoteId, setActiveStepId, setSession, viewport]);

  const onLassoCapture = useCallback(
    async (bbox: { x: number; y: number; w: number; h: number }) => {
      if (bbox.w < 4 || bbox.h < 4) return;

      let imageDataUrl: string | null = null;
      try {
        if (webviewNode) {
          const withCapture = webviewNode as Electron.WebviewTag & {
            capturePage?: (rect?: Electron.Rectangle) => Promise<Electron.NativeImage>;
          };
          if (typeof withCapture.capturePage === 'function') {
            const nativeImage = await withCapture.capturePage({
              x: Math.round(bbox.x),
              y: Math.round(bbox.y),
              width: Math.max(1, Math.round(bbox.w)),
              height: Math.max(1, Math.round(bbox.h)),
            });
            imageDataUrl = nativeImage.toDataURL();
            if (imageDataUrl === 'data:image/png;base64,') imageDataUrl = null;
          }
        }
      } catch {
        imageDataUrl = null;
      }

      const id = generateId();
      const assetId = imageDataUrl ? `asset_${id}` : undefined;

      pushUndo();
      setAnnotations((prev) => {
        const snapshot: SnapshotShape = {
          type: 'snapshot',
          id,
          color: activeColor,
          x: bbox.x,
          y: bbox.y,
          w: bbox.w,
          h: bbox.h,
          originX: bbox.x,
          originY: bbox.y,
          imageDataUrl,
          ...(assetId ? { assetId } : {}),
        };
        return [...prev, snapshot];
      });

      if (assetId && imageDataUrl) {
        const nextAsset: AnnotationAsset = {
          id: assetId,
          kind: 'snapshot',
          mimeType: 'image/png',
          uri: imageDataUrl,
          createdAt: new Date().toISOString(),
        };
        setAssets((prev) => {
          if (prev.some((asset) => asset.id === nextAsset.id)) return prev;
          return [...prev, nextAsset];
        });
      }

      if (activeStepId && assetId) {
        setSteps((prev) => prev.map((step) => (
          step.id === activeStepId && !step.previewAssetId
            ? { ...step, previewAssetId: assetId }
            : step
        )));
      }

      setSelectedId(id);
      setActiveTool('select');
      if (autoMic) {
        const snapshotParent: SnapshotShape = {
          type: 'snapshot',
          id,
          color: activeColor,
          x: bbox.x,
          y: bbox.y,
          w: bbox.w,
          h: bbox.h,
          originX: bbox.x,
          originY: bbox.y,
          imageDataUrl,
          ...(assetId ? { assetId } : {}),
        };
        const placement = placeConnectedLabel({
          parent: snapshotParent,
          annotations: [...annotations, snapshotParent],
          content: '',
          viewport: { width: window.innerWidth, height: window.innerHeight },
          excludeIds: new Set([id]),
        });
        onAutoMicStart({ x: placement.x, y: placement.y }, id);
      }
    },
    [webviewNode, generateId, pushUndo, setAnnotations, activeColor, setAssets, activeStepId, setSteps, setSelectedId, setActiveTool, autoMic, annotations, onAutoMicStart],
  );

  const closeDocumentSession = useCallback(async (sessionId: string | null | undefined) => {
    if (!sessionId) return;
    try {
      await window.appShell.documentCloseSession({ sessionId });
    } catch (error) {
      console.debug('[ghost-layer] failed to close document session', error);
    }
  }, []);

  const navigateToTarget = useCallback(async (
    rawTarget: string,
    options?: { preferredStepId?: string | null },
  ): Promise<boolean> => {
    setDocStatusMessage(null);

    let resolvedSurface: SurfaceDescriptor | null = null;
    if (surfaceAdaptersV2Enabled) {
      const resolved = await resolveSurfaceTarget(rawTarget, {
        useDesktopBridge: true,
        preferOfficeEdit: officeEditingEnabled,
      });
      if (!resolved.ok) {
        setNavState((prev) => ({
          ...prev,
          loadError: resolved.error,
        }));
        return false;
      }
      resolvedSurface = resolved.value;
    } else {
      const resolved = resolveBrowserTarget(rawTarget);
      if (!resolved.ok) {
        setNavState((prev) => ({
          ...prev,
          loadError: resolved.error,
        }));
        return false;
      }
      const access = defaultAccess(resolved.value.surface, resolved.value.adapter);
      resolvedSurface = {
        sourceUrl: resolved.value.canonicalUrl,
        resolvedUrl: resolved.value.resolvedUrl,
        surface: resolved.value.surface,
        adapter: resolved.value.adapter,
        access,
        isEditable: access === 'editable',
        sessionId: null,
        resourceKey: computeCanonicalResourceKey({
          sourceUrl: resolved.value.canonicalUrl,
          surface: resolved.value.surface,
        }),
      };
    }

    if (!resolvedSurface) {
      setNavState((prev) => ({
        ...prev,
        loadError: 'Unable to resolve target.',
      }));
      return false;
    }

    const previousSessionId = activeSessionIdRef.current;
    if (previousSessionId && previousSessionId !== resolvedSurface.sessionId) {
      void closeDocumentSession(previousSessionId);
    }
    activeSessionIdRef.current = resolvedSurface.sessionId ?? null;

    const nextDescriptor: SurfaceDescriptor = {
      ...resolvedSurface,
      resourceKey: resolvedSurface.resourceKey || computeCanonicalResourceKey(resolvedSurface),
    };

    setSurfaceDescriptor(nextDescriptor);
    setActiveUrl(nextDescriptor.resolvedUrl);
    setInputUrl(nextDescriptor.sourceUrl);
    setNavState((prev) => ({
      ...prev,
      loadError: null,
      currentUrl: nextDescriptor.resolvedUrl,
      sourceUrl: nextDescriptor.sourceUrl,
      surface: nextDescriptor.surface as BrowserSurfaceKind,
      adapter: nextDescriptor.adapter as BrowserTargetAdapter,
      access: nextDescriptor.access,
      isEditable: nextDescriptor.isEditable,
      sessionId: nextDescriptor.sessionId ?? null,
    }));

    syncSurfaceContext(nextDescriptor, { preferredStepId: options?.preferredStepId ?? null });

    if (nextDescriptor.reason) {
      setDocStatusMessage(nextDescriptor.reason);
    }
    return true;
  }, [closeDocumentSession, officeEditingEnabled, surfaceAdaptersV2Enabled, syncSurfaceContext]);

  const onNavigate = useCallback(() => {
    void navigateToTarget(inputUrl);
  }, [inputUrl, navigateToTarget]);

  const onOpenFile = useCallback(async () => {
    try {
      const selectedPath = await window.appShell.openDocumentDialog({
        title: 'Open website or file',
        filters: [
          { name: 'All supported', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'json', 'csv', 'html', 'htm', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'] },
          { name: 'Office docs', extensions: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'] },
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'csv'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        ],
      });
      if (!selectedPath) return;
      await navigateToTarget(selectedPath);
    } catch (error) {
      setNavState((prev) => ({
        ...prev,
        loadError: error instanceof Error ? error.message : 'Failed to open file',
      }));
    }
  }, [navigateToTarget]);

  const onSurfaceDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes('Files');
    if (!hasFiles) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isFileDragOver) setIsFileDragOver(true);
  }, [isFileDragOver]);

  const onSurfaceDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setIsFileDragOver(false);
  }, []);

  const onSurfaceDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsFileDragOver(false);
    const droppedFile = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    const localPath = droppedFile?.path;
    if (!localPath) {
      setNavState((prev) => ({
        ...prev,
        loadError: 'Drop a local file from Finder/Explorer.',
      }));
      return;
    }
    void navigateToTarget(localPath);
  }, [navigateToTarget]);

  const setWebviewRef = useCallback((node: Element | null) => {
    setWebviewNode((prev) => {
      const next = node as Electron.WebviewTag | null;
      return prev === next ? prev : next;
    });
  }, []);

  const onGoBack = useCallback(() => {
    try { if (webviewNode?.canGoBack()) webviewNode.goBack(); } catch { /* not ready */ }
  }, [webviewNode]);

  const onGoForward = useCallback(() => {
    try { if (webviewNode?.canGoForward()) webviewNode.goForward(); } catch { /* not ready */ }
  }, [webviewNode]);

  const onReload = useCallback(() => {
    try { webviewNode?.reload(); } catch { /* not ready */ }
  }, [webviewNode]);

  const onOverlayWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!isAnnotating || isInteracting || !webviewNode) return;
    const scrollX = Number.isFinite(e.deltaX) ? e.deltaX : 0;
    const scrollY = Number.isFinite(e.deltaY) ? e.deltaY : 0;
    if (Math.abs(scrollX) < 0.1 && Math.abs(scrollY) < 0.1) return;
    e.preventDefault();
    const withEval = webviewNode as Electron.WebviewTag & {
      executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
    };
    if (typeof withEval.executeJavaScript !== 'function') return;
    const js = `window.scrollBy(${scrollX.toFixed(2)}, ${scrollY.toFixed(2)});`;
    void withEval.executeJavaScript(js, true).catch((error) => {
      console.debug('[ghost-layer] failed to forward wheel scroll', error);
    });
  }, [isAnnotating, isInteracting, webviewNode]);

  const onToggleAnnotating = useCallback(() => {
    setIsAnnotating((prev) => {
      const next = !prev;
      if (next) {
        setActiveDockPanel('none');
      }
      if (!next) {
        setIsDockCollapsed(true);
        setIsInteracting(false);
        setActiveTool('select');
      }
      return next;
    });
  }, [setActiveTool, setIsAnnotating]);

  const onExport = useCallback(async () => {
    if (mode === 'multi-resource' && !showReviewPanel) {
      setShowReviewPanel(true);
      setDocStatusMessage('Review your multi-step timeline before exporting.');
      return;
    }

    try {
      const payload = exportAsSessionV2();
      const json = JSON.stringify(payload, null, 2);
      await navigator.clipboard.writeText(json);
      await exportToChat();
    } catch (error) {
      console.debug('[ghost-layer] export flow fell back after clipboard write failure', error);
    }
  }, [mode, showReviewPanel, exportAsSessionV2, exportToChat]);

  // --- Share handlers (Dock V3) ---

  const onShareCopy = useCallback(async () => {
    const payload = exportAsSessionV2();
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [exportAsSessionV2]);

  const onShareToChat = useCallback(async () => {
    if (mode === 'multi-resource' && !showReviewPanel) {
      setShowReviewPanel(true);
      setDocStatusMessage('Review your multi-step timeline before sharing.');
      return;
    }
    await exportToChat();
  }, [mode, showReviewPanel, exportToChat]);

  const onShareDownload = useCallback(() => {
    const payload = exportAsSessionV2();
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ghost-layer-session-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportAsSessionV2]);

  // --- Dock drag handlers ---

  const onDockPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [role="menuitem"]')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dockDragRef.current = {
      startPointer: { x: e.clientX, y: e.clientY },
      startOffset: { ...dockOffset },
    };
  }, [dockOffset]);

  const onDockPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dockDragRef.current) return;
    const dx = e.clientX - dockDragRef.current.startPointer.x;
    const dy = e.clientY - dockDragRef.current.startPointer.y;

    const container = containerRef.current?.getBoundingClientRect();
    const dock = dockRef.current?.getBoundingClientRect();
    const maxX = container ? (container.width / 2) - (dock?.width ?? 200) / 2 - 8 : 600;
    const maxY = container ? container.height - (dock?.height ?? 40) - 24 : 400;

    setDockOffset({
      x: Math.max(-maxX, Math.min(maxX, dockDragRef.current.startOffset.x + dx)),
      y: Math.max(-maxY, Math.min(0, dockDragRef.current.startOffset.y - dy)),
    });
  }, []);

  const onDockPointerUp = useCallback(() => {
    if (!dockDragRef.current) return;
    dockDragRef.current = null;
    setIsDragging(false);
    setDockOffset((prev) => ({
      x: Math.abs(prev.x) < 40 ? 0 : prev.x,
      y: prev.y,
    }));
  }, []);

  const onModeTogglePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsModeToggleDragging(true);
    modeToggleDragRef.current = {
      startPointer: { x: e.clientX, y: e.clientY },
      startOffset: { ...modeToggleOffset },
    };
  }, [modeToggleOffset]);

  const onModeTogglePointerMove = useCallback((e: React.PointerEvent) => {
    if (!modeToggleDragRef.current) return;
    const dx = e.clientX - modeToggleDragRef.current.startPointer.x;
    const dy = e.clientY - modeToggleDragRef.current.startPointer.y;

    const container = containerRef.current?.getBoundingClientRect();
    const toggle = modeToggleRef.current?.getBoundingClientRect();
    const maxLeft = container ? Math.max(0, container.width - (toggle?.width ?? 180) - 24) : 1000;
    const maxDown = container ? Math.max(0, container.height - (toggle?.height ?? 42) - 24) : 1000;

    const nextX = modeToggleDragRef.current.startOffset.x + dx;
    const nextY = modeToggleDragRef.current.startOffset.y + dy;
    setModeToggleOffset({
      x: Math.max(-maxLeft, Math.min(8, nextX)),
      y: Math.max(0, Math.min(maxDown, nextY)),
    });
  }, []);

  const onModeTogglePointerUp = useCallback(() => {
    if (!modeToggleDragRef.current) return;
    modeToggleDragRef.current = null;
    setIsModeToggleDragging(false);
    setModeToggleOffset((prev) => ({
      x: Math.abs(prev.x) < 28 ? 0 : prev.x,
      y: prev.y,
    }));
  }, []);

  const onSessionModeChange = useCallback((nextMode: AnnotationSessionMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);

    if (nextMode === 'single-resource') {
      const fallbackStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
      if (!fallbackStep) return;
      const fallbackResource = resources.find((resource) => resource.id === fallbackStep.resourceId) ?? null;
      if (!fallbackResource) return;

      const fallbackAnnotations = annotationsByStep[fallbackStep.id] ?? [];
      const usedAssetIds = new Set(
        fallbackAnnotations
          .filter((shape): shape is SnapshotShape => shape.type === 'snapshot' && Boolean(shape.assetId))
          .map((shape) => shape.assetId as string),
      );

      const nextStep = { ...fallbackStep, index: 0 };
      setResources([fallbackResource]);
      setSteps([nextStep]);
      setAnnotationsByStep({ [nextStep.id]: fallbackAnnotations });
      setAssets((prev) => prev.filter((asset) => usedAssetIds.has(asset.id)));
      setUndoStacksByStep((prev) => ({ [nextStep.id]: prev[nextStep.id] ?? [] }));
      setRedoStacksByStep((prev) => ({ [nextStep.id]: prev[nextStep.id] ?? [] }));
      setActiveStepId(nextStep.id);
      setSession((prev) => ({
        ...prev,
        mode: 'single-resource',
        activeStepId: nextStep.id,
        resourceOrder: [fallbackResource.id],
        stepOrder: [nextStep.id],
        updatedAt: new Date().toISOString(),
      }));
      setSelectedId(null);
      setEditingNoteId(null);
      return;
    }

    setSession((prev) => ({
      ...prev,
      mode: 'multi-resource',
      updatedAt: new Date().toISOString(),
    }));
  }, [mode, setMode, steps, activeStepId, resources, annotationsByStep, setResources, setSteps, setAnnotationsByStep, setAssets, setUndoStacksByStep, setRedoStacksByStep, setActiveStepId, setSession, setSelectedId, setEditingNoteId]);

  const onResetSession = useCallback(() => {
    resetSession(mode);
    setSelectedId(null);
    setEditingNoteId(null);
    setShowReviewPanel(false);
    setDocStatusMessage('Session reset. Started a fresh context for this surface.');
    const descriptor = {
      ...surfaceDescriptor,
      resourceKey: surfaceDescriptor.resourceKey || computeCanonicalResourceKey(surfaceDescriptor),
    };
    initializeSessionForSurface(descriptor);
  }, [resetSession, mode, setSelectedId, setEditingNoteId, surfaceDescriptor, initializeSessionForSurface]);

  const onSelectStep = useCallback((stepId: string) => {
    const step = steps.find((item) => item.id === stepId);
    if (!step) return;
    const resource = resources.find((item) => item.id === step.resourceId);
    if (!resource) return;

    setActiveStepId(stepId);
    setSelectedId(null);
    setEditingNoteId(null);
    setSession((prev) => ({
      ...prev,
      activeStepId: stepId,
      updatedAt: new Date().toISOString(),
    }));

    if (resource.sourceUrl !== surfaceDescriptor.sourceUrl) {
      void navigateToTarget(resource.sourceUrl, { preferredStepId: stepId });
    }
  }, [steps, resources, setActiveStepId, setSelectedId, setEditingNoteId, setSession, surfaceDescriptor.sourceUrl, navigateToTarget]);

  const onRenameStep = useCallback((stepId: string, title: string) => {
    setSteps((prev) => prev.map((step) => (
      step.id === stepId ? { ...step, title: title.trim() } : step
    )));
    setSession((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
    }));
  }, [setSteps, setSession]);

  const onRemoveStep = useCallback((stepId: string) => {
    if (steps.length <= 1) return;
    const step = steps.find((item) => item.id === stepId);
    if (!step) return;

    const remainingStepsRaw = steps.filter((item) => item.id !== stepId);
    if (remainingStepsRaw.length === 0) return;

    const remainingSteps = remainingStepsRaw
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item, idx) => ({ ...item, index: idx }));

    const nextAnnotationsByStep = { ...annotationsByStep };
    delete nextAnnotationsByStep[stepId];

    const usedResourceIds = new Set(remainingSteps.map((item) => item.resourceId));
    const remainingResources = resources.filter((resource) => usedResourceIds.has(resource.id));

    const usedAssetIds = new Set(
      Object.values(nextAnnotationsByStep)
        .flat()
        .filter((shape): shape is SnapshotShape => shape.type === 'snapshot' && Boolean(shape.assetId))
        .map((shape) => shape.assetId as string),
    );

    const nextStepOrder = session.stepOrder.filter((id) => id !== stepId && remainingSteps.some((item) => item.id === id));
    if (nextStepOrder.length === 0) {
      nextStepOrder.push(...remainingSteps.map((item) => item.id));
    }

    const nextResourceOrder = session.resourceOrder.filter((id) => usedResourceIds.has(id));
    if (nextResourceOrder.length === 0) {
      nextResourceOrder.push(...remainingResources.map((resource) => resource.id));
    }

    const fallbackActive = activeStepId === stepId
      ? nextStepOrder[0] ?? remainingSteps[0]?.id ?? null
      : activeStepId;

    setSteps(remainingSteps);
    setResources(remainingResources);
    setAnnotationsByStep(nextAnnotationsByStep);
    setAssets((prev) => prev.filter((asset) => usedAssetIds.has(asset.id)));
    setUndoStacksByStep((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setRedoStacksByStep((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setActiveStepId(fallbackActive);
    setSelectedId(null);
    setEditingNoteId(null);

    setSession((prev) => ({
      ...prev,
      activeStepId: fallbackActive,
      stepOrder: nextStepOrder,
      resourceOrder: nextResourceOrder,
      updatedAt: new Date().toISOString(),
    }));

    const nextStep = remainingSteps.find((item) => item.id === fallbackActive);
    const nextResource = nextStep
      ? remainingResources.find((resource) => resource.id === nextStep.resourceId)
      : null;
    if (nextResource && nextResource.sourceUrl !== surfaceDescriptor.sourceUrl) {
      void navigateToTarget(nextResource.sourceUrl, { preferredStepId: fallbackActive });
    }
  }, [steps, annotationsByStep, resources, session.stepOrder, session.resourceOrder, activeStepId, setSteps, setResources, setAnnotationsByStep, setAssets, setUndoStacksByStep, setRedoStacksByStep, setActiveStepId, setSelectedId, setEditingNoteId, setSession, surfaceDescriptor.sourceUrl, navigateToTarget]);

  // Bootstrap a scoped resource+step on first mount.
  useEffect(() => {
    if (initializedContextRef.current) return;
    initializedContextRef.current = true;
    initializeSessionForSurface({
      ...surfaceDescriptor,
      resourceKey: surfaceDescriptor.resourceKey || computeCanonicalResourceKey(surfaceDescriptor),
    });
  }, [initializeSessionForSurface, surfaceDescriptor]);

  // Webview navigation event handlers
  useEffect(() => {
    if (!webviewNode) return;

    let domReady = false;

    const syncNav = () => {
      if (!domReady) return;
      try {
        const currentUrl = webviewNode.getURL() || '';
        setNavState((prev) => ({
          ...prev,
          canGoBack: webviewNode.canGoBack(),
          canGoForward: webviewNode.canGoForward(),
          currentUrl: currentUrl || prev.currentUrl,
        }));
      } catch {
        // webview not yet attached — ignore
      }
    };

    const handleDomReady = () => {
      domReady = true;
      syncNav();
    };
    const handleStart = () => {
      setNavState((prev) => ({ ...prev, isLoading: true, loadError: null }));
      syncNav();
    };
    const handleStop = () => {
      setNavState((prev) => ({ ...prev, isLoading: false }));
      syncNav();
    };
    const handleNavigate = () => {
      syncNav();
      try {
        const currentUrl = webviewNode.getURL() || '';
        if (!currentUrl) return;

        // Keep the original source URL in the input when viewing via a compatibility adapter.
        if (surfaceDescriptor.adapter !== 'none' && currentUrl === surfaceDescriptor.resolvedUrl) {
          setInputUrl(surfaceDescriptor.sourceUrl);
          setNavState((prev) => ({
            ...prev,
            sourceUrl: surfaceDescriptor.sourceUrl,
            surface: surfaceDescriptor.surface as BrowserSurfaceKind,
            adapter: surfaceDescriptor.adapter as BrowserTargetAdapter,
            access: surfaceDescriptor.access,
            isEditable: surfaceDescriptor.isEditable,
            sessionId: surfaceDescriptor.sessionId ?? null,
          }));
          syncSurfaceContext(surfaceDescriptor, { preferredStepId: activeStepId });
          return;
        }

        const classified = classifySurfaceUrl(currentUrl);
        if (classified.ok) {
          if (activeSessionIdRef.current && currentUrl !== surfaceDescriptor.resolvedUrl) {
            const staleSessionId = activeSessionIdRef.current;
            activeSessionIdRef.current = null;
            void closeDocumentSession(staleSessionId);
          }
          const descriptor = {
            ...classified.value,
            sessionId: null,
            resourceKey: classified.value.resourceKey || computeCanonicalResourceKey(classified.value),
          };
          setSurfaceDescriptor(descriptor);
          setInputUrl(descriptor.sourceUrl);
          setNavState((prev) => ({
            ...prev,
            sourceUrl: descriptor.sourceUrl,
            surface: descriptor.surface as BrowserSurfaceKind,
            adapter: descriptor.adapter as BrowserTargetAdapter,
            access: descriptor.access,
            isEditable: descriptor.isEditable,
            sessionId: null,
          }));
          syncSurfaceContext(descriptor);
        } else {
          setInputUrl(currentUrl);
        }
      } catch {
        // ignore if not ready
      }
    };
    const handleTitleUpdated = (event: Event) => {
      const detail = event as unknown as { title?: string };
      setNavState((prev) => ({ ...prev, title: detail.title || prev.title }));
    };
    const handleFailLoad = (event: Event) => {
      const detail = event as unknown as { errorDescription?: string; validatedURL?: string };
      setNavState((prev) => ({
        ...prev,
        isLoading: false,
        loadError: detail.errorDescription || 'Failed to load page',
        currentUrl: detail.validatedURL || prev.currentUrl,
        sourceUrl: detail.validatedURL || prev.sourceUrl,
      }));
    };

    webviewNode.addEventListener('dom-ready', handleDomReady);
    webviewNode.addEventListener('did-start-loading', handleStart);
    webviewNode.addEventListener('did-stop-loading', handleStop);
    webviewNode.addEventListener('did-navigate', handleNavigate);
    webviewNode.addEventListener('did-navigate-in-page', handleNavigate);
    webviewNode.addEventListener('page-title-updated', handleTitleUpdated);
    webviewNode.addEventListener('did-fail-load', handleFailLoad);

    return () => {
      webviewNode.removeEventListener('dom-ready', handleDomReady);
      webviewNode.removeEventListener('did-start-loading', handleStart);
      webviewNode.removeEventListener('did-stop-loading', handleStop);
      webviewNode.removeEventListener('did-navigate', handleNavigate);
      webviewNode.removeEventListener('did-navigate-in-page', handleNavigate);
      webviewNode.removeEventListener('page-title-updated', handleTitleUpdated);
      webviewNode.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [activeStepId, closeDocumentSession, surfaceDescriptor, syncSurfaceContext, webviewNode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMeta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Cmd+Shift+A — toggle annotation mode
      if (isMeta && e.shiftKey && key === 'a') {
        e.preventDefault();
        onToggleAnnotating();
        return;
      }

      if (!isAnnotating) return;

      // Tool shortcuts
      if (isMeta && !e.shiftKey && key === 'i') {
        e.preventDefault();
        setIsInteracting((prev) => !prev);
        return;
      }

      if (!isMeta && !e.shiftKey) {
        const toolMap: Record<string, string> = {
          v: 'select',
          h: 'grab',
          c: 'circle',
          r: 'rect',
          a: 'arrow',
          l: 'line',
          t: 'text',
          d: 'freehand',
          w: 'lasso',
        };
        if (toolMap[key]) {
          e.preventDefault();
          setActiveTool(toolMap[key] as AnnotationToolType);
          return;
        }
      }

      // Cmd+S — export
      if (isMeta && key === 's') {
        e.preventDefault();
        void onExport();
        return;
      }

      // Escape — layered exit
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isRecording) {
          void stopRecording();
          return;
        }
        if (activeDockPanel !== 'none') {
          setActiveDockPanel('none');
          return;
        }
        if (isInteracting) {
          setIsInteracting(false);
          return;
        }
        if (activeTool !== 'select') {
          setActiveTool('select');
          return;
        }
        setIsAnnotating(false);
        setActiveTool('select');
        return;
      }

      // Space (hold) — record voice note
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        void startRecording();
        return;
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key === ' ' && isRecording) {
        e.preventDefault();
        void stopRecording();
      }
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', keyUpHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', keyUpHandler);
    };
  }, [isAnnotating, isInteracting, isRecording, activeDockPanel, activeTool, onToggleAnnotating, setActiveTool, setIsAnnotating, onExport, startRecording, stopRecording]);

  useEffect(() => {
    if (!isAnnotating && isInteracting) {
      setIsInteracting(false);
    }
  }, [isAnnotating, isInteracting]);

  // Load persisted ghost-layer preferences
  useEffect(() => {
    let isCancelled = false;
    void window.appShell.getSetting('oneshot.ghost-layer.stop-phrase')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'string' && raw.trim()) {
          setStopPhrase(raw.trim());
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load stop phrase setting', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.auto-mic')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'boolean') {
          setAutoMic(raw);
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load auto-mic setting', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.surface-adapters.v2')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'boolean') {
          setSurfaceAdaptersV2Enabled(raw);
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load surface adapter flag', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.office-editing.v1')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'boolean') {
          setOfficeEditingEnabled(raw);
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load office editing flag', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.multi-resource')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'boolean') {
          setMode(raw ? 'multi-resource' : 'single-resource');
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load multi-resource setting', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.dock-offset')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw) as { x?: number; y?: number };
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
              setDockOffset({ x: parsed.x, y: parsed.y });
            }
          } catch (error) {
            console.debug('[ghost-layer] failed to parse dock offset setting', error);
          }
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load dock offset setting', error);
      });
    void window.appShell.getSetting('oneshot.ghost-layer.mode-toggle-offset')
      .then((raw) => {
        if (isCancelled) return;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw) as { x?: number; y?: number };
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
              setModeToggleOffset({ x: parsed.x, y: parsed.y });
            }
          } catch (error) {
            console.debug('[ghost-layer] failed to parse mode toggle offset setting', error);
          }
        }
      })
      .catch((error) => {
        console.debug('[ghost-layer] failed to load mode toggle offset setting', error);
      });
    return () => {
      isCancelled = true;
    };
  }, [setAutoMic, setMode, setOfficeEditingEnabled, setStopPhrase, setSurfaceAdaptersV2Enabled]);

  useEffect(() => {
    void window.appShell.setSetting('oneshot.ghost-layer.stop-phrase', stopPhrase).catch((error) => {
      console.debug('[ghost-layer] failed to persist stop phrase setting', error);
    });
  }, [stopPhrase]);

  useEffect(() => {
    void window.appShell.setSetting('oneshot.ghost-layer.auto-mic', autoMic).catch((error) => {
      console.debug('[ghost-layer] failed to persist auto-mic setting', error);
    });
  }, [autoMic]);

  useEffect(() => {
    void window.appShell.setSetting('oneshot.ghost-layer.multi-resource', mode === 'multi-resource').catch((error) => {
      console.debug('[ghost-layer] failed to persist multi-resource setting', error);
    });
  }, [mode]);

  // Persist dock offset (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.appShell.setSetting(
        'oneshot.ghost-layer.dock-offset',
        JSON.stringify(dockOffset),
      ).catch((error) => {
        console.debug('[ghost-layer] failed to persist dock offset setting', error);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [dockOffset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.appShell.setSetting(
        'oneshot.ghost-layer.mode-toggle-offset',
        JSON.stringify(modeToggleOffset),
      ).catch((error) => {
        console.debug('[ghost-layer] failed to persist mode toggle offset setting', error);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [modeToggleOffset]);

  useEffect(() => {
    return () => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      activeSessionIdRef.current = null;
      void closeDocumentSession(sessionId);
    };
  }, [closeDocumentSession]);

  const onSaveDocument = useCallback(async () => {
    if (!navState.sessionId) return;
    setDocStatusMessage('Saving document...');
    try {
      const result = await window.appShell.documentSaveSession({ sessionId: navState.sessionId });
      if (!result.ok) {
        setNavState((prev) => ({
          ...prev,
          loadError: result.error ?? 'Failed to save document.',
        }));
        setDocStatusMessage(result.error ?? 'Failed to save document.');
        return;
      }
      const message = result.conflictDetected
        ? `Saved with backup${result.backupPath ? `: ${result.backupPath}` : ''} (source changed externally).`
        : `Saved${result.backupPath ? ` (backup: ${result.backupPath})` : ''}.`;
      setDocStatusMessage(message);
      setNavState((prev) => ({ ...prev, loadError: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save document.';
      setNavState((prev) => ({ ...prev, loadError: message }));
      setDocStatusMessage(message);
    }
  }, [navState.sessionId]);

  const statusLabel = useMemo(() => {
    if (navState.isLoading) return 'Loading...';
    if (navState.loadError) return navState.loadError;
    return navState.sourceUrl || navState.currentUrl;
  }, [navState.currentUrl, navState.sourceUrl, navState.isLoading, navState.loadError]);

  const surfaceLabel = useMemo(
    () => describeBrowserSurface(navState.surface),
    [navState.surface],
  );

  const adapterLabel = useMemo(() => {
    if (navState.adapter === 'office-web-viewer') return 'Office viewer';
    if (navState.adapter === 'office-local-edit') return 'Office edit';
    if (navState.adapter === 'office-local-preview') return 'Preview fallback';
    return null;
  }, [navState.adapter]);

  const modeLabel = mode === 'multi-resource' ? 'Multi-resource' : 'Single-resource';

  const reviewExportPayload = useMemo(() => exportAsSessionV2(), [exportAsSessionV2]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-2 px-2 pb-3 pt-1">
      {/* Navigation bar */}
      <div className="rounded-lg border border-border/70 bg-background/70 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm" onClick={onGoBack} disabled={!navState.canGoBack}>
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm" onClick={onGoForward} disabled={!navState.canGoForward}>
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm" onClick={onReload}>
                <HugeiconsIcon icon={RefreshIcon} size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload</TooltipContent>
          </Tooltip>
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onNavigate();
              }
            }}
            placeholder="URL or local path (e.g. /Users/me/file.pdf)"
            className="h-9 min-w-[260px] flex-1 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Website URL"
          />
          <Button type="button" size="sm" onClick={onNavigate}>
            Open
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void onOpenFile()}>
            Open File
          </Button>
          {navState.sessionId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onSaveDocument()}
              disabled={!navState.isEditable}
            >
              Save Doc
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={showReviewPanel ? 'default' : 'outline'}
            onClick={() => setShowReviewPanel((p) => !p)}
          >
            Review
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-muted-foreground" title={statusLabel}>
            {navState.title ? `${navState.title} · ` : ''}{statusLabel}
          </span>
          <span className="rounded-full border border-blue-400/25 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-200/90">
            {surfaceLabel}
          </span>
          <span
            className={
              navState.access === 'editable'
                ? 'rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200/90'
                : navState.access === 'converted'
                  ? 'rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200/90'
                  : 'rounded-full border border-zinc-400/25 bg-zinc-500/10 px-2 py-0.5 text-[10px] text-zinc-200/90'
            }
          >
            {navState.access}
          </span>
          <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200/90">
            {modeLabel}
          </span>
          {adapterLabel && (
            <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200/90">
              {adapterLabel}
            </span>
          )}
          {docStatusMessage && (
            <span className="max-w-[380px] truncate text-[10px] text-blue-200/70" title={docStatusMessage}>
              {docStatusMessage}
            </span>
          )}
          {isRecording && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              Recording...
            </span>
          )}
          {transcript && !isRecording && (
            <span className="max-w-[200px] truncate text-xs text-muted-foreground" title={transcript}>
              &ldquo;{transcript}&rdquo;
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50">
            {isAnnotating ? 'Esc to exit · ' : 'Cmd+Shift+A to annotate · '}
            {annotations.length} annotations · {steps.length} steps
          </span>
        </div>
      </div>

      {/* Webview + overlay container */}
      <div
        ref={containerRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-background transition-shadow duration-300',
          isAnnotating && !isInteracting && 'webview-annotate-ring',
          isAnnotating && isInteracting && 'webview-interact-ring',
        )}
        onDragOver={onSurfaceDragOver}
        onDragLeave={onSurfaceDragLeave}
        onDrop={onSurfaceDrop}
      >
        {createElement('webview', {
          src: activeUrl,
          className: 'h-full w-full',
          allowpopups: 'false',
          ref: setWebviewRef,
        } as Record<string, unknown>)}

        {isFileDragOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-blue-400/60 bg-[#061425]/65 text-sm font-medium text-blue-100 backdrop-blur-sm">
            Drop file to open in Ghost Layer
          </div>
        )}

        {navState.loadError && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#020817]/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-xl border border-red-400/30 bg-[#08121f]/92 p-4 text-white shadow-2xl">
              <p className="text-sm font-semibold text-red-200">Could not open this surface</p>
              <p className="mt-1 text-xs text-red-100/85">{navState.loadError}</p>
              <div className="mt-3 flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void onOpenFile()}>
                  Choose File
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void navigateToTarget(inputUrl)}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Annotation overlay — transparent to mouse when not annotating */}
        <div
          className="absolute inset-0 z-10 transition-opacity duration-200"
          style={{
            pointerEvents: isAnnotating && !isInteracting ? 'all' : 'none',
            opacity: isInteracting ? 0.55 : 1,
          }}
          onWheel={onOverlayWheel}
        >
          <AnnotationOverlay
            onAutoMicStart={onAutoMicStart}
            onLassoCapture={onLassoCapture}
            onTextMicStart={onTextMicStart}
            dictatingTextId={dictatingTextId}
          />
        </div>

        {/* Dictation hint banner */}
        {isTextDictating && (
          <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-blue-400/20 bg-[#061425]/80 px-3 py-1.5 shadow-[0_4px_20px_rgba(0,80,200,0.2)] backdrop-blur-2xl">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <span className="text-xs text-white/80">
              Listening… say <kbd className="mx-0.5 rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-blue-200">&quot;{stopPhrase || 'done'}&quot;</kbd> to finish or press <kbd className="mx-0.5 rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-white/80">Esc</kbd>
            </span>
          </div>
        )}

        {isAnnotating && (
          <div
            ref={modeToggleRef}
            className="absolute right-4 top-4 z-20"
            style={{
              transform: `translate(${modeToggleOffset.x}px, ${modeToggleOffset.y}px)`,
              transition: isModeToggleDragging ? 'none' : 'transform 0.15s',
            }}
          >
            <AnnotationModeToggle
              isInteracting={isInteracting}
              isCollapsed={isModeToggleCollapsed}
              onToggleCollapsed={() => setIsModeToggleCollapsed((prev) => !prev)}
              onSetInteracting={setIsInteracting}
              onPointerDown={onModeTogglePointerDown}
              onPointerMove={onModeTogglePointerMove}
              onPointerUp={onModeTogglePointerUp}
            />
          </div>
        )}

        {/* Dock wrapper — positioned by parent, toolbar owns pointer handlers */}
        <div
          ref={dockRef}
          className="absolute z-20 flex flex-col items-center"
          style={{
            bottom: `${16 + dockOffset.y}px`,
            left: '50%',
            transform: `translateX(calc(-50% + ${dockOffset.x}px))`,
            transition: isDragging ? 'none' : 'bottom 0.15s, transform 0.15s',
          }}
        >
          <AnnotationToolbar
            onToggleAnnotating={onToggleAnnotating}
            onSwitchToAnnotate={() => setIsInteracting(false)}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            isRecording={isRecording}
            sttState={sttState}
            sttErrorDetail={sttErrorDetail}
            onRetryMic={() => void startRecording()}
            sessionMode={mode}
            onSessionModeChange={onSessionModeChange}
            onResetSession={onResetSession}
            isInteracting={isInteracting}
            isDockCollapsed={isDockCollapsed}
            onToggleDockCollapsed={() => setIsDockCollapsed((p) => !p)}
            activeDockPanel={activeDockPanel}
            onOpenDockPanel={(panel) => setActiveDockPanel(panel)}
            onCloseDockPanel={() => setActiveDockPanel('none')}
            onShareCopy={() => void onShareCopy()}
            onShareToChat={() => void onShareToChat()}
            onShareDownload={onShareDownload}
            onDockPointerDown={onDockPointerDown}
            onDockPointerMove={onDockPointerMove}
            onDockPointerUp={onDockPointerUp}
          />
        </div>

        {/* Review Panel */}
        {showReviewPanel && (
          <ReviewPanel
            exportPayload={reviewExportPayload}
            sessionMode={mode}
            activeStepId={activeStepId}
            onSelectStep={onSelectStep}
            onRenameStep={onRenameStep}
            onRemoveStep={onRemoveStep}
            onClose={() => setShowReviewPanel(false)}
          />
        )}
      </div>
    </div>
  );
}
