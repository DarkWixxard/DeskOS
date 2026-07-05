// Terminal-Service: PTY-Sessions für das Web-Terminal.
//
// Ein PTY pro Terminal-ID (Key `${socket.id}:${terminalId}`), Ausgabe geht nur
// an den besitzenden Socket. Beendet sich der Socket, sterben seine PTYs mit.
//
// Sicherheit: Das Terminal ist eine echte Shell auf dem Host. Es ist nur aktiv,
// wenn Token-Auth läuft (DESKOS_TOKEN gesetzt) oder explizit per
// DESKOS_TERMINAL_ENABLED=1 freigeschaltet wurde – ohne Token spiegelt CORS
// jede Origin und jeder Socket wäre unauthentifiziert.

import * as os from 'os';
import type { Socket } from 'socket.io';
import { authEnabled } from '../api/auth';

// Minimale node-pty-Typen (lazy geladen, s.u.).
interface PtyProcess {
  pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface PtyModule {
  spawn(file: string, args: string[], options: Record<string, unknown>): PtyProcess;
}

const MAX_SESSIONS_PER_SOCKET = 4;

export const terminalEnabled = (): boolean =>
  authEnabled() || (process.env.DESKOS_TERMINAL_ENABLED || '1').trim() === '1';

// node-pty ist ein natives Modul: lazy laden, damit ein fehlgeschlagener Build
// das Backend nicht am Booten hindert (terminal:start meldet dann den Fehler).
let ptyModule: PtyModule | null | undefined;
function loadPty(): PtyModule | null {
  if (ptyModule !== undefined) return ptyModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require('node-pty') as PtyModule;
  } catch (err) {
    console.error('node-pty konnte nicht geladen werden (Terminal deaktiviert):', err);
    ptyModule = null;
  }
  return ptyModule;
}

function defaultShell(): string {
  return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
}

const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

interface StartPayload {
  id?: string;
  cols?: number;
  rows?: number;
}

type StartAck = (resp: { ok: true; pid: number } | { ok: false; error: string }) => void;

export class TerminalService {
  // key = `${socket.id}:${terminalId}`
  private sessions = new Map<string, PtyProcess>();

  /** Registriert alle terminal:*-Handler für einen verbundenen Socket. */
  attach(socket: Socket): void {
    socket.on('terminal:start', (payload: StartPayload, ack?: StartAck) => {
      this.start(socket, payload, ack);
    });

    socket.on('terminal:input', (payload: { id?: string; data?: string }) => {
      if (!payload || typeof payload.id !== 'string' || typeof payload.data !== 'string') return;
      this.sessions.get(this.key(socket.id, payload.id))?.write(payload.data);
    });

    socket.on('terminal:resize', (payload: { id?: string; cols?: number; rows?: number }) => {
      if (!payload || typeof payload.id !== 'string') return;
      const pty = this.sessions.get(this.key(socket.id, payload.id));
      if (!pty) return;
      try {
        pty.resize(clamp(payload.cols, 1, 500, 80), clamp(payload.rows, 1, 500, 24));
      } catch {
        // PTY evtl. schon beendet
      }
    });

    socket.on('terminal:stop', (payload: { id?: string }) => {
      if (!payload || typeof payload.id !== 'string') return;
      this.kill(this.key(socket.id, payload.id));
    });

    socket.on('disconnect', () => {
      this.killAllFor(socket.id);
    });
  }

  private start(socket: Socket, payload: StartPayload, ack?: StartAck): void {
    const fail = (error: string) => {
      if (ack) ack({ ok: false, error });
    };

    if (!terminalEnabled()) {
      return fail('Terminal deaktiviert (DESKOS_TOKEN setzen oder DESKOS_TERMINAL_ENABLED=1)');
    }
    if (!payload || typeof payload.id !== 'string' || !payload.id) {
      return fail('Ungültige Terminal-ID');
    }

    const key = this.key(socket.id, payload.id);
    if (this.sessions.has(key)) return fail('Terminal-ID bereits aktiv');
    if (this.countFor(socket.id) >= MAX_SESSIONS_PER_SOCKET) {
      return fail(`Maximal ${MAX_SESSIONS_PER_SOCKET} Terminals pro Verbindung`);
    }

    const pty = loadPty();
    if (!pty) return fail('node-pty nicht verfügbar (nativer Build fehlgeschlagen?)');

    const id = payload.id;
    let proc: PtyProcess;
    try {
      proc = pty.spawn(defaultShell(), [], {
        name: 'xterm-256color',
        cols: clamp(payload.cols, 1, 500, 80),
        rows: clamp(payload.rows, 1, 500, 24),
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      return fail(`Shell konnte nicht gestartet werden: ${String(err)}`);
    }

    this.sessions.set(key, proc);
    console.log(`Terminal ${id} gestartet (pid ${proc.pid}, socket ${socket.id}, ${this.sessions.size} aktiv)`);

    proc.onData((data) => {
      socket.emit('terminal:output', { id, data });
    });

    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(key);
      socket.emit('terminal:exit', { id, exitCode, signal });
      console.log(`Terminal ${id} beendet (exit ${exitCode}, ${this.sessions.size} aktiv)`);
    });

    if (ack) ack({ ok: true, pid: proc.pid });
  }

  /** Beendet alle PTY-Sessions eines Sockets (Disconnect/Cleanup). */
  killAllFor(socketId: string): void {
    const prefix = `${socketId}:`;
    for (const key of Array.from(this.sessions.keys())) {
      if (key.startsWith(prefix)) this.kill(key);
    }
  }

  /** Anzahl aktiver Sessions (für Tests/Diagnose). */
  sessionCount(): number {
    return this.sessions.size;
  }

  private kill(key: string): void {
    const proc = this.sessions.get(key);
    if (!proc) return;
    this.sessions.delete(key);
    try {
      proc.kill();
    } catch {
      // bereits beendet
    }
  }

  private countFor(socketId: string): number {
    const prefix = `${socketId}:`;
    let n = 0;
    for (const key of this.sessions.keys()) if (key.startsWith(prefix)) n++;
    return n;
  }

  private key(socketId: string, terminalId: string): string {
    return `${socketId}:${terminalId}`;
  }
}

export const terminalService = new TerminalService();
