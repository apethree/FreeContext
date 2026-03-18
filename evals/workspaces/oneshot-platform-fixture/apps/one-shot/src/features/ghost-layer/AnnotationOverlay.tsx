import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { AnnotationShape, AnnotationToolType, Point, TextShape } from '@oneshot/annotation-core/types';
import { buildCurvedConnector } from '@oneshot/annotation-core/connector';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { Mic02Icon } from '@hugeicons/core-free-icons';
import {
  estimateConnectedLabelMetrics,
  placeConnectedLabel,
  relayoutConnectedLabels,
} from '@oneshot/annotation-core/label-layout';
import {
  ghostLayerAnnotationsAtom,
  ghostLayerActiveToolAtom,
  ghostLayerActiveColorAtom,
  ghostLayerSelectedShapeIdAtom,
  ghostLayerEditingNoteIdAtom,
  ghostLayerUndoStackAtom,
  ghostLayerRedoStackAtom,
  ghostLayerFreehandWidthAtom,
  ghostLayerFreehandStyleAtom,
  ghostLayerAutoMicAtom,
} from './annotation-state';

function generateId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type DrawState = {
  start: Point;
  current: Point;
  points: Point[];
};

type DragState = {
  shapeId: string;
  startMouse: Point;
  startShapeSnapshot: AnnotationShape;
};

type ConnectorDragState = {
  textId: string;
  startMouse: Point;
  startBend: number;
  normal: Point;
};

function getShapeLabelPos(shape: AnnotationShape): Point {
  switch (shape.type) {
    case 'circle':
      return { x: shape.cx + shape.r + 8, y: shape.cy };
    case 'rect':
      return { x: shape.x + shape.w + 8, y: shape.y + 12 };
    case 'arrow':
    case 'line':
      return { x: Math.max(shape.from.x, shape.to.x) + 8, y: (shape.from.y + shape.to.y) / 2 };
    case 'text': {
      const connectedMetrics = shape.parentId
        ? estimateConnectedLabelMetrics(shape.content)
        : null;
      const estimatedWidth = connectedMetrics
        ? connectedMetrics.width - connectedMetrics.paddingX
        : (shape.content?.length ?? 0) * 9 + 4;
      return { x: shape.x + estimatedWidth + 8, y: shape.y };
    }
    case 'freehand': {
      if (shape.points.length === 0) return { x: 0, y: 0 };
      let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: maxX + 8, y: (minY + maxY) / 2 };
    }
    case 'snapshot':
      return { x: shape.x + shape.w + 8, y: shape.y + 12 };
  }
}

function applyDragDelta(shape: AnnotationShape, dx: number, dy: number): AnnotationShape {
  switch (shape.type) {
    case 'circle':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'rect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'arrow':
    case 'line':
      return {
        ...shape,
        from: { x: shape.from.x + dx, y: shape.from.y + dy },
        to: { x: shape.to.x + dx, y: shape.to.y + dy },
      };
    case 'text':
      return shape.parentId
        ? {
            ...shape,
            x: shape.x + dx,
            y: shape.y + dy,
            labelMode: 'manual',
            connector: { ...(shape.connector ?? {}), mode: 'manual' },
          }
        : { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'freehand':
      return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'snapshot':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
  }
}

const PENCIL_CURSOR = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' stroke='%23222' stroke-width='2'/><path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' stroke='%23fff' stroke-width='1' opacity='0.5'/></svg>") 2 22, crosshair`;
const LABEL_MIC_SLOT_W = 28;    // mic button on LEFT side of chip
const LABEL_HANDLE_SLOT_W = 22; // drag grip on RIGHT side of chip

function GripDots({
  centerX,
  centerY,
  color = 'rgba(15,23,42,0.74)',
}: {
  centerX: number;
  centerY: number;
  color?: string;
}) {
  const spacing = 3.4;
  const r = 1.15;
  return (
    <>
      <circle cx={centerX - spacing / 2} cy={centerY - spacing} r={r} fill={color} style={{ pointerEvents: 'none' }} />
      <circle cx={centerX + spacing / 2} cy={centerY - spacing} r={r} fill={color} style={{ pointerEvents: 'none' }} />
      <circle cx={centerX - spacing / 2} cy={centerY} r={r} fill={color} style={{ pointerEvents: 'none' }} />
      <circle cx={centerX + spacing / 2} cy={centerY} r={r} fill={color} style={{ pointerEvents: 'none' }} />
      <circle cx={centerX - spacing / 2} cy={centerY + spacing} r={r} fill={color} style={{ pointerEvents: 'none' }} />
      <circle cx={centerX + spacing / 2} cy={centerY + spacing} r={r} fill={color} style={{ pointerEvents: 'none' }} />
    </>
  );
}

export { getShapeLabelPos };

export function AnnotationOverlay({
  onAutoMicStart,
  onLassoCapture,
  onTextMicStart,
  dictatingTextId,
}: {
  onAutoMicStart?: (position: Point, parentId: string) => void;
  onLassoCapture?: (bbox: { x: number; y: number; w: number; h: number }) => void;
  onTextMicStart?: (textId: string) => void;
  dictatingTextId?: string | null;
}) {
  const [annotations, setAnnotations] = useAtom(ghostLayerAnnotationsAtom);
  const [, setUndoStack] = useAtom(ghostLayerUndoStackAtom);
  const [, setRedoStack] = useAtom(ghostLayerRedoStackAtom);
  const [activeTool, setActiveTool] = useAtom(ghostLayerActiveToolAtom);
  const activeColor = useAtomValue(ghostLayerActiveColorAtom);
  const [selectedId, setSelectedId] = useAtom(ghostLayerSelectedShapeIdAtom);
  const [editingNoteId, setEditingNoteId] = useAtom(ghostLayerEditingNoteIdAtom);
  const freehandWidth = useAtomValue(ghostLayerFreehandWidthAtom);
  const freehandStyle = useAtomValue(ghostLayerFreehandStyleAtom);
  const autoMic = useAtomValue(ghostLayerAutoMicAtom);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectorDragState, setConnectorDragState] = useState<ConnectorDragState | null>(null);
  const dragUndoPushedRef = useRef(false);
  const connectorUndoPushedRef = useRef(false);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const resumeToolAfterEditRef = useRef<AnnotationToolType | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [eraserHoverId, setEraserHoverId] = useState<string | null>(null);

  const getMousePos = useCallback((e: React.MouseEvent): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: e.clientX, y: e.clientY };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-49), annotations]);
    setRedoStack([]);
  }, [annotations, setUndoStack, setRedoStack]);

  const closeEditor = useCallback((resumeTool: boolean) => {
    setEditingNoteId(null);
    const nextTool = resumeTool ? resumeToolAfterEditRef.current : null;
    resumeToolAfterEditRef.current = null;
    if (nextTool && nextTool !== 'select') {
      setActiveTool(nextTool);
    }
  }, [setEditingNoteId, setActiveTool]);

  const openTextEditor = useCallback((textId: string) => {
    setSelectedId(textId);
    setEditingNoteId(textId);
    if (activeTool !== 'select') {
      resumeToolAfterEditRef.current = activeTool;
      setActiveTool('select');
    } else if (!resumeToolAfterEditRef.current) {
      resumeToolAfterEditRef.current = null;
    }
  }, [activeTool, setSelectedId, setEditingNoteId, setActiveTool]);

  const saveNote = useCallback(
    (shapeId: string, text: string) => {
      setAnnotations((prev) =>
        prev
          .map((shape) => {
            if (shape.id !== shapeId) return shape;
            if (shape.type === 'text') {
              // Text labels (including connected labels) should persist even when empty.
              return { ...shape, content: text };
            }
            return { ...shape, note: text.trim() || undefined };
          })
          .filter((shape): shape is AnnotationShape => shape !== null),
      );
      closeEditor(true);
    },
    [setAnnotations, closeEditor],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as SVGElement;
      const isSelectMode = activeTool === 'select';
      const isGrabMode = activeTool === 'grab';
      const textMicId = target.closest('[data-text-mic-id]')?.getAttribute('data-text-mic-id');
      const textEditId = target.closest('[data-text-edit-id]')?.getAttribute('data-text-edit-id');
      const textEditToggleId = target.closest('[data-text-edit-toggle-id]')?.getAttribute('data-text-edit-toggle-id');

      // Allow dictation/edit affordances from any tool mode.
      if (textMicId) {
        e.preventDefault();
        e.stopPropagation();
        suppressNextClickRef.current = true;
        openTextEditor(textMicId);
        onTextMicStart?.(textMicId);
        return;
      }
      if (textEditToggleId) {
        e.preventDefault();
        e.stopPropagation();
        suppressNextClickRef.current = true;
        openTextEditor(textEditToggleId);
        return;
      }
      if (textEditId) {
        e.preventDefault();
        e.stopPropagation();
        suppressNextClickRef.current = true;
        openTextEditor(textEditId);
        return;
      }

      if (isSelectMode) {
        const connectorHandleId = target.closest('[data-connector-handle-id]')?.getAttribute('data-connector-handle-id');
        if (connectorHandleId) {
          const text = annotations.find(
            (shape): shape is TextShape => shape.id === connectorHandleId && shape.type === 'text',
          );
          const parent = text?.parentId
            ? annotations.find((shape) => shape.id === text.parentId)
            : null;
          if (text && parent) {
            e.preventDefault();
            e.stopPropagation();
            const pos = getMousePos(e);
            const connector = buildCurvedConnector({ parent, text, annotations });
            setSelectedId(text.id);
            setConnectorDragState({
              textId: text.id,
              startMouse: pos,
              startBend: text.connector?.bend ?? connector.bend,
              normal: connector.normal,
            });
            connectorUndoPushedRef.current = false;
            didDragRef.current = false;
          }
          return;
        }
      }
      const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id');

      // Eraser: click to delete shape
      if (activeTool === 'eraser') {
        if (shapeId) {
          e.preventDefault();
          e.stopPropagation();
          pushUndo();
          setAnnotations((prev) => prev.filter((s) => s.id !== shapeId));
          setSelectedId(null);
        }
        return;
      }

      if (shapeId) {
        e.preventDefault();
        e.stopPropagation();
        const pos = getMousePos(e);
        const shape = annotations.find((s) => s.id === shapeId);
        if (shape) {
          if (shape.type === 'text' && !isSelectMode && !isGrabMode) {
            openTextEditor(shape.id);
            return;
          }
          if (isGrabMode) {
            setSelectedId(null);
            setEditingNoteId(null);
          } else {
            setSelectedId(shapeId);
          }
          setDragState({ shapeId, startMouse: pos, startShapeSnapshot: shape });
          dragUndoPushedRef.current = false;
          didDragRef.current = false;
        }
        return;
      }
      // Select tool on empty space: just deselect (handled in onClick)
      if (activeTool === 'select' || activeTool === 'grab') return;
      // Drawing tools on empty space: start drawing
      e.preventDefault();
      e.stopPropagation();
      const pos = getMousePos(e);
      setDrawState({ start: pos, current: pos, points: [pos] });
    },
    [activeTool, getMousePos, annotations, setSelectedId, pushUndo, setAnnotations, onTextMicStart, setEditingNoteId, setActiveTool, openTextEditor],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Eraser hover highlight
      if (activeTool === 'eraser') {
        const target = e.target as SVGElement;
        const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id');
        setEraserHoverId(shapeId ?? null);
      }

      // Handle connector bend drag.
      if (connectorDragState) {
        e.preventDefault();
        const pos = getMousePos(e);
        const dx = pos.x - connectorDragState.startMouse.x;
        const dy = pos.y - connectorDragState.startMouse.y;
        if (!connectorUndoPushedRef.current && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          pushUndo();
          connectorUndoPushedRef.current = true;
          didDragRef.current = true;
        }
        const projected = dx * connectorDragState.normal.x + dy * connectorDragState.normal.y;
        const nextBend = Math.max(-220, Math.min(220, connectorDragState.startBend + projected));
        setAnnotations((prev) =>
          prev.map((shape) => {
            if (shape.id !== connectorDragState.textId || shape.type !== 'text') return shape;
            return {
              ...shape,
              labelMode: 'manual',
              connector: {
                ...(shape.connector ?? {}),
                mode: 'manual',
                bend: nextBend,
              },
            };
          }),
        );
        return;
      }

      // Handle shape drag move.
      if (dragState) {
        e.preventDefault();
        const pos = getMousePos(e);
        const dx = pos.x - dragState.startMouse.x;
        const dy = pos.y - dragState.startMouse.y;
        if (!dragUndoPushedRef.current && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          pushUndo();
          dragUndoPushedRef.current = true;
          didDragRef.current = true;
        }
        const moved = applyDragDelta(dragState.startShapeSnapshot, dx, dy);
        setAnnotations((prev) => {
          const next = prev.map((shape) => (shape.id === dragState.shapeId ? moved : shape));
          if (moved.type !== 'text') {
            return relayoutConnectedLabels({
              annotations: next,
              parentId: moved.id,
              viewport: { width: window.innerWidth, height: window.innerHeight },
            });
          }
          return next;
        });
        return;
      }

      if (!drawState) return;
      e.preventDefault();
      const pos = getMousePos(e);
      setDrawState((prev) =>
        prev
          ? { ...prev, current: pos, points: [...prev.points, pos] }
          : null,
      );
    },
    [activeTool, connectorDragState, dragState, drawState, getMousePos, pushUndo, setAnnotations],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (connectorDragState) {
        setConnectorDragState(null);
        return;
      }
      // End drag
      if (dragState) {
        setDragState(null);
        return;
      }

      if (!drawState) return;
      e.preventDefault();
      const pos = getMousePos(e);

      pushUndo();

      let newShape: AnnotationShape | null = null;
      const id = generateId();
      const color = activeColor;

      switch (activeTool) {
        case 'circle': {
          const dx = pos.x - drawState.start.x;
          const dy = pos.y - drawState.start.y;
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r > 3) {
            newShape = { type: 'circle', id, color, cx: drawState.start.x, cy: drawState.start.y, r };
          }
          break;
        }
        case 'rect': {
          const x = Math.min(drawState.start.x, pos.x);
          const y = Math.min(drawState.start.y, pos.y);
          const w = Math.abs(pos.x - drawState.start.x);
          const h = Math.abs(pos.y - drawState.start.y);
          if (w > 3 && h > 3) {
            newShape = { type: 'rect', id, color, x, y, w, h };
          }
          break;
        }
        case 'arrow':
          newShape = { type: 'arrow', id, color, from: drawState.start, to: pos };
          break;
        case 'line':
          newShape = { type: 'line', id, color, from: drawState.start, to: pos };
          break;
        case 'text':
          newShape = { type: 'text', id, color, x: drawState.start.x, y: drawState.start.y, content: '' };
          break;
        case 'freehand':
          {
            const points = [...drawState.points];
            if (points.length === 0) {
              points.push(drawState.start);
            }
            const last = points[points.length - 1];
            if (Math.hypot(pos.x - last.x, pos.y - last.y) > 0.8) {
              points.push(pos);
            }
            if (points.length === 1) {
              points.push({ x: points[0].x + 1.4, y: points[0].y + 1.4 });
            }
            let strokeDistance = 0;
            for (let idx = 1; idx < points.length; idx += 1) {
              strokeDistance += Math.hypot(
                points[idx].x - points[idx - 1].x,
                points[idx].y - points[idx - 1].y,
              );
            }
            if (strokeDistance < 1.2) {
              points[points.length - 1] = {
                x: points[0].x + 1.8,
                y: points[0].y + 1.8,
              };
            }
            newShape = {
              type: 'freehand',
              id,
              color,
              points,
              strokeWidth: freehandWidth,
              lineStyle: freehandStyle,
            };
          }
          break;
        case 'lasso': {
          // Compute bounding box and delegate to lasso capture callback
          if (drawState.points.length >= 3 && onLassoCapture) {
            const pts = drawState.points;
            const minX = Math.min(...pts.map((p) => p.x));
            const maxX = Math.max(...pts.map((p) => p.x));
            const minY = Math.min(...pts.map((p) => p.y));
            const maxY = Math.max(...pts.map((p) => p.y));
            onLassoCapture({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
          }
          setActiveTool('select');
          setDrawState(null);
          return;
        }
      }

      if (newShape) {
        // Prevent the trailing click event from immediately clearing selection/editor
        // after pointer-up shape creation (notably for empty text labels).
        suppressNextClickRef.current = true;
        setAnnotations((prev) => [...prev, newShape]);
        setSelectedId(newShape.id);
        if (newShape.type === 'text') {
          setEditingNoteId(newShape.id);
        } else if (autoMic && onAutoMicStart) {
          // Auto-mic: trigger dictation after non-text shapes
          const placement = placeConnectedLabel({
            parent: newShape,
            annotations: [...annotations, newShape],
            content: '',
            viewport: { width: window.innerWidth, height: window.innerHeight },
            excludeIds: new Set([newShape.id]),
          });
          onAutoMicStart({ x: placement.x, y: placement.y }, newShape.id);
        }
        // After creating an annotation, return to select so users can move/edit immediately.
        setActiveTool('select');
      }

      setDrawState(null);
    },
    [connectorDragState, dragState, drawState, activeTool, activeColor, freehandWidth, freehandStyle, autoMic, annotations, getMousePos, pushUndo, setAnnotations, setSelectedId, setEditingNoteId, setActiveTool, onAutoMicStart, onLassoCapture],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const target = e.target as Element;
      if (target.closest('[data-inline-note-editor="true"]')) {
        return;
      }
      const textEditId = target.closest('[data-text-edit-id]')?.getAttribute('data-text-edit-id');
      if (textEditId) {
        if (!didDragRef.current) {
          openTextEditor(textEditId);
        }
        return;
      }
      if (activeTool !== 'select') return;
      const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id');
      if (shapeId) {
        // Click on a shape selects it. Editing is explicit via text segment click, Enter, or double-click.
        if (!didDragRef.current) {
          const shape = annotations.find((item) => item.id === shapeId);
          if (shape?.type === 'text') {
            setSelectedId(shape.id);
          } else {
            setSelectedId(shapeId);
            setEditingNoteId(null);
          }
        }
      } else {
        // Click on empty space: deselect and close editor
        setSelectedId(null);
        closeEditor(false);
      }
    },
    [activeTool, annotations, setSelectedId, setEditingNoteId, closeEditor],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      const target = e.target as SVGElement;
      const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id');
      if (!shapeId) return;
      const shape = annotations.find((s) => s.id === shapeId);
      if (shape?.type === 'text') {
        e.preventDefault();
        e.stopPropagation();
        openTextEditor(shapeId);
      }
    },
    [activeTool, annotations, openTextEditor],
  );

  // Clear eraser hover when tool changes
  useEffect(() => {
    if (activeTool !== 'eraser') setEraserHoverId(null);
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'grab') return;
    // Grab mode is strictly for moving; it should not leave selection/edit state active.
    setSelectedId(null);
    setEditingNoteId(null);
  }, [activeTool, setSelectedId, setEditingNoteId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTool !== 'select') return;
      if (event.key !== 'Enter') return;
      if (editingNoteId) return;
      if (!selectedId) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const shape = annotations.find((item) => item.id === selectedId);
      if (shape?.type === 'text') {
        event.preventDefault();
        openTextEditor(shape.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTool, annotations, editingNoteId, selectedId, openTextEditor]);

  // Editing note shape
  const editingShape = editingNoteId ? annotations.find((s) => s.id === editingNoteId) : null;

  const cursorStyle =
    connectorDragState || dragState
      ? 'grabbing'
    : activeTool === 'freehand'
      ? PENCIL_CURSOR
      : activeTool === 'eraser'
        ? 'pointer'
      : activeTool === 'grab'
        ? 'grab'
      : activeTool === 'lasso'
          ? 'crosshair'
            : activeTool === 'select'
              ? 'default'
              : 'crosshair';

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Connector lines (behind shapes) */}
      {annotations.map((shape) =>
        shape.type === 'text' && shape.parentId ? (
          <ConnectorLine
            key={`conn_${shape.id}`}
            text={shape}
            annotations={annotations}
            isSelected={shape.id === selectedId}
          />
        ) : null,
      )}

      {/* Rendered annotations */}
      {annotations.map((shape) => (
        <ShapeRenderer
          key={shape.id}
          shape={shape}
          isSelected={shape.id === selectedId}
          isEraserHover={shape.id === eraserHoverId}
          dictatingTextId={dictatingTextId}
          editingNoteId={editingNoteId}
        />
      ))}

      {/* Preview of shape being drawn */}
      {drawState && activeTool !== 'select' && activeTool !== 'grab' && activeTool !== 'eraser' && (
        <DrawPreview
          tool={activeTool}
          drawState={drawState}
          color={activeColor}
          strokeWidth={activeTool === 'freehand' ? freehandWidth : undefined}
          lineStyle={activeTool === 'freehand' ? freehandStyle : undefined}
        />
      )}

      {/* Inline note editor */}
      {editingShape && (
        <InlineNoteEditor
          shape={editingShape}
          onSave={(note) => saveNote(editingShape.id, note)}
          onCancel={() => closeEditor(true)}
          onMicStart={() => {
            if (editingShape.type !== 'text') return;
            onTextMicStart?.(editingShape.id);
          }}
          isRecording={Boolean(
            dictatingTextId &&
            editingShape.type === 'text' &&
            editingShape.id === dictatingTextId,
          )}
        />
      )}
    </svg>
  );
}

function cubicPointAt(
  t: number,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): Point {
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

function ConnectorLine({
  text,
  annotations,
  isSelected,
}: {
  text: TextShape;
  annotations: AnnotationShape[];
  isSelected?: boolean;
}) {
  const parent = annotations.find((s) => s.id === text.parentId);
  if (!parent) return null;
  const connector = buildCurvedConnector({
    parent,
    text,
    annotations,
  });
  const color = parent.color;
  const handlePoint = cubicPointAt(
    0.5,
    connector.from,
    connector.cp1,
    connector.cp2,
    connector.to,
  );
  return (
    <g>
      <path
        d={connector.path}
        stroke="white"
        strokeWidth={3}
        opacity={0.55}
        strokeLinecap="round"
        fill="none"
        style={{ pointerEvents: 'none' }}
      />
      <path
        d={connector.path}
        stroke={color}
        strokeWidth={1.75}
        opacity={0.60}
        strokeLinecap="round"
        fill="none"
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={connector.to.x}
        cy={connector.to.y}
        r={3.2}
        fill={color}
        opacity={0.9}
        stroke="white"
        strokeWidth={0.8}
        style={{ pointerEvents: 'none' }}
      />
      {isSelected && (
        <g data-connector-handle-id={text.id}>
          <circle
            cx={handlePoint.x}
            cy={handlePoint.y}
            r={8}
            fill="transparent"
            style={{ cursor: 'grab', pointerEvents: 'all' }}
          />
          <circle
            cx={handlePoint.x}
            cy={handlePoint.y}
            r={4}
            fill={color}
            opacity={0.95}
            stroke="white"
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      )}
    </g>
  );
}

function InlineNoteEditor({
  shape,
  onSave,
  onCancel,
  onMicStart,
  isRecording,
}: {
  shape: AnnotationShape;
  onSave: (note: string) => void;
  onCancel: () => void;
  onMicStart?: () => void;
  isRecording?: boolean;
}) {
  const isTextShape = shape.type === 'text';
  const pos = getShapeLabelPos(shape);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [value, setValue] = useState(
    isTextShape ? (shape.type === 'text' ? shape.content : '') : (shape.note ?? ''),
  );

  // All text shapes (connected or standalone) use chip metrics for unified layout.
  const chipMetrics = shape.type === 'text'
    ? estimateConnectedLabelMetrics(value || (shape.type === 'text' ? shape.content : '') || ' ')
    : null;

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  let editorX = pos.x;
  let editorY = pos.y - 6;
  if (shape.type === 'text' && chipMetrics) {
    editorX = shape.x - chipMetrics.paddingX - LABEL_MIC_SLOT_W;
    editorY = shape.y - chipMetrics.baselineY;
  }
  const editorWidth = chipMetrics
    ? chipMetrics.width + LABEL_MIC_SLOT_W + LABEL_HANDLE_SLOT_W
    : 220;
  const editorHeight = chipMetrics ? chipMetrics.height : 28;

  const chipEditor = Boolean(chipMetrics);

  return (
    <foreignObject
      x={editorX}
      y={editorY}
      width={editorWidth}
      height={editorHeight}
      data-inline-note-editor="true"
    >
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', position: 'relative' }}>
        {chipEditor ? (
          // Unified chip editor — same layout as display chip: [mic | input | handle]
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'stretch',
              background: 'rgba(255,255,255,0.96)',
              border: '1.5px solid rgba(59,130,246,0.45)',
              borderRadius: 9,
              overflow: 'hidden',
              boxShadow: '0 2px 10px rgba(0,0,0,0.10)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Mic slot — LEFT */}
            <div
              data-text-mic-id={shape.id}
              style={{
                width: LABEL_MIC_SLOT_W,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                cursor: 'pointer',
                borderRight: '1px solid rgba(0,0,0,0.08)',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onMicStart?.();
              }}
            >
              {isRecording ? (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#ef4444',
                    animation: 'pulse 1s infinite',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span style={{ color: 'rgba(0,0,0,0.40)', display: 'inline-flex' }}>
                  <HugeiconsIcon icon={Mic02Icon} size={13} />
                </span>
              )}
            </div>
            {/* Text input */}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSave(value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelledRef.current = true;
                  onCancel();
                }
              }}
              onBlur={() => {
                if (cancelledRef.current) {
                  cancelledRef.current = false;
                  return;
                }
                onSave(value);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                height: '100%',
                border: 'none',
                background: 'transparent',
                color: '#111827',
                padding: '0 8px',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'system-ui, sans-serif',
                caretColor: '#0f172a',
                outline: 'none',
              }}
              placeholder={isTextShape ? 'Type label...' : 'Add note...'}
            />
            {/* Handle slot — RIGHT (drag grip) */}
            <div
              style={{
                width: LABEL_HANDLE_SLOT_W,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid rgba(0,0,0,0.08)',
                background: 'rgba(0,0,0,0.025)',
                flexShrink: 0,
                cursor: 'grab',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width={LABEL_HANDLE_SLOT_W} height={editorHeight} style={{ overflow: 'visible' }}>
                <GripDots centerX={LABEL_HANDLE_SLOT_W / 2} centerY={editorHeight / 2} color="rgba(0,0,0,0.28)" />
              </svg>
            </div>
          </div>
        ) : (
          // Non-text shapes (rect, circle, etc.) — simple note editor
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                onSave(value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelledRef.current = true;
                onCancel();
              }
            }}
            onBlur={() => {
              if (cancelledRef.current) {
                cancelledRef.current = false;
                return;
              }
              onSave(value);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(0,0,0,0.85)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4,
              padding: isRecording ? '2px 6px 2px 18px' : '2px 6px',
              fontSize: 11,
              fontWeight: 400,
              fontFamily: 'system-ui, sans-serif',
              outline: 'none',
            }}
            placeholder="Add note..."
          />
        )}
      </div>
    </foreignObject>
  );
}

function ShapeRenderer({
  shape,
  isSelected,
  isEraserHover,
  dictatingTextId,
  editingNoteId,
}: {
  shape: AnnotationShape;
  isSelected: boolean;
  isEraserHover?: boolean;
  dictatingTextId?: string | null;
  editingNoteId?: string | null;
}) {
  const selectionStroke = isSelected ? 'rgba(96,165,250,0.98)' : undefined;
  const selectionWidth = isSelected ? 2.4 : 0;
  const eraserStyle: React.CSSProperties = isEraserHover
    ? { filter: 'brightness(1.5)', cursor: 'pointer' }
    : {};
  const selectedStyle: React.CSSProperties = isSelected
    ? { filter: 'drop-shadow(0 0 9px rgba(59,130,246,0.55)) drop-shadow(0 0 2px rgba(255,255,255,0.55))' }
    : {};
  const withCursor = (cursor: string): React.CSSProperties => ({
    cursor,
    ...selectedStyle,
    ...eraserStyle,
  });
  const eraserOutline = isEraserHover ? 'rgba(239,68,68,0.6)' : undefined;

  switch (shape.type) {
    case 'circle':
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {isSelected && (
            <circle cx={shape.cx} cy={shape.cy} r={shape.r + 3} stroke={selectionStroke} strokeWidth={selectionWidth} fill="none" strokeDasharray="4 2" />
          )}
          {eraserOutline && (
            <circle cx={shape.cx} cy={shape.cy} r={shape.r + 3} stroke={eraserOutline} strokeWidth={2} fill="none" />
          )}
          <circle cx={shape.cx} cy={shape.cy} r={shape.r} stroke={shape.color} strokeWidth={3} fill="none" opacity={0.85} />
          {shape.note && <NoteLabel x={shape.cx + shape.r + 8} y={shape.cy} text={shape.note} />}
        </g>
      );
    case 'rect':
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {isSelected && (
            <rect x={shape.x - 3} y={shape.y - 3} width={shape.w + 6} height={shape.h + 6} stroke={selectionStroke} strokeWidth={selectionWidth} fill="none" strokeDasharray="4 2" />
          )}
          {eraserOutline && (
            <rect x={shape.x - 3} y={shape.y - 3} width={shape.w + 6} height={shape.h + 6} stroke={eraserOutline} strokeWidth={2} fill="none" />
          )}
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} stroke={shape.color} strokeWidth={3} fill="none" opacity={0.85} />
          {shape.note && <NoteLabel x={shape.x + shape.w + 8} y={shape.y + 12} text={shape.note} />}
        </g>
      );
    case 'arrow': {
      const dx = shape.to.x - shape.from.x;
      const dy = shape.to.y - shape.from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      let arrowHead = null;
      if (len > 0) {
        const ux = dx / len;
        const uy = dy / len;
        const hl = Math.min(14, len * 0.3);
        const lx = shape.to.x - hl * (ux + uy * 0.4);
        const ly = shape.to.y - hl * (uy - ux * 0.4);
        const rx = shape.to.x - hl * (ux - uy * 0.4);
        const ry = shape.to.y - hl * (uy + ux * 0.4);
        arrowHead = (
          <polygon points={`${shape.to.x},${shape.to.y} ${lx},${ly} ${rx},${ry}`} fill={shape.color} opacity={0.85} />
        );
      }
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {isSelected && (
            <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={selectionStroke} strokeWidth={6.2} opacity={0.32} strokeDasharray="6 3" />
          )}
          {eraserOutline && (
            <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={eraserOutline} strokeWidth={8} opacity={0.4} />
          )}
          <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={shape.color} strokeWidth={3} opacity={0.85} />
          {arrowHead}
          {shape.note && <NoteLabel x={Math.max(shape.from.x, shape.to.x) + 8} y={(shape.from.y + shape.to.y) / 2} text={shape.note} />}
        </g>
      );
    }
    case 'line':
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {isSelected && (
            <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={selectionStroke} strokeWidth={6.2} opacity={0.32} strokeDasharray="6 3" />
          )}
          {eraserOutline && (
            <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={eraserOutline} strokeWidth={8} opacity={0.4} />
          )}
          <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} stroke={shape.color} strokeWidth={3} opacity={0.85} />
          {shape.note && <NoteLabel x={Math.max(shape.from.x, shape.to.x) + 8} y={(shape.from.y + shape.to.y) / 2} text={shape.note} />}
        </g>
      );
    case 'text': {
      // Unified chip design for both connected (auto-mic) and standalone text labels.
      const metrics = estimateConnectedLabelMetrics(shape.content || ' ');
      const isEditing = editingNoteId === shape.id;
      const textRectX = shape.x - metrics.paddingX;
      const textRectY = shape.y - metrics.baselineY;
      const textWidth = metrics.width;
      const labelX = textRectX - LABEL_MIC_SLOT_W; // chip left edge — mic is leftmost
      const labelW = LABEL_MIC_SLOT_W + textWidth + LABEL_HANDLE_SLOT_W;
      const labelY = textRectY;
      const labelH = metrics.height;
      const micCenterX = labelX + LABEL_MIC_SLOT_W / 2;
      const handleCenterX = labelX + LABEL_MIC_SLOT_W + textWidth + LABEL_HANDLE_SLOT_W / 2;
      const chipCenterY = labelY + labelH / 2;
      const isDictating = Boolean(dictatingTextId && shape.id === dictatingTextId);
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {eraserOutline && (
            <rect
              x={labelX - 3}
              y={labelY - 3}
              width={labelW + 6}
              height={labelH + 6}
              stroke={eraserOutline}
              strokeWidth={2}
              fill="none"
              rx={11}
            />
          )}
          {!isEditing && (
            <>
              {isSelected && (
                <rect
                  x={labelX - 3}
                  y={labelY - 3}
                  width={labelW + 6}
                  height={labelH + 6}
                  stroke={selectionStroke}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="5 2"
                  rx={11}
                />
              )}
              {/* Chip background */}
              <rect
                x={labelX}
                y={labelY}
                width={labelW}
                height={labelH}
                rx={9}
                fill="rgba(255,255,255,0.92)"
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
              {/* Mic slot — LEFT: click to open editor + start dictation */}
              <g data-text-mic-id={shape.id}>
                <rect
                  x={labelX}
                  y={labelY}
                  width={LABEL_MIC_SLOT_W}
                  height={labelH}
                  rx={9}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                />
                {isDictating ? (
                  <circle
                    cx={micCenterX}
                    cy={chipCenterY}
                    r={4}
                    fill="#ef4444"
                    style={{ pointerEvents: 'none' }}
                  />
                ) : (
                  <foreignObject
                    x={micCenterX - 7}
                    y={chipCenterY - 7}
                    width={14}
                    height={14}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.38)' }}>
                      <HugeiconsIcon icon={Mic02Icon} size={13} />
                    </div>
                  </foreignObject>
                )}
              </g>
              {/* Mic / text divider */}
              <line
                x1={labelX + LABEL_MIC_SLOT_W}
                y1={labelY + 6}
                x2={labelX + LABEL_MIC_SLOT_W}
                y2={labelY + labelH - 6}
                stroke="rgba(0,0,0,0.09)"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
              {/* Text area — click to open editor */}
              <rect
                x={labelX + LABEL_MIC_SLOT_W}
                y={labelY}
                width={textWidth}
                height={labelH}
                fill="transparent"
                data-text-edit-toggle-id={shape.id}
                style={{ cursor: 'text' }}
              />
              {/* Text content */}
              <text
                x={shape.x}
                y={shape.y}
                fill="#111827"
                fontSize={13}
                fontWeight={500}
                fontFamily="system-ui, sans-serif"
                opacity={0.88}
                style={{ cursor: 'text', userSelect: 'none', pointerEvents: 'none' }}
              >
                {shape.content || ''}
              </text>
              {/* Text / handle divider */}
              <line
                x1={labelX + LABEL_MIC_SLOT_W + textWidth}
                y1={labelY + 6}
                x2={labelX + LABEL_MIC_SLOT_W + textWidth}
                y2={labelY + labelH - 6}
                stroke="rgba(0,0,0,0.09)"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
              {/* Handle slot — RIGHT: drag grip */}
              <rect
                x={labelX + LABEL_MIC_SLOT_W + textWidth}
                y={labelY}
                width={LABEL_HANDLE_SLOT_W}
                height={labelH}
                rx={9}
                fill="rgba(0,0,0,0.025)"
                style={{ cursor: 'grab' }}
              />
              <GripDots centerX={handleCenterX} centerY={chipCenterY} color="rgba(0,0,0,0.28)" />
            </>
          )}
        </g>
      );
    }
    case 'freehand': {
      if (shape.points.length < 2) return null;
      const d = shape.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      const sw = shape.strokeWidth ?? 3;
      const dashArray = shape.lineStyle === 'dashed' ? '8 4' : undefined;
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {isSelected && (
            <path d={d} stroke={selectionStroke} strokeWidth={sw + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.3} strokeDasharray="6 3" />
          )}
          {eraserOutline && (
            <path d={d} stroke={eraserOutline} strokeWidth={sw + 6} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />
          )}
          <path d={d} stroke={shape.color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} strokeDasharray={dashArray} />
          {shape.note && shape.points.length > 0 && (() => {
            const note = shape.note;
            if (!note) return null;
            let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of shape.points) {
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            }
            return <NoteLabel x={maxX + 8} y={(minY + maxY) / 2} text={note} />;
          })()}
        </g>
      );
    }
    case 'snapshot': {
      const hasMoved = shape.x !== shape.originX || shape.y !== shape.originY;
      return (
        <g data-shape-id={shape.id} style={withCursor(isEraserHover ? 'pointer' : 'grab')}>
          {hasMoved && (
            <rect
              x={shape.originX}
              y={shape.originY}
              width={shape.w}
              height={shape.h}
              fill="white"
              opacity={0.85}
              rx={2}
            />
          )}
          {isSelected && (
            <rect x={shape.x - 4} y={shape.y - 4} width={shape.w + 8} height={shape.h + 8}
              stroke={selectionStroke} strokeWidth={1.8} fill="none" strokeDasharray="5 2" />
          )}
          {eraserOutline && (
            <rect x={shape.x - 3} y={shape.y - 3} width={shape.w + 6} height={shape.h + 6}
              stroke={eraserOutline} strokeWidth={2} fill="none" />
          )}
          {shape.imageDataUrl ? (
            <>
              <image
                href={shape.imageDataUrl}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
              />
              <rect
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                stroke={shape.color}
                strokeWidth={2}
                fill="none"
                opacity={0.7}
                rx={2}
              />
            </>
          ) : (
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              stroke={shape.color}
              strokeWidth={2}
              fill={`${shape.color}18`}
              strokeDasharray="6 3"
              opacity={0.85}
              rx={4}
            />
          )}
          {shape.note && <NoteLabel x={shape.x + shape.w + 8} y={shape.y + 12} text={shape.note} />}
        </g>
      );
    }
  }
}

function NoteLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const display = text.length > 30 ? `${text.slice(0, 30)}...` : text;
  const width = Math.min(display.length * 7 + 8, 220);
  return (
    <g>
      <rect x={x} y={y - 8} width={width} height={16} rx={3} fill="rgba(0,0,0,0.75)" />
      <text x={x + 4} y={y + 4} fill="white" fontSize={11} fontFamily="system-ui, sans-serif">
        {display}
      </text>
    </g>
  );
}

function DrawPreview({
  tool,
  drawState,
  color,
  strokeWidth,
  lineStyle,
}: {
  tool: AnnotationToolType;
  drawState: DrawState;
  color: string;
  strokeWidth?: number;
  lineStyle?: 'solid' | 'dashed';
}) {
  switch (tool) {
    case 'circle': {
      const dx = drawState.current.x - drawState.start.x;
      const dy = drawState.current.y - drawState.start.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      return (
        <circle cx={drawState.start.x} cy={drawState.start.y} r={r} stroke={color} strokeWidth={2} fill="none" opacity={0.5} strokeDasharray="6 3" />
      );
    }
    case 'rect': {
      const x = Math.min(drawState.start.x, drawState.current.x);
      const y = Math.min(drawState.start.y, drawState.current.y);
      const w = Math.abs(drawState.current.x - drawState.start.x);
      const h = Math.abs(drawState.current.y - drawState.start.y);
      return (
        <rect x={x} y={y} width={w} height={h} stroke={color} strokeWidth={2} fill="none" opacity={0.5} strokeDasharray="6 3" />
      );
    }
    case 'arrow':
    case 'line':
      return (
        <line x1={drawState.start.x} y1={drawState.start.y} x2={drawState.current.x} y2={drawState.current.y} stroke={color} strokeWidth={2} opacity={0.5} strokeDasharray="6 3" />
      );
    case 'freehand': {
      if (drawState.points.length < 2) return null;
      const d = drawState.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      const sw = strokeWidth ?? 3;
      const dashArray = lineStyle === 'dashed' ? '8 4' : undefined;
      return (
        <path d={d} stroke={color} strokeWidth={sw} fill="none" opacity={0.5} strokeLinecap="round" strokeDasharray={dashArray} />
      );
    }
    case 'lasso': {
      if (drawState.points.length < 2) return null;
      const d = drawState.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ') + ' Z';
      return (
        <path d={d} stroke={color} strokeWidth={1.5} fill={`${color}10`} opacity={0.6}
          strokeLinecap="round" strokeDasharray="4 3" />
      );
    }
    default:
      return null;
  }
}
