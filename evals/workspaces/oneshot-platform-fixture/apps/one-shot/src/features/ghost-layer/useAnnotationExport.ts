import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import type { AnnotationSessionExportV2 } from '@oneshot/annotation-core/types';
import { serializeSessionV2 } from '@oneshot/annotation-core/serialize';
import {
  ghostLayerAnnotationsAtom,
  ghostLayerAnnotationsByStepAtom,
  ghostLayerAssetsAtom,
  ghostLayerResourcesAtom,
  ghostLayerSessionAtom,
  ghostLayerStepsAtom,
} from './annotation-state';

export function useAnnotationExport() {
  const session = useAtomValue(ghostLayerSessionAtom);
  const resources = useAtomValue(ghostLayerResourcesAtom);
  const steps = useAtomValue(ghostLayerStepsAtom);
  const annotationsByStep = useAtomValue(ghostLayerAnnotationsByStepAtom);
  const assets = useAtomValue(ghostLayerAssetsAtom);
  const activeAnnotations = useAtomValue(ghostLayerAnnotationsAtom);

  const exportAsSessionV2 = useCallback((): AnnotationSessionExportV2 => {
    return serializeSessionV2({
      session,
      resources,
      steps,
      annotationsByStep,
      assets,
    });
  }, [session, resources, steps, annotationsByStep, assets]);

  const exportToChat = useCallback(async () => {
    const payload = exportAsSessionV2();
    const jsonContent = JSON.stringify(payload, null, 2);

    try {
      await window.appShell.pipelineChatSend({
        provider: 'openai',
        runtime: 'auto',
        model: 'gpt-5-mini',
        sessionId: `ghost-layer-${Date.now()}`,
        message: `Ghost Layer session export (v2) with ${payload.steps.length} step(s) across ${payload.resources.length} resource(s):\n\n\`\`\`json\n${jsonContent}\n\`\`\``,
        idempotencyKey: `gl-export-${Date.now()}`,
      });
    } catch {
      await navigator.clipboard.writeText(jsonContent);
    }

    return payload;
  }, [exportAsSessionV2]);

  const hasAnnotations = Object.values(annotationsByStep).some((items) => items.length > 0);

  return {
    annotations: activeAnnotations,
    exportAsSessionV2,
    exportToChat,
    hasAnnotations,
  };
}
