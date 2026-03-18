import { useCallback, useRef, useState } from 'react';

function emitDebugLog(message: string, details?: unknown) {
  void window.appShell.debugLog({ message, details }).catch(() => {
    // Best-effort renderer diagnostics only.
  });
}

function normalizeMicrophoneLabel(rawLabel: string | undefined | null) {
  const trimmed = rawLabel?.trim() || '';
  if (!trimmed) return 'System microphone';
  return (
    trimmed
      .replace(/^default\s*-\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim() || 'System microphone'
  );
}

/**
 * Hook that manages microphone capture via AudioWorklet at 16 kHz,
 * streaming Float32 PCM to the main process over IPC.
 */
export function useAudioCapture() {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const statsRef = useRef({
    samples: 0,
    sumSquares: 0,
    peak: 0,
  });
  const [microphoneLabel, setMicrophoneLabel] = useState('System default microphone');

  const start = useCallback(async (sessionId: string) => {
    statsRef.current = {
      samples: 0,
      sumSquares: 0,
      peak: 0,
    };

    // Request mic access at 16 kHz with browser DSP enabled
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    const track = stream.getAudioTracks()[0] ?? null;
    const trackLabel = normalizeMicrophoneLabel(track?.label);
    setMicrophoneLabel(trackLabel);
    emitDebugLog('dictation.microphone.selected', { label: trackLabel });
    if (track) {
      emitDebugLog('dictation.microphone.track_constraints', track.getConstraints());
      emitDebugLog('dictation.microphone.track_settings', track.getSettings());
      track.onmute = () => emitDebugLog('dictation.microphone.track_muted', { label: track.label || 'unknown' });
      track.onunmute = () => emitDebugLog('dictation.microphone.track_unmuted', { label: track.label || 'unknown' });
      track.onended = () => emitDebugLog('dictation.microphone.track_ended', { label: track.label || 'unknown' });
    }

    const ctx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = ctx;
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    emitDebugLog('dictation.audio_context.state', { state: ctx.state, sampleRate: ctx.sampleRate });

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // Load worklet module and create processor node
    const workletUrl = new URL('./audio-capture-worklet.ts', import.meta.url);
    await ctx.audioWorklet.addModule(workletUrl.href);
    const workletNode = new AudioWorkletNode(ctx, 'audio-capture-processor');
    workletRef.current = workletNode;
    emitDebugLog('dictation.capture.mode', { mode: 'audio-worklet' });

    workletNode.port.onmessage = (event: MessageEvent<{ pcm: Float32Array }>) => {
      const pcm = event.data.pcm;
      if (!pcm || pcm.length === 0) return;

      let peak = statsRef.current.peak;
      let sumSquares = statsRef.current.sumSquares;
      for (let index = 0; index < pcm.length; index += 1) {
        const sample = pcm[index] ?? 0;
        const absSample = Math.abs(sample);
        if (absSample > peak) peak = absSample;
        sumSquares += sample * sample;
      }
      statsRef.current.samples += pcm.length;
      statsRef.current.sumSquares = sumSquares;
      statsRef.current.peak = peak;

      window.appShell.sttSendAudio({ sessionId, pcm: pcm.buffer as ArrayBuffer });
    };

    source.connect(workletNode);
    workletNode.connect(ctx.destination);
  }, []);

  const stop = useCallback(() => {
    const { samples, sumSquares, peak } = statsRef.current;
    if (samples > 0) {
      const rms = Math.sqrt(sumSquares / samples);
      emitDebugLog('dictation.capture.stats', {
        samples,
        durationSec: Number((samples / 16000).toFixed(2)),
        rms: Number(rms.toFixed(5)),
        peak: Number(peak.toFixed(5)),
      });
    } else {
      emitDebugLog('dictation.capture.stats', {
        samples: 0,
        durationSec: 0,
        rms: 0,
        peak: 0,
      });
    }
    workletRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  return { start, stop, microphoneLabel };
}
