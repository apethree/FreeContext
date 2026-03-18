import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MACHINE_KEY = 'oneshot.settings.machine';
const DEFAULT_WORKSPACE_ROOT = '~/.capzero';

type MachineSettings = {
  fontSize: number;
  workspaceRoot: string;
};

type PersistedMachine = Partial<MachineSettings>;

function normalizeMachine(raw: unknown): MachineSettings {
  const next = (raw && typeof raw === 'object' ? (raw as PersistedMachine) : {}) ?? {};
  const fontSize = typeof next.fontSize === 'number' && Number.isFinite(next.fontSize)
    ? Math.min(16, Math.max(12, Math.round(next.fontSize)))
    : 13;
  const workspaceRoot = typeof next.workspaceRoot === 'string' && next.workspaceRoot.trim()
    ? next.workspaceRoot.trim()
    : DEFAULT_WORKSPACE_ROOT;
  return { fontSize, workspaceRoot };
}

export function useMachineSettings() {
  const [machine, setMachine] = useState<MachineSettings>({
    fontSize: 13,
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  });
  const [loading, setLoading] = useState(true);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const raw = await window.appShell.getSetting(MACHINE_KEY);
      if (!mounted) return;
      setMachine(normalizeMachine(raw));
      setLoading(false);
    })().catch(() => {
      if (!mounted) return;
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${machine.fontSize}px`);
  }, [machine.fontSize]);

  useEffect(() => {
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      void window.appShell.setSetting(MACHINE_KEY, machine);
    }, 180);
    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [machine]);

  const setFontSize = useCallback((value: number) => {
    const nextSize = Math.min(16, Math.max(12, Math.round(value)));
    setMachine((previous) => ({ ...previous, fontSize: nextSize }));
  }, []);

  const setWorkspaceRoot = useCallback((value: string) => {
    const trimmed = value.trim() || DEFAULT_WORKSPACE_ROOT;
    setMachine((previous) => ({ ...previous, workspaceRoot: trimmed }));
  }, []);

  return useMemo(
    () => ({
      loading,
      workspaceRoot: machine.workspaceRoot,
      fontSize: machine.fontSize,
      setWorkspaceRoot,
      setFontSize,
    }),
    [loading, machine.fontSize, machine.workspaceRoot, setFontSize, setWorkspaceRoot],
  );
}
