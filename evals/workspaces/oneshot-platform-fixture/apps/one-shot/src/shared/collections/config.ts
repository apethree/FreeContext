export const DEFAULT_SYNC_BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8790'
  : 'https://api.capzero.ai';

export const SYNC_BASE_URL = (import.meta.env.VITE_ONESHOT_API_URL || DEFAULT_SYNC_BASE_URL).trim();

export type SyncTokenGetter = () => string | Promise<string | null> | null;

export function buildSyncAuthHeaders(getToken: () => string, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  const token = getToken().trim();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return headers;
}

async function readError(response: Response) {
  try {
    const data = await response.json() as Record<string, unknown>;
    const reason = typeof data.reason === 'string' ? data.reason : '';
    const error = typeof data.error === 'string' ? data.error : '';
    if (reason) return reason;
    if (error) return error;
  } catch {
    // fall through to text body
  }

  try {
    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // ignore secondary body read failures
  }

  return `${response.status} ${response.statusText}`.trim();
}

export async function syncFetchJson<T>(
  path: string,
  getToken: () => string,
  init: RequestInit = {},
): Promise<T> {
  const headers = buildSyncAuthHeaders(getToken, init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${SYNC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}
