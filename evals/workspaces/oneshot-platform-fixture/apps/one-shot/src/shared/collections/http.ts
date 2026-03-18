import type { SyncTokenGetter } from '@/shared/collections/config';
import { SYNC_BASE_URL } from '@/shared/collections/config';

async function buildAuthHeaders(
  getToken: SyncTokenGetter,
  init?: HeadersInit,
) {
  const headers = new Headers(init);
  const token = await getToken();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return headers;
}

async function readErrorMessage(response: Response) {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return `${response.status} ${response.statusText}`;
    }
    try {
      const parsed = JSON.parse(text) as { error?: string; reason?: string; message?: string };
      return parsed.error || parsed.reason || parsed.message || text;
    } catch {
      return text;
    }
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export async function fetchSyncJson<T>(
  getToken: SyncTokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = await buildAuthHeaders(getToken, init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${SYNC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

export async function fetchSyncVoid(
  getToken: SyncTokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<void> {
  await fetchSyncJson<unknown>(getToken, path, init);
}
