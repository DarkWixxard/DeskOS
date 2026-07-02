'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon } from '@/components/holo';

/* =========================================================================
   DeskOS Terminal

   Vollbild-Terminal (xterm.js). Startet eine echte Shell auf dem Backend-Host
   über node-pty, gestreamt über die bestehende Socket.IO-Verbindung.

   Sicherheit serverseitig: nur aktiv mit DESKOS_TOKEN oder
   DESKOS_TERMINAL_ENABLED=1 (siehe TerminalService).
   ========================================================================= */

type Status = 'connecting' | 'running' | 'exited' | 'disabled' | 'offline';

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'VERBINDE…',
  running: 'RUNNING',
  exited: 'EXITED',
  disabled: 'DEAKTIVIERT',
  offline: 'OFFLINE',
};

const STATUS_COLOR: Record<Status, string> = {
  connecting: 'text-warning border-warning/40',
  running: 'text-success border-success/40',
  exited: 'text-accent/50 border-accent/20',
  disabled: 'text-danger border-danger/40',
  offline: 'text-danger border-danger/40',
};

export function TerminalView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const socket = useDashboardStore((s) => s.socket);
  const wsConnected = useDashboardStore((s) => s.wsConnected);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!socket || !wsConnected) {
      setStatus('offline');
      return;
    }

    const id = (globalThis.crypto?.randomUUID?.() ?? `term-${Date.now()}-${Math.random()}`);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#060a0f',
        foreground: '#c8f5ff',
        cursor: '#00d9ff',
        selectionBackground: 'rgba(0,217,255,0.25)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    const onOutput = (msg: { id: string; data: string }) => {
      if (msg.id === id) term.write(msg.data);
    };
    const onExit = (msg: { id: string; exitCode: number; signal?: number }) => {
      if (msg.id !== id) return;
      setStatus('exited');
      term.write(`\r\n\x1b[90m[Prozess beendet – Code ${msg.exitCode}]\x1b[0m\r\n`);
    };

    socket.on('terminal:output', onOutput);
    socket.on('terminal:exit', onExit);

    socket.emit(
      'terminal:start',
      { id, cols: term.cols, rows: term.rows },
      (resp: { ok: true; pid: number } | { ok: false; error: string }) => {
        if (resp && resp.ok) {
          setStatus('running');
          term.focus();
        } else {
          const error = resp?.error ?? 'Terminal konnte nicht gestartet werden';
          setStatus('disabled');
          setNotice(error);
          term.write(`\x1b[31m${error}\x1b[0m\r\n`);
        }
      }
    );

    const inputSub = term.onData((data) => {
      socket.emit('terminal:input', { id, data });
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { id, cols, rows });
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Container evtl. noch nicht vermessen
      }
    });
    observer.observe(container);

    return () => {
      socket.emit('terminal:stop', { id });
      socket.off('terminal:output', onOutput);
      socket.off('terminal:exit', onExit);
      inputSub.dispose();
      resizeSub.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [socket, wsConnected]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <HoloIcon name="terminal" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Terminal
            </h2>
          </div>
        </div>
        <span className={clsx('rounded-none border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider', STATUS_COLOR[status])}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <Panel>
        {status === 'offline' ? (
          <p className="py-10 text-center text-[12px] text-danger/70">
            Keine Backend-Verbindung – Terminal nicht verfügbar.
          </p>
        ) : (
          <>
            <div ref={containerRef} className="h-[70vh] w-full overflow-hidden bg-[#060a0f] p-2" />
            {notice && <p className="mt-2 text-center text-[11px] text-danger/70">{notice}</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
