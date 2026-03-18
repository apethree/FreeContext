import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type WebviewNavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  currentUrl: string;
  title: string;
  loadError: string | null;
};

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function WebTestPage() {
  const [inputUrl, setInputUrl] = useState('https://example.com');
  const [activeUrl, setActiveUrl] = useState('https://example.com');
  const [webviewNode, setWebviewNode] = useState<Electron.WebviewTag | null>(null);
  const [navState, setNavState] = useState<WebviewNavigationState>({
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    currentUrl: 'https://example.com',
    title: 'Web Test',
    loadError: null,
  });

  const onNavigate = useCallback(() => {
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      setNavState((previous) => ({
        ...previous,
        loadError: 'Enter a valid http(s) URL, e.g. https://example.com',
      }));
      return;
    }

    setNavState((previous) => ({ ...previous, loadError: null }));
    setActiveUrl(normalized);
    setInputUrl(normalized);
  }, [inputUrl]);

  const setWebviewRef = useCallback((node: Element | null) => {
    setWebviewNode((previous) => {
      const next = node as Electron.WebviewTag | null;
      return previous === next ? previous : next;
    });
  }, []);

  const onGoBack = useCallback(() => {
    if (!webviewNode) return;
    if (webviewNode.canGoBack()) webviewNode.goBack();
  }, [webviewNode]);

  const onGoForward = useCallback(() => {
    if (!webviewNode) return;
    if (webviewNode.canGoForward()) webviewNode.goForward();
  }, [webviewNode]);

  const onReload = useCallback(() => {
    webviewNode?.reload();
  }, [webviewNode]);

  useEffect(() => {
    if (!webviewNode) return;

    const syncNavigationState = () => {
      setNavState((previous) => ({
        ...previous,
        canGoBack: webviewNode.canGoBack(),
        canGoForward: webviewNode.canGoForward(),
        currentUrl: webviewNode.getURL() || previous.currentUrl,
      }));
    };

    const handleStart = () => {
      setNavState((previous) => ({ ...previous, isLoading: true, loadError: null }));
      syncNavigationState();
    };

    const handleStop = () => {
      setNavState((previous) => ({ ...previous, isLoading: false }));
      syncNavigationState();
    };

    const handleNavigate = () => {
      syncNavigationState();
      setInputUrl(webviewNode.getURL() || '');
    };

    const handleTitleUpdated = (event: Event) => {
      const detail = event as unknown as { title?: string };
      setNavState((previous) => ({
        ...previous,
        title: detail.title || previous.title,
      }));
    };

    const handleFailLoad = (event: Event) => {
      const detail = event as unknown as { errorDescription?: string; validatedURL?: string };
      setNavState((previous) => ({
        ...previous,
        isLoading: false,
        loadError: detail.errorDescription || 'Failed to load page',
        currentUrl: detail.validatedURL || previous.currentUrl,
      }));
    };

    webviewNode.addEventListener('did-start-loading', handleStart);
    webviewNode.addEventListener('did-stop-loading', handleStop);
    webviewNode.addEventListener('did-navigate', handleNavigate);
    webviewNode.addEventListener('did-navigate-in-page', handleNavigate);
    webviewNode.addEventListener('page-title-updated', handleTitleUpdated);
    webviewNode.addEventListener('did-fail-load', handleFailLoad);

    syncNavigationState();

    return () => {
      webviewNode.removeEventListener('did-start-loading', handleStart);
      webviewNode.removeEventListener('did-stop-loading', handleStop);
      webviewNode.removeEventListener('did-navigate', handleNavigate);
      webviewNode.removeEventListener('did-navigate-in-page', handleNavigate);
      webviewNode.removeEventListener('page-title-updated', handleTitleUpdated);
      webviewNode.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [webviewNode]);

  const statusLabel = useMemo(() => {
    if (navState.isLoading) return 'Loading...';
    if (navState.loadError) return navState.loadError;
    return navState.currentUrl;
  }, [navState.currentUrl, navState.isLoading, navState.loadError]);

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-2 px-2 pb-3 pt-1">
      <div className="rounded-lg border border-border/70 bg-background/70 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGoBack}
            disabled={!navState.canGoBack}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGoForward}
            disabled={!navState.canGoForward}
          >
            Forward
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReload}
          >
            Reload
          </Button>
          <input
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onNavigate();
              }
            }}
            placeholder="https://example.com"
            className="h-9 min-w-[260px] flex-1 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Website URL"
          />
          <Button type="button" size="sm" onClick={onNavigate}>
            Open
          </Button>
        </div>
        <div className="mt-2 truncate text-xs text-muted-foreground" title={statusLabel}>
          {navState.title ? `${navState.title} · ` : ''}
          {statusLabel}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-background">
        {React.createElement('webview', {
          src: activeUrl,
          className: 'h-full w-full',
          allowpopups: 'false',
          ref: setWebviewRef,
        } as Record<string, unknown>)}
      </div>
    </div>
  );
}
