import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { MICROPHONE_PERMISSION_ERROR, getMacMicrophoneAccessStatus, requestMacMicrophoneAccessIfNeeded } from '@/main/microphonePermissions';
import {
  downloadAndExtractModel,
  getModelDir,
  isModelDownloaded,
  type DownloadProgress,
} from '@/main/sttModelDownloader';

// sherpa-onnx-node is a native addon – imported dynamically so the main
// process doesn't crash if the binary isn't present yet.
type SherpaOnnx = typeof import('sherpa-onnx-node');
type SherpaVad = import('sherpa-onnx-node').Vad;
type SherpaOfflineRecognizer = import('sherpa-onnx-node').OfflineRecognizer;

export type SttState = 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error';

export type SttStatus = {
  state: SttState;
  modelDownloaded: boolean;
  detail?: string;
};

let sherpa: SherpaOnnx | null = null;
let recognizer: SherpaOfflineRecognizer | null = null;
let vad: SherpaVad | null = null;
let vadWindowSize = 512;
let state: SttState = 'idle';
let stateDetail: string | undefined;
let activeSessionId: string | null = null;
let readyPromise: Promise<{ ready: boolean; error?: string }> | null = null;
let startupPrewarmStarted = false;

// Plain JS ring buffer replaces sherpa's CircularBuffer which uses
// external (C++-allocated) ArrayBuffers that Electron's V8 disallows.
let pendingSamples: Float32Array = new Float32Array(0);

// Debug-only capture dump (off by default).
const SHOULD_DUMP_DEBUG_AUDIO = (
  process.env.STT_DEBUG_DUMP_AUDIO === '1'
  || process.env.STT_DEBUG_DUMP_AUDIO === 'true'
);
let debugCaptureChunks: Float32Array[] = [];
let debugCaptureLength = 0;

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function setState(next: SttState, detail?: string) {
  state = next;
  stateDetail = detail;
  broadcast('stt:status', { state: next, detail });
}

export function getStatus(): SttStatus {
  return { state, modelDownloaded: isModelDownloaded(), detail: stateDetail };
}

function loadSherpa(): SherpaOnnx {
  if (sherpa) return sherpa;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sherpa = require('sherpa-onnx-node') as SherpaOnnx;
  return sherpa;
}

function createRecognizer(s: SherpaOnnx, modelDir: string) {
  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx'),
        joiner: path.join(modelDir, 'joiner.int8.onnx'),
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
  };
  return new s.OfflineRecognizer(config);
}

function createVad(s: SherpaOnnx, modelDir: string): { vad: SherpaVad; windowSize: number } {
  const sileroVadPath = path.join(modelDir, 'silero_vad.onnx');
  const windowSize = 512;
  const config = {
    sileroVad: {
      model: sileroVadPath,
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: 0.5,
      windowSize,
    },
    sampleRate: 16000,
    debug: false,
    numThreads: 1,
  };
  const bufferSizeInSeconds = 60;
  return {
    vad: new s.Vad(config, bufferSizeInSeconds),
    windowSize,
  };
}

/** Append new samples to the pending buffer. */
function appendSamples(incoming: Float32Array) {
  const merged = new Float32Array(pendingSamples.length + incoming.length);
  merged.set(pendingSamples, 0);
  merged.set(incoming, pendingSamples.length);
  pendingSamples = merged;
}

function resetDebugCaptureBuffer() {
  debugCaptureChunks = [];
  debugCaptureLength = 0;
}

function appendDebugCaptureBuffer(incoming: Float32Array) {
  if (!SHOULD_DUMP_DEBUG_AUDIO) return;
  const copy = new Float32Array(incoming.length);
  copy.set(incoming);
  debugCaptureChunks.push(copy);
  debugCaptureLength += copy.length;
}

function consumeDebugCaptureBuffer(): Float32Array {
  if (debugCaptureLength === 0) return new Float32Array(0);
  const merged = new Float32Array(debugCaptureLength);
  let offset = 0;
  for (const chunk of debugCaptureChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  resetDebugCaptureBuffer();
  return merged;
}

function computeAudioStats(samples: Float32Array) {
  if (samples.length === 0) {
    return { durationSec: 0, peak: 0, rms: 0 };
  }
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > peak) peak = value;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return {
    durationSec: samples.length / 16000,
    peak,
    rms,
  };
}

function dumpCapturedAudio(sessionId: string, samples: Float32Array): string | null {
  if (!SHOULD_DUMP_DEBUG_AUDIO || samples.length === 0) return null;
  try {
    const dir = path.join(os.homedir(), '.oneshot', 'stt-debug');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `${stamp}-${sessionId}.wav`);
    const s = loadSherpa();
    if (typeof s.writeWave !== 'function') return null;
    s.writeWave(filePath, { samples, sampleRate: 16000 });
    return filePath;
  } catch (error) {
    log.warn('[stt] failed to dump debug wav:', error);
    return null;
  }
}

/** Drain completed speech segments from the VAD and decode them. */
function drainVadSegments(sessionId: string): string {
  if (!vad || !recognizer) return '';

  let text = '';
  while (!vad.isEmpty()) {
    // Electron disallows external ArrayBuffers in this process; ask sherpa
    // to return a regular JS-managed buffer.
    const segment = vad.front(false);
    vad.pop();

    // segment.samples may be an external buffer — copy it
    const samples = new Float32Array(segment.samples.length);
    samples.set(segment.samples);

    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);

    if (result.text && result.text.trim().length > 0) {
      const transcript = result.text.trim();
      log.debug('[stt] transcript:', transcript);
      text += (text ? ' ' : '') + transcript;
      broadcast('stt:transcript', {
        sessionId,
        transcript,
        isFinal: true,
      });
    }
  }
  return text;
}

async function ensureMacMicrophonePermission(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'darwin') {
    return { ok: true };
  }

  const status = getMacMicrophoneAccessStatus();
  if (status === 'granted') {
    return { ok: true };
  }

  if (status === 'not-determined') {
    setState('loading', 'Requesting microphone permission...');
    const granted = await requestMacMicrophoneAccessIfNeeded('stt.ensureReady');
    if (granted) {
      return { ok: true };
    }
    setState('error', MICROPHONE_PERMISSION_ERROR);
    return { ok: false, error: MICROPHONE_PERMISSION_ERROR };
  }

  const message = `${MICROPHONE_PERMISSION_ERROR} (status: ${status})`;
  setState('error', message);
  return { ok: false, error: message };
}

async function doEnsureReady(): Promise<{ ready: boolean; error?: string }> {
  try {
    const permission = await ensureMacMicrophonePermission();
    if (!permission.ok) {
      return { ready: false, error: permission.error };
    }

    const modelDir = getModelDir();

    if (!isModelDownloaded()) {
      setState('downloading', 'Downloading dictation model...');
      await downloadAndExtractModel((progress: DownloadProgress) => {
        setState('downloading', `Downloading dictation model... ${progress.percent}%`);
        broadcast('stt:downloadProgress', progress);
      });
    }

    setState('loading', 'Loading dictation engine...');
    const s = loadSherpa();

    // Download silero_vad.onnx if not present alongside the model
    const sileroPath = path.join(modelDir, 'silero_vad.onnx');
    if (!fs.existsSync(sileroPath)) {
      setState('loading', 'Downloading VAD model...');
      log.info('[stt] downloading silero_vad.onnx');
      const resp = await fetch(
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
        { redirect: 'follow' },
      );
      if (!resp.ok || !resp.body) throw new Error(`silero_vad download failed: ${resp.status}`);
      const ab = await resp.arrayBuffer();
      fs.writeFileSync(sileroPath, Buffer.from(ab));
    }

    recognizer = createRecognizer(s, modelDir);
    const newVad = createVad(s, modelDir);
    vad = newVad.vad;
    vadWindowSize = newVad.windowSize;

    setState('ready', 'Dictation ready');
    log.info('[stt] recognizer and VAD ready');
    return { ready: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('[stt] ensureReady failed:', msg);
    setState('error', msg);
    return { ready: false, error: msg };
  }
}

export async function ensureReady(): Promise<{ ready: boolean; error?: string }> {
  if (state === 'ready' || state === 'listening') {
    return { ready: true };
  }

  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = doEnsureReady().finally(() => {
    readyPromise = null;
  });
  return readyPromise;
}

export function prewarmModelInBackground(source = 'app.ready'): void {
  if (startupPrewarmStarted) return;
  startupPrewarmStarted = true;
  if (isModelDownloaded()) {
    log.info('[stt] startup prewarm skipped: model already downloaded');
    return;
  }
  log.info(`[stt] startup prewarm: missing model, starting background init (${source})`);
  void ensureReady().then((result) => {
    if (!result.ready) {
      log.warn(`[stt] startup prewarm failed (${source}): ${result.error ?? 'unknown error'}`);
    }
  });
}

export function startListening(): { sessionId: string } {
  // If already listening, stop the previous session
  if (activeSessionId) {
    cancelListening();
  }

  if (state !== 'ready') {
    throw new Error(`Cannot start listening in state: ${state}`);
  }

  activeSessionId = randomUUID();
  pendingSamples = new Float32Array(0);
  resetDebugCaptureBuffer();
  vad?.reset();
  setState('listening');
  log.info('[stt] listening started, session:', activeSessionId);
  return { sessionId: activeSessionId };
}

export function processAudio(sessionId: string, pcm: Float32Array): void {
  if (sessionId !== activeSessionId || !vad || !recognizer) {
    return;
  }

  const windowSize = vadWindowSize;

  // Copy IPC buffer into JS-heap memory and accumulate
  const copied = new Float32Array(pcm.length);
  copied.set(pcm);
  appendSamples(copied);
  appendDebugCaptureBuffer(copied);

  // Feed complete windows to the VAD
  while (pendingSamples.length >= windowSize) {
    const window = pendingSamples.slice(0, windowSize);
    pendingSamples = pendingSamples.slice(windowSize);
    vad.acceptWaveform(window);
  }

  // Decode any completed speech segments
  drainVadSegments(sessionId);
}

export function stopListening(): { finalTranscript: string } {
  if (!activeSessionId || !vad || !recognizer) {
    activeSessionId = null;
    setState('ready');
    return { finalTranscript: '' };
  }

  const sid = activeSessionId;
  activeSessionId = null;

  // Flush any remaining audio in the VAD
  vad.flush();
  const finalTranscript = drainVadSegments(sid);

  if (SHOULD_DUMP_DEBUG_AUDIO) {
    const capturedSamples = consumeDebugCaptureBuffer();
    const audioStats = computeAudioStats(capturedSamples);
    const debugPath = dumpCapturedAudio(sid, capturedSamples);
    log.info(
      `[stt] debug capture stats session=${sid} samples=${capturedSamples.length} durationSec=${audioStats.durationSec.toFixed(2)} rms=${audioStats.rms.toFixed(5)} peak=${audioStats.peak.toFixed(5)}`,
    );
    if (debugPath) {
      log.info(`[stt] debug audio saved: ${debugPath}`);
    }
  }

  pendingSamples = new Float32Array(0);
  vad.reset();
  setState('ready');
  log.info('[stt] listening stopped, session:', sid);
  return { finalTranscript };
}

export function cancelListening(): void {
  if (!activeSessionId) return;
  const sid = activeSessionId;
  activeSessionId = null;
  pendingSamples = new Float32Array(0);
  resetDebugCaptureBuffer();
  vad?.reset();
  setState('ready');
  log.info('[stt] listening cancelled, session:', sid);
}
