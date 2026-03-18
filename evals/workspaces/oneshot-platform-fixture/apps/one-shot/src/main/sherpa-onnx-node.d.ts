declare module 'sherpa-onnx-node' {
  interface SileroVadConfig {
    model: string;
    threshold: number;
    minSpeechDuration: number;
    minSilenceDuration: number;
    windowSize: number;
  }

  interface VadConfig {
    sileroVad: SileroVadConfig;
    sampleRate: number;
    debug: boolean;
    numThreads: number;
  }

  interface SpeechSegment {
    samples: Float32Array;
    start: number;
    duration: number;
  }

  class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    config: VadConfig;
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    pop(): void;
    flush(): void;
    reset(): void;
  }

  class CircularBuffer {
    constructor(capacity: number);
    push(samples: Float32Array): void;
    get(startIndex: number, length: number): Float32Array;
    pop(length: number): void;
    size(): number;
    head(): number;
    reset(): void;
  }

  interface OfflineTransducerModelConfig {
    encoder: string;
    decoder: string;
    joiner: string;
  }

  interface OfflineModelConfig {
    transducer?: OfflineTransducerModelConfig;
    tokens: string;
    numThreads: number;
    provider: string;
    debug: number;
    modelType?: string;
  }

  interface FeatConfig {
    sampleRate: number;
    featureDim: number;
  }

  interface OfflineRecognizerConfig {
    featConfig: FeatConfig;
    modelConfig: OfflineModelConfig;
  }

  interface OfflineStream {
    acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void;
  }

  interface RecognitionResult {
    text: string;
    tokens?: string[];
    timestamps?: number[];
  }

  class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    config: OfflineRecognizerConfig;
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): RecognitionResult;
  }

  function readWave(filename: string): { samples: Float32Array; sampleRate: number };
  function writeWave(filename: string, params: { samples: Float32Array; sampleRate: number }): void;
}
