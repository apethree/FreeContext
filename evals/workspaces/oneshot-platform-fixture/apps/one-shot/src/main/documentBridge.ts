import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Store from 'electron-store';
import log from 'electron-log/main';
import {
  resolveBrowserTarget,
  type BrowserSurfaceKind,
  type BrowserTargetAdapter,
} from '@oneshot/annotation-core';
import type { SurfaceAccessMode } from '@oneshot/annotation-core/types';

const OFFICE_EDITABLE_EXTENSIONS = ['docx', 'xlsx', 'pptx'] as const;
const OFFICE_SUPPORTED_EXTENSIONS = [
  ...OFFICE_EDITABLE_EXTENSIONS,
  'doc',
  'xls',
  'ppt',
  'odt',
  'ods',
  'odp',
] as const;

const OFFICE_EXT_SET = new Set<string>(OFFICE_SUPPORTED_EXTENSIONS);
const SETTINGS_ONLYOFFICE_URL_KEY = 'oneshot.ghost-layer.onlyoffice.url';

type OfficeSurfaceAdapter = BrowserTargetAdapter;

type DocumentSession = {
  id: string;
  sourcePath: string;
  sourceUrl: string;
  workingPath: string;
  ext: string;
  createdAt: number;
  sourceMtimeMs: number;
  backupPath: string | null;
  previewPdfPath: string | null;
  reason: string | null;
};

export type DocumentTargetResult =
  | {
      ok: true;
      sourceUrl: string;
      resolvedUrl: string;
      surface: BrowserSurfaceKind;
      adapter: OfficeSurfaceAdapter;
      access: SurfaceAccessMode;
      isEditable: boolean;
      sessionId?: string | null;
      reason?: string;
    }
  | {
      ok: false;
      error: string;
    };

export type DocumentSessionCreateRequest = {
  pathOrUrl: string;
  preferEdit?: boolean;
};

export type DocumentSessionSaveResult =
  | { ok: true; saved: true; backupPath: string | null; conflictDetected: boolean }
  | { ok: false; error: string };

export type DocumentBridgeCapabilities = {
  officeEditing: {
    enabled: boolean;
    available: boolean;
    serverUrl: string | null;
    supportedExtensions: string[];
    reason?: string;
  };
  previewFallback: {
    enabled: boolean;
    converterAvailable: boolean;
    converterCommand: string | null;
  };
};

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getExtension(filePath: string): string {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return ext;
}

function getMimeByExtension(ext: string): string {
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
  if (ext === 'odt') return 'application/vnd.oasis.opendocument.text';
  if (ext === 'ods') return 'application/vnd.oasis.opendocument.spreadsheet';
  if (ext === 'odp') return 'application/vnd.oasis.opendocument.presentation';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeOnlyOfficeUrl(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function toLocalPath(source: string): string | null {
  if (!source) return null;
  if (source.startsWith('file://')) {
    try {
      return fileURLToPath(source);
    } catch {
      return null;
    }
  }
  if (path.isAbsolute(source)) {
    return source;
  }
  return null;
}

function parseJsonBody(request: IncomingMessage, maxBytes = 6 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', (error) => reject(error));
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export class DocumentBridge {
  private readonly store: Store<Record<string, unknown>>;
  private readonly sessions = new Map<string, DocumentSession>();
  private readonly sessionRootDir: string;

  private server: http.Server | null = null;
  private serverPort: number | null = null;
  private converterProbe: { checked: boolean; command: string | null } = { checked: false, command: null };

  constructor(store: Store<Record<string, unknown>>) {
    this.store = store;
    this.sessionRootDir = path.join(os.tmpdir(), 'oneshot-doc-sessions');
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.sessionRootDir, { recursive: true });
    await this.ensureServer();
  }

  async dispose(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.serverPort = null;
  }

  async getCapabilities(): Promise<DocumentBridgeCapabilities> {
    const onlyOfficeUrl = this.getOnlyOfficeServerUrl();
    const converterCommand = await this.detectConverterCommand();
    return {
      officeEditing: {
        enabled: true,
        available: Boolean(onlyOfficeUrl),
        serverUrl: onlyOfficeUrl,
        supportedExtensions: [...OFFICE_SUPPORTED_EXTENSIONS],
        ...(onlyOfficeUrl
          ? {}
          : { reason: `Set ${SETTINGS_ONLYOFFICE_URL_KEY} or ONESHOT_ONLYOFFICE_SERVER_URL to enable integrated Office editing.` }),
      },
      previewFallback: {
        enabled: true,
        converterAvailable: Boolean(converterCommand),
        converterCommand,
      },
    };
  }

  async openDocumentTarget(target: string): Promise<DocumentTargetResult> {
    const resolved = resolveBrowserTarget(target);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const value = resolved.value;
    if (value.surface !== 'office') {
      return {
        ok: true,
        sourceUrl: value.canonicalUrl,
        resolvedUrl: value.resolvedUrl,
        surface: value.surface,
        adapter: value.adapter,
        access: 'editable',
        isEditable: true,
      };
    }

    if (value.protocol === 'file:') {
      return await this.createSession({ pathOrUrl: value.canonicalUrl, preferEdit: true });
    }

    return {
      ok: true,
      sourceUrl: value.canonicalUrl,
      resolvedUrl: value.resolvedUrl,
      surface: value.surface,
      adapter: value.adapter,
      access: 'read-only',
      isEditable: false,
      reason: 'Remote Office files open in read-only viewer mode.',
    };
  }

  async createSession(request: DocumentSessionCreateRequest): Promise<DocumentTargetResult> {
    const resolved = resolveBrowserTarget(request.pathOrUrl, { adaptOfficeDocs: false });
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const value = resolved.value;
    if (value.surface !== 'office') {
      return {
        ok: true,
        sourceUrl: value.canonicalUrl,
        resolvedUrl: value.resolvedUrl,
        surface: value.surface,
        adapter: value.adapter,
        access: 'editable',
        isEditable: true,
      };
    }

    const sourcePath = toLocalPath(value.canonicalUrl);
    if (!sourcePath) {
      return {
        ok: true,
        sourceUrl: value.canonicalUrl,
        resolvedUrl: value.resolvedUrl,
        surface: value.surface,
        adapter: value.adapter,
        access: 'read-only',
        isEditable: false,
        reason: 'Office editing is only supported for local files.',
      };
    }

    const sourceExists = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile();
    if (!sourceExists) {
      return { ok: false, error: `File does not exist: ${sourcePath}` };
    }

    const ext = getExtension(sourcePath);
    if (!OFFICE_EXT_SET.has(ext)) {
      return { ok: false, error: `Unsupported Office extension: .${ext || 'unknown'}` };
    }

    await this.ensureServer();
    const session = await this.createSessionRecord(sourcePath, ext);
    const onlyOfficeUrl = this.getOnlyOfficeServerUrl();
    const preferEdit = request.preferEdit !== false;

    if (onlyOfficeUrl && preferEdit) {
      return {
        ok: true,
        sourceUrl: session.sourceUrl,
        resolvedUrl: this.sessionUrl(session.id, 'editor'),
        surface: 'office',
        adapter: 'office-local-edit',
        access: 'editable',
        isEditable: true,
        sessionId: session.id,
      };
    }

    const convertedPdfPath = await this.convertWorkingCopyToPdf(session);
    if (convertedPdfPath) {
      session.previewPdfPath = convertedPdfPath;
      return {
        ok: true,
        sourceUrl: session.sourceUrl,
        resolvedUrl: pathToFileURL(convertedPdfPath).toString(),
        surface: 'office',
        adapter: 'office-local-preview',
        access: 'converted',
        isEditable: false,
        sessionId: session.id,
        reason: 'Converted to PDF preview because the Office editor is unavailable.',
      };
    }

    const fallbackReason = onlyOfficeUrl
      ? 'Editor unavailable for this file. Showing read-only fallback.'
      : `Set ${SETTINGS_ONLYOFFICE_URL_KEY} to enable integrated Office editing.`;
    session.reason = fallbackReason;
    return {
      ok: true,
      sourceUrl: session.sourceUrl,
      resolvedUrl: this.sessionUrl(session.id, 'fallback'),
      surface: 'office',
      adapter: 'office-local-preview',
      access: 'read-only',
      isEditable: false,
      sessionId: session.id,
      reason: fallbackReason,
    };
  }

  async saveSession(sessionId: string): Promise<DocumentSessionSaveResult> {
    return await this.commitSessionSave(sessionId);
  }

  async closeSession(sessionId: string): Promise<{ ok: boolean; closed: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: true, closed: false };
    this.sessions.delete(sessionId);
    try {
      await fsp.rm(path.dirname(session.workingPath), { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
    return { ok: true, closed: true };
  }

  private getOnlyOfficeServerUrl(): string | null {
    const fromStore = normalizeOnlyOfficeUrl(this.store.get(SETTINGS_ONLYOFFICE_URL_KEY));
    if (fromStore) return fromStore;
    return normalizeOnlyOfficeUrl(process.env.ONESHOT_ONLYOFFICE_SERVER_URL);
  }

  private async detectConverterCommand(): Promise<string | null> {
    if (this.converterProbe.checked) return this.converterProbe.command;
    this.converterProbe.checked = true;
    for (const candidate of ['soffice', 'libreoffice']) {
      const ok = await this.commandExists(candidate);
      if (ok) {
        this.converterProbe.command = candidate;
        return candidate;
      }
    }
    this.converterProbe.command = null;
    return null;
  }

  private async commandExists(command: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command, ['--version'], { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 2_000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private async runCommand(command: string, args: string[], timeoutMs = 40_000): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private async createSessionRecord(sourcePath: string, ext: string): Promise<DocumentSession> {
    const id = randomUUID();
    const sessionDir = path.join(this.sessionRootDir, id);
    await fsp.mkdir(sessionDir, { recursive: true });
    const sourceName = path.basename(sourcePath);
    const safeName = sanitizeFilename(sourceName || `document.${ext || 'bin'}`);
    const workingPath = path.join(sessionDir, safeName);
    await fsp.copyFile(sourcePath, workingPath);
    const sourceStat = await fsp.stat(sourcePath);

    const session: DocumentSession = {
      id,
      sourcePath,
      sourceUrl: pathToFileURL(sourcePath).toString(),
      workingPath,
      ext,
      createdAt: Date.now(),
      sourceMtimeMs: sourceStat.mtimeMs,
      backupPath: null,
      previewPdfPath: null,
      reason: null,
    };
    this.sessions.set(id, session);
    return session;
  }

  private async convertWorkingCopyToPdf(session: DocumentSession): Promise<string | null> {
    const converter = await this.detectConverterCommand();
    if (!converter) return null;

    const outputDir = path.dirname(session.workingPath);
    const convertOk = await this.runCommand(converter, [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      session.workingPath,
    ]);
    if (!convertOk) return null;

    const expectedPdf = path.join(
      outputDir,
      `${path.basename(session.workingPath, path.extname(session.workingPath))}.pdf`,
    );
    if (!fs.existsSync(expectedPdf)) return null;
    return expectedPdf;
  }

  private async commitSessionSave(sessionId: string): Promise<DocumentSessionSaveResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };

    if (!fs.existsSync(session.workingPath)) {
      return { ok: false, error: 'Working document is missing' };
    }

    const conflictDetected = (() => {
      if (!fs.existsSync(session.sourcePath)) return false;
      const currentMtime = fs.statSync(session.sourcePath).mtimeMs;
      return Math.abs(currentMtime - session.sourceMtimeMs) > 1;
    })();

    const backupPath = fs.existsSync(session.sourcePath)
      ? `${session.sourcePath}.oneshot.bak.${Date.now()}`
      : null;
    if (backupPath) {
      try {
        await fsp.copyFile(session.sourcePath, backupPath);
        session.backupPath = backupPath;
      } catch (error) {
        log.warn(`[document-bridge] backup failed for ${session.sourcePath}: ${String(error)}`);
      }
    }

    await fsp.copyFile(session.workingPath, session.sourcePath);
    const updatedStat = await fsp.stat(session.sourcePath);
    session.sourceMtimeMs = updatedStat.mtimeMs;
    return { ok: true, saved: true, backupPath: session.backupPath, conflictDetected };
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.serverPort) return;
    const server = http.createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Document bridge failed to bind localhost port'));
          return;
        }
        resolve(address.port);
      });
    });
    this.server = server;
    this.serverPort = port;
  }

  private sessionUrl(sessionId: string, route: 'editor' | 'file' | 'callback' | 'fallback'): string {
    if (!this.serverPort) {
      throw new Error('Document bridge server not initialized');
    }
    return `http://127.0.0.1:${this.serverPort}/session/${sessionId}/${route}`;
  }

  private buildEditorHtml(session: DocumentSession): string {
    const onlyOfficeUrl = this.getOnlyOfficeServerUrl();
    if (!onlyOfficeUrl) {
      return this.buildFallbackHtml(session, 'OnlyOffice server URL is not configured.');
    }
    const docsApiUrl = `${onlyOfficeUrl}/web-apps/apps/api/documents/api.js`;
    const fileType = session.ext || 'docx';
    const config = {
      document: {
        fileType,
        key: `${session.id}-${session.createdAt}`,
        title: path.basename(session.sourcePath),
        url: this.sessionUrl(session.id, 'file'),
      },
      editorConfig: {
        callbackUrl: this.sessionUrl(session.id, 'callback'),
        mode: 'edit',
        user: {
          id: 'oneshot-user',
          name: 'One Shot',
        },
      },
      type: 'desktop',
    };
    const configJson = JSON.stringify(config);
    const title = escapeHtml(path.basename(session.sourcePath));
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body, #editor-root { width: 100%; height: 100%; margin: 0; padding: 0; background: #0b1020; color: #dbeafe; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .error { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; text-align: center; padding: 24px; box-sizing: border-box; color: #fca5a5; }
    </style>
  </head>
  <body>
    <div id="editor-root"></div>
    <script src="${docsApiUrl}"></script>
    <script>
      (function () {
        var config = ${configJson};
        if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
          document.getElementById('editor-root').innerHTML = '<div class="error">OnlyOffice API failed to load. Check server URL and connectivity.</div>';
          return;
        }
        window.__oneshotEditor = new window.DocsAPI.DocEditor('editor-root', config);
      })();
    </script>
  </body>
</html>`;
  }

  private buildFallbackHtml(session: DocumentSession, reason?: string): string {
    const sourcePath = escapeHtml(session.sourcePath);
    const details = escapeHtml(reason || session.reason || 'No integrated Office editor is currently available.');
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Office Preview Unavailable</title>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; background: #0b1020; color: #dbeafe; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .card { width: min(620px, 92vw); padding: 24px; border-radius: 14px; border: 1px solid rgba(147, 197, 253, 0.25); background: rgba(15, 23, 42, 0.76); }
      h1 { margin: 0 0 10px; font-size: 18px; color: #e0f2fe; }
      p { margin: 8px 0; font-size: 13px; line-height: 1.5; color: rgba(219, 234, 254, 0.85); }
      code { display: block; margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(30, 41, 59, 0.9); color: #93c5fd; font-size: 11px; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Read-only Office fallback</h1>
      <p>${details}</p>
      <p>You can still annotate this session. To enable integrated editing, configure <code>${SETTINGS_ONLYOFFICE_URL_KEY}</code>.</p>
      <code>${sourcePath}</code>
    </div>
  </body>
</html>`;
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const parsed = new URL(request.url || '/', 'http://127.0.0.1');
      if (parsed.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      const match = parsed.pathname.match(/^\/session\/([^/]+)\/([^/]+)$/);
      if (!match) {
        sendJson(response, 404, { ok: false, error: 'Not found' });
        return;
      }

      const sessionId = match[1];
      const route = match[2];
      const session = this.sessions.get(sessionId);
      if (!session) {
        sendJson(response, 404, { ok: false, error: 'Session not found' });
        return;
      }

      if (route === 'editor') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(this.buildEditorHtml(session));
        return;
      }

      if (route === 'fallback') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(this.buildFallbackHtml(session));
        return;
      }

      if (route === 'file') {
        const ext = getExtension(session.workingPath);
        const contentType = getMimeByExtension(ext);
        const fileBuffer = await fsp.readFile(session.workingPath);
        response.writeHead(200, {
          'content-type': contentType,
          'content-length': fileBuffer.byteLength.toString(),
          'cache-control': 'no-store',
        });
        response.end(fileBuffer);
        return;
      }

      if (route === 'callback') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 1, message: 'Method not allowed' });
          return;
        }
        const payload = await parseJsonBody(request);
        const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
        const status = typeof body.status === 'number' ? body.status : 0;
        const updatedUrl = typeof body.url === 'string' ? body.url.trim() : '';

        if ((status === 2 || status === 6) && updatedUrl) {
          try {
            const fetched = await fetch(updatedUrl);
            if (fetched.ok) {
              const arrayBuffer = await fetched.arrayBuffer();
              await fsp.writeFile(session.workingPath, Buffer.from(arrayBuffer));
              await this.commitSessionSave(sessionId);
            }
          } catch (error) {
            log.warn(`[document-bridge] callback save failed for session=${sessionId}: ${String(error)}`);
            sendJson(response, 200, { error: 1 });
            return;
          }
        }

        sendJson(response, 200, { error: 0 });
        return;
      }

      sendJson(response, 404, { ok: false, error: 'Unknown route' });
    } catch (error) {
      log.warn(`[document-bridge] request handler error: ${String(error)}`);
      sendJson(response, 500, { ok: false, error: 'Internal server error' });
    }
  }
}
