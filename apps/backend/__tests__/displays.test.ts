// DisplayService tests: virtual rendering + HTTP push to a mock panel.
import * as http from 'http';
import type { AddressInfo } from 'net';
import { displayService } from '../src/services/DisplayService';
import { deviceManager } from '../src/core/DeviceManager';

/** Minimal panel endpoint that records the last POSTed payload. */
function startMockPanel(): Promise<{ server: http.Server; port: number; lastBody: () => any }> {
  let lastBody: any = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastBody = raw ? JSON.parse(raw) : null;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, lastBody: () => lastBody });
    });
  });
}

describe('DisplayService', () => {
  test('renders a virtual clock panel and previews content', () => {
    const panel = displayService.addPanel({ name: 'Clock-Panel', transport: 'virtual', source: 'clock' });
    expect(panel.transport).toBe('virtual');
    expect(panel.online).toBe(true); // virtual panels are always on-screen
    expect(panel.source).toBe('clock');
    // The backend rendered content immediately (title = time, one date line).
    expect(panel.content?.title).toMatch(/^\d{2}:\d{2}$/);
    expect(panel.content?.lines.length).toBeGreaterThan(0);

    displayService.removePanel(panel.id);
    expect(deviceManager.getDevice(panel.id)).toBeNull();
  });

  test('switches source to text and re-renders', () => {
    const panel = displayService.addPanel({ name: 'Text-Panel', transport: 'virtual', source: 'clock' });
    const updated = displayService.updatePanel(panel.id, { source: 'text', text: 'Hallo\nWelt' });
    expect(updated?.source).toBe('text');
    expect(updated?.content?.title).toBe('Hallo');
    expect(updated?.content?.lines).toEqual(['Welt']);

    displayService.removePanel(panel.id);
  });

  test('pushes the rendered payload to an HTTP panel', async () => {
    const mock = await startMockPanel();
    const panel = displayService.addPanel({
      name: 'HTTP-Panel',
      transport: 'http',
      target: `127.0.0.1:${mock.port}`,
      source: 'text',
    });
    displayService.updatePanel(panel.id, { text: 'PUSH' });

    const controlled = await displayService.control(panel.id, { on: true, brightness: 60 });
    // The mock received a firmware-agnostic payload.
    const body = mock.lastBody();
    expect(body.title).toBe('PUSH');
    expect(body.on).toBe(true);
    expect(body.brightness).toBe(60);
    // A successful push marks the panel online.
    expect(controlled?.online).toBe(true);

    displayService.removePanel(panel.id);
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  test('marks an unreachable HTTP panel offline', async () => {
    const panel = displayService.addPanel({
      name: 'Dead-Panel',
      transport: 'http',
      target: '127.0.0.1:1', // nothing listening
      source: 'clock',
    });
    const controlled = await displayService.control(panel.id, { on: true });
    expect(controlled?.online).toBe(false);

    displayService.removePanel(panel.id);
  });
});
