import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalExitEvent, TerminalOutputEvent } from '@/features/app/types';

export function EmbeddedTerminal({ cwd, visible }: { cwd: string; visible: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string>('');

  useEffect(() => {
    if (!visible || !mountRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, "SF Mono", Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0b1020',
        foreground: '#d1d5db',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(mountRef.current);
    fitAddon.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    let unsubscribeOutput: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;

    void window.appShell.startTerminal({ cwd }).then((session) => {
      sessionRef.current = session.sessionId;
      unsubscribeOutput = window.appShell.onTerminalOutput((payload: TerminalOutputEvent) => {
        if (payload.sessionId !== sessionRef.current) return;
        terminal.write(payload.data);
      });
      unsubscribeExit = window.appShell.onTerminalExit((payload: TerminalExitEvent) => {
        if (payload.sessionId !== sessionRef.current) return;
        terminal.writeln(`\r\n[process exited${payload.code !== null ? `: ${payload.code}` : ''}]`);
      });

      const sendResize = () => {
        if (!terminalRef.current) return;
        const cols = terminalRef.current.cols || 80;
        const rows = terminalRef.current.rows || 24;
        void window.appShell.resizeTerminal({ sessionId: session.sessionId, cols, rows });
      };
      sendResize();

      const handleData = terminal.onData((data) => {
        void window.appShell.writeTerminal({ sessionId: session.sessionId, input: data });
      });

      const observer = new ResizeObserver(() => {
        fitAddon.fit();
        sendResize();
      });
      if (mountRef.current) observer.observe(mountRef.current);

      terminalRef.current?.onResize(sendResize);

      return () => {
        handleData.dispose();
        observer.disconnect();
      };
    });

    return () => {
      unsubscribeOutput?.();
      unsubscribeExit?.();
      if (sessionRef.current) {
        void window.appShell.stopTerminal({ sessionId: sessionRef.current });
      }
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionRef.current = '';
    };
  }, [cwd, visible]);

  return <div ref={mountRef} className="h-full w-full overflow-hidden rounded-xl border border-border/70" />;
}
