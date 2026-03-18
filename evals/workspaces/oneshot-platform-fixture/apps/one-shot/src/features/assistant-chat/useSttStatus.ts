import { useCallback, useEffect, useMemo, useState } from 'react';

export type SttState = 'idle' | 'downloading' | 'loading' | 'ready' | 'listening' | 'error';

type Snapshot = {
  state: SttState;
  detail?: string;
  modelDownloaded: boolean;
  progressPercent?: number;
};

function normalizeSttState(state: string | undefined): SttState {
  if (state === 'downloading') return 'downloading';
  if (state === 'loading') return 'loading';
  if (state === 'ready') return 'ready';
  if (state === 'listening') return 'listening';
  if (state === 'error') return 'error';
  return 'idle';
}

export function useSttStatus() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    state: 'idle',
    modelDownloaded: false,
  });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let mounted = true;

    void window.appShell.sttGetStatus().then((status) => {
      if (!mounted) return;
      setSnapshot({
        state: status.state,
        modelDownloaded: Boolean(status.modelDownloaded),
        detail: status.detail,
      });
    }).catch(() => {
      // Ignore in web/unsupported runtimes.
    });

    const offStatus = window.appShell.onSttStatus((payload) => {
      if (!mounted) return;
      setSnapshot((previous) => ({
        ...previous,
        state: normalizeSttState(payload.state),
        detail: payload.detail,
        ...(payload.state !== 'downloading' ? { progressPercent: undefined } : {}),
      }));
    });

    const offProgress = window.appShell.onSttDownloadProgress((payload) => {
      if (!mounted) return;
      setSnapshot((previous) => ({
        ...previous,
        state: 'downloading',
        progressPercent: payload.percent,
        detail: `Downloading dictation model... ${payload.percent}%`,
      }));
    });

    return () => {
      mounted = false;
      offStatus();
      offProgress();
    };
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      return await window.appShell.sttEnsureReady();
    } finally {
      setRetrying(false);
    }
  }, []);

  const label = useMemo(() => {
    if (snapshot.state === 'downloading') {
      if (snapshot.detail) return snapshot.detail;
      if (typeof snapshot.progressPercent === 'number') {
        return `Downloading dictation model... ${snapshot.progressPercent}%`;
      }
      return 'Downloading dictation model...';
    }
    if (snapshot.state === 'loading') {
      return snapshot.detail || 'Preparing dictation engine...';
    }
    if (snapshot.state === 'error') {
      return snapshot.detail || 'Dictation failed to initialize. Click Retry.';
    }
    return '';
  }, [snapshot.detail, snapshot.progressPercent, snapshot.state]);

  return {
    state: snapshot.state,
    label,
    visible: snapshot.state === 'downloading' || snapshot.state === 'loading' || snapshot.state === 'error',
    retrying,
    retry,
  };
}
