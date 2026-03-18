import log from 'electron-log/main';

type ObsLevel = 'debug' | 'info' | 'warn' | 'error';

export type MainObsEvent = {
  domain: string;
  action: string;
  phase?: string;
  status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
  level?: ObsLevel;
  correlationId?: string;
  fingerprint?: string;
  durationMs?: number;
  duplicateCount?: number;
  data?: Record<string, unknown>;
};

export type MainObsRecord = {
  ts: string;
  domain: string;
  action: string;
  phase?: string;
  status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
  correlationId?: string;
  fingerprint?: string;
  durationMs?: number;
  duplicateCount?: number;
  data?: Record<string, unknown>;
};

type DuplicateWindow = {
  count: number;
  lastAtMs: number;
};

const REDACT_KEYS = [
  'token',
  'authorization',
  'password',
  'secret',
  'apiKey',
  'refreshToken',
  'accessToken',
];
const DUP_WINDOW_MS = 1500;

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEYS.some((candidate) => lower.includes(candidate.toLowerCase()));
}

function redactValue(value: unknown): unknown {
  if (value === null || typeof value === 'undefined') return value;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactValue);

  const record = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(record)) {
    redacted[key] = shouldRedactKey(key) ? "[REDACTED]" : redactValue(next);
  }
  return redacted;
}

export function createMainObserver(onEmit?: (record: MainObsRecord) => void) {
  const duplicateWindows = new Map<string, DuplicateWindow>();

  return {
    emit(event: MainObsEvent) {
      const nowMs = Date.now();
      const key = `${event.domain}:${event.action}:${event.fingerprint ?? ''}`;
      const existing = duplicateWindows.get(key);

      let duplicateCount = 0;
      if (existing && nowMs - existing.lastAtMs <= DUP_WINDOW_MS) {
        existing.count += 1;
        existing.lastAtMs = nowMs;
        duplicateCount = existing.count;
      } else {
        duplicateWindows.set(key, { count: 0, lastAtMs: nowMs });
      }

      const payload: MainObsRecord = {
        ts: new Date(nowMs).toISOString(),
        domain: event.domain,
        action: event.action,
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.status ? { status: event.status } : {}),
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        ...(event.fingerprint ? { fingerprint: event.fingerprint } : {}),
        ...(typeof event.durationMs === 'number' ? { durationMs: Math.round(event.durationMs) } : {}),
        ...(duplicateCount > 0 ? { duplicateCount } : {}),
        ...(event.duplicateCount ? { duplicateCount: event.duplicateCount } : {}),
        ...(event.data ? { data: redactValue(event.data) as Record<string, unknown> } : {}),
      };
      onEmit?.(payload);

      const line = `[obs] ${JSON.stringify(payload)}`;
      switch (event.level ?? 'info') {
        case 'debug':
          log.debug(line);
          break;
        case 'warn':
          log.warn(line);
          break;
        case 'error':
          log.error(line);
          break;
        default:
          log.info(line);
          break;
      }
    },
  };
}
