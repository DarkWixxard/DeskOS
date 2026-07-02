// Tests für den TerminalService (Gating, Spawn-Clamping, Input, Cleanup).
// node-pty ist ein natives Modul und wird hier virtuell gemockt, damit die
// Tests ohne nativen Build laufen.

const spawnMock = jest.fn();
const killMock = jest.fn();
const writeMock = jest.fn();
const resizeMock = jest.fn();

jest.mock(
  'node-pty',
  () => ({
    spawn: (...args: unknown[]) => {
      spawnMock(...args);
      return {
        pid: 4242,
        onData: (_cb: (d: string) => void) => undefined,
        onExit: (_cb: (e: { exitCode: number }) => void) => undefined,
        write: writeMock,
        resize: resizeMock,
        kill: killMock,
      };
    },
  }),
  { virtual: true }
);

import { TerminalService } from '../src/services/TerminalService';

// Minimaler Socket-Stub: sammelt Handler und erlaubt manuelles Auslösen.
function makeSocket(id: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emit = jest.fn();
  const socket = {
    id,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
      return socket;
    },
    emit,
  };
  const trigger = (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  return { socket: socket as any, trigger, emit };
}

describe('TerminalService', () => {
  beforeEach(() => {
    spawnMock.mockClear();
    killMock.mockClear();
    writeMock.mockClear();
    resizeMock.mockClear();
    delete process.env.DESKOS_TOKEN;
    delete process.env.DESKOS_TERMINAL_ENABLED;
  });

  test('verweigert Start, wenn deaktiviert (kein Token, kein Flag)', () => {
    const svc = new TerminalService();
    const { socket, trigger } = makeSocket('s1');
    svc.attach(socket);

    const ack = jest.fn();
    trigger('terminal:start', { id: 't1', cols: 80, rows: 24 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('deaktiviert') });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(svc.sessionCount()).toBe(0);
  });

  test('startet Shell mit geklemmten cols/rows und meldet pid', () => {
    process.env.DESKOS_TERMINAL_ENABLED = '1';
    const svc = new TerminalService();
    const { socket, trigger } = makeSocket('s1');
    svc.attach(socket);

    const ack = jest.fn();
    trigger('terminal:start', { id: 't1', cols: 9999, rows: -5 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true, pid: 4242 });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const opts = spawnMock.mock.calls[0][2] as { cols: number; rows: number };
    expect(opts.cols).toBe(500); // auf Max geklemmt
    expect(opts.rows).toBe(1); // auf Min geklemmt
    expect(svc.sessionCount()).toBe(1);
  });

  test('leitet Input an das passende PTY weiter', () => {
    process.env.DESKOS_TERMINAL_ENABLED = '1';
    const svc = new TerminalService();
    const { socket, trigger } = makeSocket('s1');
    svc.attach(socket);

    trigger('terminal:start', { id: 't1', cols: 80, rows: 24 }, jest.fn());
    trigger('terminal:input', { id: 't1', data: 'ls\n' });

    expect(writeMock).toHaveBeenCalledWith('ls\n');
  });

  test('killAllFor beendet alle Sessions des Sockets', () => {
    process.env.DESKOS_TERMINAL_ENABLED = '1';
    const svc = new TerminalService();
    const { socket, trigger } = makeSocket('s1');
    svc.attach(socket);

    trigger('terminal:start', { id: 't1', cols: 80, rows: 24 }, jest.fn());
    trigger('terminal:start', { id: 't2', cols: 80, rows: 24 }, jest.fn());
    expect(svc.sessionCount()).toBe(2);

    svc.killAllFor('s1');
    expect(killMock).toHaveBeenCalledTimes(2);
    expect(svc.sessionCount()).toBe(0);
  });

  test('Disconnect räumt die Sessions des Sockets auf', () => {
    process.env.DESKOS_TERMINAL_ENABLED = '1';
    const svc = new TerminalService();
    const { socket, trigger } = makeSocket('s1');
    svc.attach(socket);

    trigger('terminal:start', { id: 't1', cols: 80, rows: 24 }, jest.fn());
    expect(svc.sessionCount()).toBe(1);

    trigger('disconnect');
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(svc.sessionCount()).toBe(0);
  });
});
