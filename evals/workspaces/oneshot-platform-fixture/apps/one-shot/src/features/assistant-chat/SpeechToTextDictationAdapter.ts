import type { DictationAdapter } from '@assistant-ui/react';

type Unsubscribe = () => void;

/**
 * A DictationAdapter implementation that bridges assistant-ui's dictation
 * primitives with the main-process sherpa-onnx STT engine via IPC.
 *
 * Lifecycle:
 *   listen() → starts mic capture + main-process STT
 *   session.stop() → finalizes + releases mic
 *   session.cancel() → aborts + releases mic
 */
export class SpeechToTextDictationAdapter implements DictationAdapter {
  private startCapture: (sessionId: string) => Promise<void>;
  private stopCapture: () => void;

  constructor(opts: {
    startCapture: (sessionId: string) => Promise<void>;
    stopCapture: () => void;
  }) {
    this.startCapture = opts.startCapture;
    this.stopCapture = opts.stopCapture;
  }

  listen(): DictationAdapter.Session {
    type Status = DictationAdapter.Status;
    type Result = DictationAdapter.Result;

    let status: Status = { type: 'starting' };
    let sessionId: string | null = null;

    const speechStartListeners = new Set<() => void>();
    const speechEndListeners = new Set<(result: Result) => void>();
    const speechListeners = new Set<(result: Result) => void>();
    let unsubTranscript: (() => void) | null = null;
    let speechStarted = false;

    // Start STT asynchronously
    const initPromise = (async () => {
      try {
        const readyResult = await window.appShell.sttEnsureReady();
        if (!readyResult.ready) {
          console.error('[SpeechToTextDictationAdapter] ensureReady failed:', readyResult.error);
          status = { type: 'ended', reason: 'error' };
          return;
        }

        const listenResult = await window.appShell.sttStartListening();
        sessionId = listenResult.sessionId;

        // Subscribe to transcript events
        unsubTranscript = window.appShell.onSttTranscript((payload) => {
          if (payload.sessionId !== sessionId) return;
          console.debug('[dictation] transcript event', {
            sessionId: payload.sessionId,
            transcript: payload.transcript,
            isFinal: payload.isFinal,
          });

          if (!speechStarted) {
            speechStarted = true;
            for (const cb of speechStartListeners) cb();
          }

          const result: Result = {
            transcript: payload.transcript,
            isFinal: payload.isFinal,
          };

          for (const cb of speechListeners) cb(result);

          if (payload.isFinal) {
            for (const cb of speechEndListeners) cb(result);
          }
        });

        // Start mic capture
        await this.startCapture(sessionId);
        status = { type: 'running' };
      } catch (err) {
        console.error('[SpeechToTextDictationAdapter] init failed:', err);
        status = { type: 'ended', reason: 'error' };
      }
    })();

    const session: DictationAdapter.Session = {
      get status() { return status; },

      stop: async () => {
        await initPromise;
        this.stopCapture();
        if (sessionId) {
          const result = await window.appShell.sttStopListening();
          if (result.finalTranscript) {
            const r: Result = { transcript: result.finalTranscript, isFinal: true };
            for (const cb of speechEndListeners) cb(r);
          }
        }
        unsubTranscript?.();
        status = { type: 'ended', reason: 'stopped' };
      },

      cancel: () => {
        this.stopCapture();
        if (sessionId) {
          void window.appShell.sttCancelListening();
        }
        unsubTranscript?.();
        status = { type: 'ended', reason: 'cancelled' };
      },

      onSpeechStart: (callback: () => void): Unsubscribe => {
        speechStartListeners.add(callback);
        return () => speechStartListeners.delete(callback);
      },

      onSpeechEnd: (callback: (result: Result) => void): Unsubscribe => {
        speechEndListeners.add(callback);
        return () => speechEndListeners.delete(callback);
      },

      onSpeech: (callback: (result: Result) => void): Unsubscribe => {
        speechListeners.add(callback);
        return () => speechListeners.delete(callback);
      },
    };

    return session;
  }
}
