type UiObsLevel = 'debug' | 'info' | 'warn' | 'error';

type UiObsEvent = {
  domain: string;
  action: string;
  phase?: string;
  status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
  level?: UiObsLevel;
  correlationId?: string;
  fingerprint?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
};

const DEDUPE_WINDOW_MS = 1500;
const duplicateWindow = new Map<string, { count: number; lastAtMs: number }>();

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `"${k}":${stableJson(v)}`);
  return `{${entries.join(',')}}`;
}

function buildFingerprint(event: UiObsEvent): string {
  if (event.fingerprint) return event.fingerprint;
  const dataBits = event.data ? stableJson(event.data) : '';
  return `${event.domain}:${event.action}:${event.status ?? ''}:${dataBits}`;
}

export function logUiEvent(event: UiObsEvent) {
  const nowMs = Date.now();
  const fingerprint = buildFingerprint(event);
  const existing = duplicateWindow.get(fingerprint);
  let duplicateCount = 0;

  if (existing && nowMs - existing.lastAtMs <= DEDUPE_WINDOW_MS) {
    existing.count += 1;
    existing.lastAtMs = nowMs;
    duplicateCount = existing.count;
  } else {
    duplicateWindow.set(fingerprint, { count: 0, lastAtMs: nowMs });
  }

  try {
    if (window.appShell?.logEvent) {
      void window.appShell.logEvent({
        ...event,
        fingerprint,
        ...(duplicateCount > 0 ? { duplicateCount } : {}),
      });
      return;
    }
    if (window.appShell?.debugLog) {
      void window.appShell.debugLog({
        message: `${event.domain}.${event.action}`,
        details: {
          ...event,
          fingerprint,
          ...(duplicateCount > 0 ? { duplicateCount } : {}),
        },
      });
    }
  } catch {
    // ignore logging failures in renderer
  }
}

export type { UiObsEvent };
