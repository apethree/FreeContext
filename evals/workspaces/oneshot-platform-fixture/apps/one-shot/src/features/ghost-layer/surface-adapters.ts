import {
  resolveBrowserTarget,
  type BrowserSurfaceKind,
  type BrowserTargetAdapter,
} from '@oneshot/annotation-core';
import type { SurfaceAccessMode, SurfaceDescriptor } from '@oneshot/annotation-core/types';

type DocumentTargetResponse = {
  ok: boolean;
  sourceUrl?: string;
  resolvedUrl?: string;
  surface?: string;
  adapter?: string;
  access?: SurfaceAccessMode;
  isEditable?: boolean;
  sessionId?: string | null;
  reason?: string;
  error?: string;
  resourceKey?: string;
  title?: string;
  mimeType?: string;
  fingerprint?: string;
};

export type ResolveSurfaceTargetOptions = {
  useDesktopBridge?: boolean;
  preferOfficeEdit?: boolean;
};

export type SurfaceResolution =
  | { ok: true; value: SurfaceDescriptor }
  | { ok: false; error: string };

const TRACKING_PARAM_EXACT = new Set(['fbclid', 'gclid', 'msclkid']);

function asSurfaceKind(value: string | undefined): BrowserSurfaceKind {
  const surface = (value ?? 'unknown').toLowerCase();
  if (
    surface === 'web' ||
    surface === 'pdf' ||
    surface === 'image' ||
    surface === 'video' ||
    surface === 'audio' ||
    surface === 'markdown' ||
    surface === 'json' ||
    surface === 'csv' ||
    surface === 'text' ||
    surface === 'office'
  ) {
    return surface;
  }
  return 'unknown';
}

function asAdapter(value: string | undefined): BrowserTargetAdapter {
  const adapter = (value ?? 'none').toLowerCase();
  if (
    adapter === 'none' ||
    adapter === 'office-web-viewer' ||
    adapter === 'office-local-edit' ||
    adapter === 'office-local-preview'
  ) {
    return adapter;
  }
  return 'none';
}

function defaultAccess(surface: BrowserSurfaceKind, adapter: BrowserTargetAdapter): SurfaceAccessMode {
  if (adapter === 'office-local-preview') return 'converted';
  if (surface === 'office' || adapter === 'office-web-viewer') return 'read-only';
  return 'editable';
}

function normalizeQuery(searchParams: URLSearchParams): string {
  const entries = [...searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAM_EXACT.has(key.toLowerCase()))
    .sort(([ak, av], [bk, bv]) => {
      if (ak === bk) return av.localeCompare(bv);
      return ak.localeCompare(bk);
    });
  const next = new URLSearchParams();
  for (const [key, value] of entries) next.append(key, value);
  return next.toString();
}

export function computeCanonicalResourceKey(input: Pick<SurfaceDescriptor, 'surface' | 'sourceUrl'>): string {
  const surface = input.surface || 'unknown';
  const rawUrl = input.sourceUrl || '';
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const normalizedQuery = normalizeQuery(parsed.searchParams);
      const pathname = parsed.pathname || '/';
      const query = normalizedQuery ? `?${normalizedQuery}` : '';
      return `${surface}:${parsed.origin}${pathname}${query}`;
    }

    if (parsed.protocol === 'file:') {
      parsed.search = '';
      return `${surface}:${parsed.protocol}//${decodeURI(parsed.pathname)}`;
    }

    parsed.search = '';
    return `${surface}:${parsed.toString()}`;
  } catch {
    return `${surface}:${rawUrl.trim()}`;
  }
}

function toDescriptor(args: {
  sourceUrl: string;
  resolvedUrl: string;
  surface: BrowserSurfaceKind;
  adapter: BrowserTargetAdapter;
  access?: SurfaceAccessMode;
  isEditable?: boolean;
  sessionId?: string | null;
  reason?: string;
  resourceKey?: string;
  title?: string;
  mimeType?: string;
  fingerprint?: string;
}): SurfaceDescriptor {
  const access = args.access ?? defaultAccess(args.surface, args.adapter);
  const descriptor: SurfaceDescriptor = {
    sourceUrl: args.sourceUrl,
    resolvedUrl: args.resolvedUrl,
    surface: args.surface,
    adapter: args.adapter,
    access,
    isEditable: typeof args.isEditable === 'boolean' ? args.isEditable : access === 'editable',
    sessionId: args.sessionId ?? null,
    reason: args.reason,
    resourceKey: args.resourceKey,
    title: args.title,
    mimeType: args.mimeType,
    fingerprint: args.fingerprint,
  };
  descriptor.resourceKey = descriptor.resourceKey || computeCanonicalResourceKey(descriptor);
  return descriptor;
}

async function resolveViaDesktopBridge(
  rawTarget: string,
  preferOfficeEdit: boolean,
): Promise<DocumentTargetResponse> {
  if (preferOfficeEdit) {
    return await window.appShell.openDocumentTarget({ target: rawTarget }) as DocumentTargetResponse;
  }
  return await window.appShell.documentCreateSession({
    pathOrUrl: rawTarget,
    preferEdit: false,
  }) as DocumentTargetResponse;
}

export async function resolveSurfaceTarget(
  rawTarget: string,
  options?: ResolveSurfaceTargetOptions,
): Promise<SurfaceResolution> {
  const useDesktopBridge = options?.useDesktopBridge !== false;
  const preferOfficeEdit = options?.preferOfficeEdit !== false;

  if (useDesktopBridge) {
    try {
      const fromDesktop = await resolveViaDesktopBridge(rawTarget, preferOfficeEdit);
      if (fromDesktop?.ok && fromDesktop.sourceUrl && fromDesktop.resolvedUrl) {
        return {
          ok: true,
          value: toDescriptor({
            sourceUrl: fromDesktop.sourceUrl,
            resolvedUrl: fromDesktop.resolvedUrl,
            surface: asSurfaceKind(fromDesktop.surface),
            adapter: asAdapter(fromDesktop.adapter),
            access: fromDesktop.access,
            isEditable: fromDesktop.isEditable,
            sessionId: fromDesktop.sessionId ?? null,
            reason: fromDesktop.reason,
            resourceKey: fromDesktop.resourceKey,
            title: fromDesktop.title,
            mimeType: fromDesktop.mimeType,
            fingerprint: fromDesktop.fingerprint,
          }),
        };
      }
      if (fromDesktop && !fromDesktop.ok) {
        return { ok: false, error: fromDesktop.error || fromDesktop.reason || 'Unable to open target' };
      }
    } catch {
      // Fall back to local resolver in web mode or if bridge is unavailable.
    }
  }

  const local = resolveBrowserTarget(rawTarget);
  if (!local.ok) {
    return { ok: false, error: local.error };
  }
  return {
    ok: true,
    value: toDescriptor({
      sourceUrl: local.value.canonicalUrl,
      resolvedUrl: local.value.resolvedUrl,
      surface: local.value.surface,
      adapter: local.value.adapter,
    }),
  };
}

export function classifySurfaceUrl(rawUrl: string): SurfaceResolution {
  const resolved = resolveBrowserTarget(rawUrl, { adaptOfficeDocs: false });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  return {
    ok: true,
    value: toDescriptor({
      sourceUrl: resolved.value.canonicalUrl,
      resolvedUrl: resolved.value.resolvedUrl,
      surface: resolved.value.surface,
      adapter: resolved.value.adapter,
    }),
  };
}
