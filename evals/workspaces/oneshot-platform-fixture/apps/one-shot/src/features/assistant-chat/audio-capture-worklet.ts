/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
/**
 * AudioWorklet processor that captures mic audio and posts 16 kHz Float32 PCM
 * chunks to the main thread via MessagePort.
 *
 * Loaded via `audioContext.audioWorklet.addModule(...)`.
 */

// Ambient types for the AudioWorklet global scope
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Post a copy of the samples — the underlying buffer may be reused.
    this.port.postMessage({ pcm: channelData.slice() });
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
