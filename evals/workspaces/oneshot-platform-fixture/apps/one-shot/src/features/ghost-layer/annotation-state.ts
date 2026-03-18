import { atom } from 'jotai';
import type {
  AnnotationAsset,
  AnnotationSession,
  AnnotationSessionMode,
  AnnotationShape,
  AnnotationStep,
  AnnotationToolType,
  SurfaceResource,
} from '@oneshot/annotation-core/types';

type StateUpdate<T> = T | ((prev: T) => T);

function resolveUpdate<T>(update: StateUpdate<T>, prev: T): T {
  return typeof update === 'function'
    ? (update as (prevValue: T) => T)(prev)
    : update;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(mode: AnnotationSessionMode = 'multi-resource'): AnnotationSession {
  const now = new Date().toISOString();
  return {
    id: createId('gl_session'),
    createdAt: now,
    updatedAt: now,
    mode,
    activeStepId: null,
    resourceOrder: [],
    stepOrder: [],
  };
}

export const ghostLayerSessionAtom = atom<AnnotationSession>(createSession('multi-resource'));
export const ghostLayerResourcesAtom = atom<SurfaceResource[]>([]);
export const ghostLayerStepsAtom = atom<AnnotationStep[]>([]);
export const ghostLayerAnnotationsByStepAtom = atom<Record<string, AnnotationShape[]>>({});
export const ghostLayerAssetsAtom = atom<AnnotationAsset[]>([]);

export const ghostLayerModeAtom = atom(
  (get) => get(ghostLayerSessionAtom).mode,
  (get, set, nextMode: StateUpdate<AnnotationSessionMode>) => {
    const session = get(ghostLayerSessionAtom);
    const mode = resolveUpdate(nextMode, session.mode);
    set(ghostLayerSessionAtom, {
      ...session,
      mode,
      updatedAt: new Date().toISOString(),
    });
  },
);

export const ghostLayerActiveStepIdAtom = atom(
  (get) => get(ghostLayerSessionAtom).activeStepId,
  (get, set, nextStepId: StateUpdate<string | null>) => {
    const session = get(ghostLayerSessionAtom);
    const activeStepId = resolveUpdate(nextStepId, session.activeStepId);
    set(ghostLayerSessionAtom, {
      ...session,
      activeStepId,
      updatedAt: new Date().toISOString(),
    });
  },
);

export const ghostLayerCurrentStepAtom = atom((get) => {
  const activeStepId = get(ghostLayerActiveStepIdAtom);
  if (!activeStepId) return null;
  return get(ghostLayerStepsAtom).find((step) => step.id === activeStepId) ?? null;
});

export const ghostLayerAnnotationsAtom = atom(
  (get) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return [] as AnnotationShape[];
    const byStep = get(ghostLayerAnnotationsByStepAtom);
    return byStep[activeStepId] ?? [];
  },
  (get, set, update: StateUpdate<AnnotationShape[]>) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return;

    const currentByStep = get(ghostLayerAnnotationsByStepAtom);
    const previous = currentByStep[activeStepId] ?? [];
    const resolved = resolveUpdate(update, previous);

    const step = get(ghostLayerStepsAtom).find((item) => item.id === activeStepId) ?? null;
    const resourceId = step?.resourceId;

    const withScope = resolved.map((shape) => ({
      ...shape,
      stepId: shape.stepId ?? activeStepId,
      resourceId: shape.resourceId ?? resourceId,
    }));

    set(ghostLayerAnnotationsByStepAtom, {
      ...currentByStep,
      [activeStepId]: withScope,
    });

    set(ghostLayerStepsAtom, (prev) =>
      prev.map((item) =>
        item.id === activeStepId
          ? {
              ...item,
              annotationIds: withScope.map((shape) => shape.id),
            }
          : item,
      ),
    );

    set(ghostLayerSessionAtom, (prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
    }));
  },
);

type AnnotationHistoryByStep = Record<string, AnnotationShape[][]>;

export const ghostLayerUndoStacksByStepAtom = atom<AnnotationHistoryByStep>({});
export const ghostLayerRedoStacksByStepAtom = atom<AnnotationHistoryByStep>({});

export const ghostLayerUndoStackAtom = atom(
  (get) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return [] as AnnotationShape[][];
    return get(ghostLayerUndoStacksByStepAtom)[activeStepId] ?? [];
  },
  (get, set, update: StateUpdate<AnnotationShape[][]>) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return;

    const stacks = get(ghostLayerUndoStacksByStepAtom);
    const current = stacks[activeStepId] ?? [];
    const next = resolveUpdate(update, current);
    set(ghostLayerUndoStacksByStepAtom, {
      ...stacks,
      [activeStepId]: next,
    });
  },
);

export const ghostLayerRedoStackAtom = atom(
  (get) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return [] as AnnotationShape[][];
    return get(ghostLayerRedoStacksByStepAtom)[activeStepId] ?? [];
  },
  (get, set, update: StateUpdate<AnnotationShape[][]>) => {
    const activeStepId = get(ghostLayerActiveStepIdAtom);
    if (!activeStepId) return;

    const stacks = get(ghostLayerRedoStacksByStepAtom);
    const current = stacks[activeStepId] ?? [];
    const next = resolveUpdate(update, current);
    set(ghostLayerRedoStacksByStepAtom, {
      ...stacks,
      [activeStepId]: next,
    });
  },
);

export const ghostLayerResetSessionAtom = atom(null, (_get, set, mode: AnnotationSessionMode = 'multi-resource') => {
  set(ghostLayerSessionAtom, createSession(mode));
  set(ghostLayerResourcesAtom, []);
  set(ghostLayerStepsAtom, []);
  set(ghostLayerAnnotationsByStepAtom, {});
  set(ghostLayerAssetsAtom, []);
  set(ghostLayerUndoStacksByStepAtom, {});
  set(ghostLayerRedoStacksByStepAtom, {});
});

export const ghostLayerActiveToolAtom = atom<AnnotationToolType>('select');
export const ghostLayerActiveColorAtom = atom('#3b82f6');
export const ghostLayerSelectedShapeIdAtom = atom<string | null>(null);
export const ghostLayerAnnotatingAtom = atom(false);
export const ghostLayerEditingNoteIdAtom = atom<string | null>(null);
export const ghostLayerFreehandWidthAtom = atom<number>(3);
export const ghostLayerFreehandStyleAtom = atom<'solid' | 'dashed'>('solid');
export const ghostLayerAutoMicAtom = atom<boolean>(true);
export const ghostLayerStopPhraseAtom = atom<string>('done');
