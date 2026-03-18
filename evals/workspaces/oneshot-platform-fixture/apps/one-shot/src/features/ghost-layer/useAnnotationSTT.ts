import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioCapture } from '../assistant-chat/useAudioCapture';
import type { Point, TextShape } from '@oneshot/annotation-core/types';
import { placeConnectedLabel } from '@oneshot/annotation-core/label-layout';
import {
  ghostLayerAnnotationsAtom,
  ghostLayerSelectedShapeIdAtom,
  ghostLayerEditingNoteIdAtom,
  ghostLayerStopPhraseAtom,
} from './annotation-state';

type SttState = 'idle' | 'preparing' | 'listening' | 'processing' | 'error';

function generateId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLiveViewport() {
  if (typeof window === 'undefined') {
    return { width: 1920, height: 1080 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStopPhrases(raw: string): string[] {
  const phrases = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return phrases.length > 0 ? phrases : ['done'];
}

function stripStopPhraseSuffix(rawTranscript: string, stopPhrases: string[]) {
  const text = rawTranscript.trim();
  for (const phrase of stopPhrases) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegex(phrase)}[\\s.!?,;:]*$`, 'i');
    if (pattern.test(text)) {
      return {
        cleaned: text.replace(pattern, '').trim(),
        matched: true,
      };
    }
  }
  return { cleaned: text, matched: false };
}

export function useAnnotationSTT() {
  const [annotations, setAnnotations] = useAtom(ghostLayerAnnotationsAtom);
  const selectedId = useAtomValue(ghostLayerSelectedShapeIdAtom);
  const stopPhrase = useAtomValue(ghostLayerStopPhraseAtom);
  const [, setEditingNoteId] = useAtom(ghostLayerEditingNoteIdAtom);
  const { start: startCapture, stop: stopCapture } = useAudioCapture();
  const [sttState, setSttState] = useState<SttState>('idle');
  const sttStateRef = useRef<SttState>('idle');
  const [sttErrorDetail, setSttErrorDetail] = useState<string | null>(null);
  const [lastMicFailureAt, setLastMicFailureAt] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const sessionIdRef = useRef<string | null>(null);
  const textDictationIdRef = useRef<string | null>(null);
  const dictationPrefixRef = useRef('');
  const selectedIdRef = useRef(selectedId);
  const annotationsRef = useRef(annotations);
  const stopPhrasesRef = useRef(normalizeStopPhrases(stopPhrase));
  const stopCaptureRef = useRef(stopCapture);

  // Keep refs in sync
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { stopPhrasesRef.current = normalizeStopPhrases(stopPhrase); }, [stopPhrase]);
  useEffect(() => { stopCaptureRef.current = stopCapture; }, [stopCapture]);

  const updateSttState = useCallback((state: SttState) => {
    sttStateRef.current = state;
    setSttState(state);
  }, []);

  const clearSttError = useCallback(() => {
    setSttErrorDetail(null);
  }, []);

  const setMicError = useCallback((detail: string, context: string) => {
    const message = detail.trim() || 'Microphone failed to start';
    console.debug('[ghost-layer-stt] mic failure', { context, message });
    setSttErrorDetail(message);
    setLastMicFailureAt(Date.now());
    updateSttState('error');
  }, [updateSttState]);

  const cleanTranscript = useCallback((value: string) => {
    return stripStopPhraseSuffix(value, stopPhrasesRef.current).cleaned;
  }, []);

  const joinWithPrefix = useCallback((prefix: string, suffix: string) => {
    const head = prefix.trim();
    const tail = suffix.trim();
    if (!head) return tail;
    if (!tail) return head;
    return `${head} ${tail}`.trim();
  }, []);

  const beginDictationForTextShape = useCallback(
    async (shapeId: string, prefix = '') => {
      if (sttStateRef.current === 'listening') return false;
      textDictationIdRef.current = shapeId;
      dictationPrefixRef.current = prefix;
      setEditingNoteId(shapeId);
      updateSttState('preparing');
      clearSttError();
      setTranscript('');
      try {
        const readyResult = await window.appShell.sttEnsureReady();
        if (!readyResult.ready) {
          setMicError(readyResult.error ?? 'Speech engine is not ready.', 'beginDictation.ensureReady');
          return false;
        }
        const { sessionId } = await window.appShell.sttStartListening();
        sessionIdRef.current = sessionId;
        await startCapture(sessionId);
        updateSttState('listening');
        clearSttError();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMicError(message, 'beginDictation.start');
        return false;
      }
    },
    [setEditingNoteId, startCapture, updateSttState, clearSttError, setMicError],
  );

  // Stable stop function that reads from refs — safe to call from anywhere
  const doStop = useCallback(async () => {
    if (sttStateRef.current !== 'listening') return '';

    updateSttState('processing');
    stopCaptureRef.current();
    const dictatingTextId = textDictationIdRef.current;
    const dictationPrefix = dictationPrefixRef.current;
    textDictationIdRef.current = null;
    dictationPrefixRef.current = '';

    try {
      const { finalTranscript } = await window.appShell.sttStopListening();
      sessionIdRef.current = null;

      if (dictatingTextId) {
        if (finalTranscript) {
          const cleanedText = joinWithPrefix(dictationPrefix, cleanTranscript(finalTranscript));
          setAnnotations((prev) =>
            prev.map((s) => {
              if (s.id !== dictatingTextId || s.type !== 'text') return s;
              return { ...s, content: cleanedText };
            }),
          );
        }
        setEditingNoteId(dictatingTextId);
      } else if (selectedIdRef.current) {
        const sid = selectedIdRef.current;
        const cleanedText = cleanTranscript(finalTranscript);
        let createdTextId: string | null = null;
        setAnnotations((prev) => {
          const parentShape = prev.find((s) => s.id === sid);
          if (!parentShape) return prev;
          const placement = placeConnectedLabel({
            parent: parentShape,
            annotations: prev,
            content: cleanedText,
            viewport: getLiveViewport(),
            excludeIds: new Set([sid]),
          });
          const nextId = generateId();
          createdTextId = nextId;
          const connectorText: TextShape = {
            type: 'text',
            id: nextId,
            color: parentShape.color,
            parentId: sid,
            content: cleanedText,
            x: placement.x,
            y: placement.y,
            labelMode: 'auto',
            connector: { mode: 'auto' },
          };
          return [...prev, connectorText];
        });
        if (createdTextId) {
          setEditingNoteId(createdTextId);
        } else {
          setEditingNoteId(null);
        }
      }

      setTranscript(finalTranscript);
      updateSttState('idle');
      clearSttError();
      return finalTranscript;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMicError(message, 'doStop');
      return '';
    }
  }, [updateSttState, setAnnotations, setEditingNoteId, cleanTranscript, joinWithPrefix, clearSttError, setMicError]);

  // Listen for transcript events from STT
  useEffect(() => {
    const unsubscribe = window.appShell.onSttTranscript((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return;
      setTranscript(payload.transcript);

      // Text dictation mode: update text shape content in real-time
      const textShapeId = textDictationIdRef.current;
      if (textShapeId && payload.transcript) {
        const { cleaned: cleanedText, matched: shouldStop } = stripStopPhraseSuffix(
          payload.transcript,
          stopPhrasesRef.current,
        );
        const mergedText = joinWithPrefix(dictationPrefixRef.current, cleanedText);

        setAnnotations((prev) =>
          prev.map((s) => {
            if (s.id !== textShapeId || s.type !== 'text') return s;
            return { ...s, content: mergedText };
          }),
        );

        if (shouldStop || payload.isFinal) {
          void doStop();
          return;
        }
      }

      if (payload.isFinal) {
        updateSttState('idle');
      }
    });
    return () => unsubscribe();
  }, [setAnnotations, doStop, updateSttState, joinWithPrefix]);

  useEffect(() => {
    const unsubscribe = window.appShell.onSttStatus((payload) => {
      if (payload.state === 'error') {
        setMicError(payload.detail ?? 'Speech recognition error.', 'status-event');
      } else if (payload.state === 'ready' || payload.state === 'idle') {
        clearSttError();
      }
    });
    return () => unsubscribe();
  }, [clearSttError, setMicError]);

  const startRecording = useCallback(async () => {
    if (sttStateRef.current === 'listening') return;

    const selectedShape = selectedIdRef.current
      ? annotationsRef.current.find((shape) => shape.id === selectedIdRef.current)
      : null;
    if (selectedShape?.type === 'text') {
      const existing = selectedShape.content.trim();
      const prefix = existing ? `${existing} ` : '';
      await beginDictationForTextShape(selectedShape.id, prefix);
      return;
    }

    updateSttState('preparing');
    clearSttError();
    setTranscript('');

    try {
      const readyResult = await window.appShell.sttEnsureReady();
      if (!readyResult.ready) {
        setMicError(readyResult.error ?? 'Speech engine is not ready.', 'startRecording.ensureReady');
        return;
      }

      const { sessionId } = await window.appShell.sttStartListening();
      sessionIdRef.current = sessionId;
      await startCapture(sessionId);
      updateSttState('listening');
      clearSttError();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMicError(message, 'startRecording.start');
    }
  }, [startCapture, updateSttState, beginDictationForTextShape, clearSttError, setMicError]);

  const stopRecording = useCallback(async () => {
    return doStop();
  }, [doStop]);

  const cancelRecording = useCallback(async () => {
    if (sttStateRef.current !== 'listening') return;
    stopCaptureRef.current();
    const dictatingTextId = textDictationIdRef.current;
    textDictationIdRef.current = null;
    dictationPrefixRef.current = '';
    try {
      await window.appShell.sttCancelListening();
      sessionIdRef.current = null;
      updateSttState('idle');
      setTranscript('');
      if (dictatingTextId) {
        setEditingNoteId(dictatingTextId);
      }
      clearSttError();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMicError(message, 'cancelRecording');
    }
  }, [updateSttState, clearSttError, setMicError]);

  const startTextDictation = useCallback(
    async (position: Point, parentId?: string) => {
      const id = generateId();
      const parentShape = parentId ? annotations.find((s) => s.id === parentId) : null;
      const parentColor = parentShape?.color ?? '#3b82f6';
      const placement = parentShape
        ? placeConnectedLabel({
            parent: parentShape,
            annotations,
            content: '',
            viewport: getLiveViewport(),
            excludeIds: new Set([parentShape.id]),
          })
        : null;
      setAnnotations((prev) => [
        ...prev,
        {
          type: 'text',
          id,
          color: parentColor,
          x: placement?.x ?? position.x,
          y: placement?.y ?? position.y,
          content: '',
          parentId,
          labelMode: parentId ? 'auto' : undefined,
          connector: parentId ? { mode: 'auto' } : undefined,
        },
      ]);
      await beginDictationForTextShape(id, '');
    },
    [annotations, setAnnotations, beginDictationForTextShape],
  );

  const startTextShapeDictation = useCallback(
    async (shapeId: string) => {
      const shape = annotationsRef.current.find((s) => s.id === shapeId);
      if (!shape || shape.type !== 'text') return;
      const existing = shape.content.trim();
      const prefix = existing ? `${existing} ` : '';
      await beginDictationForTextShape(shapeId, prefix);
    },
    [beginDictationForTextShape],
  );

  const isTextDictating = sttState === 'listening' && textDictationIdRef.current !== null;
  const dictatingTextId = sttState === 'listening' ? textDictationIdRef.current : null;

  return {
    sttState,
    sttErrorDetail,
    lastMicFailureAt,
    transcript,
    startRecording,
    stopRecording,
    cancelRecording,
    startTextDictation,
    startTextShapeDictation,
    isRecording: sttState === 'listening',
    isTextDictating,
    dictatingTextId,
    selectedAnnotation: selectedId
      ? annotations.find((a) => a.id === selectedId)
      : null,
  };
}
