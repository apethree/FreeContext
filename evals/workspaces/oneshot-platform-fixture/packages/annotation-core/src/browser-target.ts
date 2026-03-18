export type BrowserSurfaceKind =
  | 'web'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'text'
  | 'office'
  | 'unknown';

export type BrowserTargetAdapter =
  | 'none'
  | 'office-web-viewer'
  | 'office-local-edit'
  | 'office-local-preview';

export type ResolvedBrowserTarget = {
  requested: string;
  canonicalUrl: string;
  resolvedUrl: string;
  protocol: string;
  extension: string | null;
  surface: BrowserSurfaceKind;
  adapter: BrowserTargetAdapter;
};

export type BrowserTargetResolution =
  | { ok: true; value: ResolvedBrowserTarget }
  | { ok: false; error: string };

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'data:', 'blob:', 'about:']);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const JSON_EXTENSIONS = new Set(['json', 'jsonl']);
const CSV_EXTENSIONS = new Set(['csv', 'tsv']);
const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'ods', 'odp']);
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml']);

function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function looksLikeFilesystemPath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//')
  );
}

function getFileExtension(pathname: string): string | null {
  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  const dotIndex = segment.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= segment.length - 1) return null;
  return segment.slice(dotIndex + 1).toLowerCase();
}

function encodePath(pathname: string): string {
  return encodeURI(pathname)
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23');
}

function toFileUrl(inputPath: string): string | null {
  const raw = inputPath.trim();
  if (!raw) return null;

  if (raw.startsWith('~/')) {
    return null;
  }

  if (raw.startsWith('\\\\') || raw.startsWith('//')) {
    const unc = raw
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    return `file://${encodePath(unc)}`;
  }

  let normalized = raw.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = `/${normalized}`;
  }
  if (!normalized.startsWith('/')) return null;
  return `file://${encodePath(normalized)}`;
}

function classifyByExtension(extension: string | null): BrowserSurfaceKind {
  if (!extension) return 'unknown';
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (JSON_EXTENSIONS.has(extension)) return 'json';
  if (CSV_EXTENSIONS.has(extension)) return 'csv';
  if (OFFICE_EXTENSIONS.has(extension)) return 'office';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (extension === 'html' || extension === 'htm' || extension === 'xhtml') return 'web';
  return 'unknown';
}

function classifyDataUrl(rawUrl: string): BrowserSurfaceKind {
  const head = rawUrl.slice(5).split(',')[0] ?? '';
  const mime = (head.split(';')[0] ?? '').toLowerCase();
  if (!mime) return 'unknown';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/markdown') return 'markdown';
  if (mime === 'application/json') return 'json';
  if (mime.includes('csv')) return 'csv';
  if (mime.startsWith('text/')) return 'text';
  if (mime.includes('word') || mime.includes('excel') || mime.includes('powerpoint') || mime.includes('officedocument')) {
    return 'office';
  }
  if (mime.includes('html')) return 'web';
  return 'unknown';
}

function isHttp(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

export function classifyBrowserSurface(rawUrl: string): {
  protocol: string;
  extension: string | null;
  surface: BrowserSurfaceKind;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { protocol: '', extension: null, surface: 'unknown' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'data:') {
    return { protocol, extension: null, surface: classifyDataUrl(rawUrl) };
  }

  const extension = getFileExtension(parsed.pathname);
  const byExtension = classifyByExtension(extension);
  if (byExtension !== 'unknown') {
    return { protocol, extension, surface: byExtension };
  }

  if (isHttp(protocol) || protocol === 'about:' || protocol === 'blob:') {
    return { protocol, extension, surface: 'web' };
  }

  return { protocol, extension, surface: 'unknown' };
}

export function describeBrowserSurface(surface: BrowserSurfaceKind): string {
  switch (surface) {
    case 'web':
      return 'Web page';
    case 'pdf':
      return 'PDF document';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'markdown':
      return 'Markdown';
    case 'json':
      return 'JSON';
    case 'csv':
      return 'Spreadsheet data';
    case 'text':
      return 'Text document';
    case 'office':
      return 'Office document';
    default:
      return 'Unknown surface';
  }
}

export function resolveBrowserTarget(
  rawTarget: string,
  options?: { adaptOfficeDocs?: boolean },
): BrowserTargetResolution {
  const requested = rawTarget.trim();
  if (!requested) {
    return { ok: false, error: 'Enter a URL or local file path.' };
  }

  let candidate = requested;
  if (!hasUrlScheme(requested)) {
    if (looksLikeFilesystemPath(requested)) {
      const fileUrl = toFileUrl(requested);
      if (!fileUrl) {
        return { ok: false, error: 'Could not resolve local path. Use an absolute path or pick a file.' };
      }
      candidate = fileUrl;
    } else {
      candidate = `https://${requested}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Enter a valid URL or local file path.' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    return { ok: false, error: `Unsupported protocol: ${protocol.replace(':', '')}` };
  }

  const canonicalUrl = parsed.toString();
  const classified = classifyBrowserSurface(canonicalUrl);
  let resolvedUrl = canonicalUrl;
  let adapter: BrowserTargetAdapter = 'none';

  if (options?.adaptOfficeDocs !== false && classified.surface === 'office' && isHttp(classified.protocol)) {
    resolvedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(canonicalUrl)}`;
    adapter = 'office-web-viewer';
  }

  return {
    ok: true,
    value: {
      requested,
      canonicalUrl,
      resolvedUrl,
      protocol: classified.protocol,
      extension: classified.extension,
      surface: classified.surface,
      adapter,
    },
  };
}
