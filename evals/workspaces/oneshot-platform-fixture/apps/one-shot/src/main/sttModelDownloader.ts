import { execFile } from 'node:child_process';
import fs, { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log/main';

const MODEL_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';
const MODEL_TAR_BZ2 = `${MODEL_NAME}.tar.bz2`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_TAR_BZ2}`;

export function getModelsDir(): string {
  return path.join(os.homedir(), '.oneshot', 'models');
}

export function getModelDir(): string {
  return path.join(getModelsDir(), MODEL_NAME);
}

export function isModelDownloaded(): boolean {
  const modelDir = getModelDir();
  return fs.existsSync(path.join(modelDir, 'encoder.int8.onnx'));
}

export type DownloadProgress = {
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
};

export async function downloadAndExtractModel(
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  const modelsDir = getModelsDir();
  const modelDir = getModelDir();

  if (isModelDownloaded()) {
    log.info('[stt-downloader] model already present at', modelDir);
    return modelDir;
  }

  fs.mkdirSync(modelsDir, { recursive: true });

  const tarBz2Path = path.join(modelsDir, MODEL_TAR_BZ2);
  const tempPath = `${tarBz2Path}.tmp`;

  log.info('[stt-downloader] downloading model from', MODEL_URL);

  const response = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  let bytesDownloaded = 0;
  const reader = response.body.getReader();
  const ws = createWriteStream(tempPath);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.write(value);
      bytesDownloaded += value.byteLength;
      if (contentLength > 0) {
        onProgress({
          percent: Math.round((bytesDownloaded / contentLength) * 100),
          bytesDownloaded,
          bytesTotal: contentLength,
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      ws.end(() => resolve());
      ws.on('error', reject);
    });
  } catch (err) {
    ws.destroy();
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw err;
  }

  fs.renameSync(tempPath, tarBz2Path);
  log.info('[stt-downloader] download complete, extracting…');

  // Use system tar which supports bzip2 on macOS/Linux
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['xjf', tarBz2Path, '-C', modelsDir], (error) => {
      if (error) reject(new Error(`tar extraction failed: ${error.message}`));
      else resolve();
    });
  });

  try { fs.unlinkSync(tarBz2Path); } catch { /* ignore */ }

  if (!isModelDownloaded()) {
    throw new Error('Extraction completed but model files not found');
  }

  log.info('[stt-downloader] model ready at', modelDir);
  return modelDir;
}
