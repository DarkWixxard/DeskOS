// WledService tests against a mock WLED JSON API.
import * as http from 'http';
import type { AddressInfo } from 'net';
import { wledService } from '../src/services/WledService';
import { deviceManager } from '../src/core/DeviceManager';

const EFFECTS = ['Solid', 'Blink', 'Breathe', 'Wipe'];

/** Minimal WLED-like server that remembers the last POSTed state. */
function startMockWled(): Promise<{ server: http.Server; port: number; getState: () => any; lastBody: () => any }> {
  const state: any = { on: false, bri: 0, seg: [{ col: [[255, 255, 255]], fx: 0 }] };
  let lastBody: any = null;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/json/state') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        lastBody = JSON.parse(raw || '{}');
        if (lastBody.on !== undefined) state.on = lastBody.on;
        if (lastBody.bri !== undefined) state.bri = lastBody.bri;
        if (Array.isArray(lastBody.seg) && lastBody.seg[0]) {
          state.seg[0] = { ...state.seg[0], ...lastBody.seg[0] };
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/json') {
      res.end(JSON.stringify({ state, info: { name: 'Mock WLED', ver: '0.14.0', leds: { count: 30 } }, effects: EFFECTS }));
    } else if (req.url === '/json/eff') {
      res.end(JSON.stringify(EFFECTS));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, getState: () => state, lastBody: () => lastBody });
    });
  });
}

describe('WledService', () => {
  test('controls a light and reads back parsed state', async () => {
    const mock = await startMockWled();
    const light = wledService.addLight('Mock-Licht', `127.0.0.1:${mock.port}`);
    expect(light.mode).toBe('manual');

    const updated = await wledService.control(light.id, { on: true, brightness: 50, color: [255, 0, 0], effect: 2 });

    // The mock received a correctly shaped WLED body.
    const body = mock.lastBody();
    expect(body.on).toBe(true);
    expect(body.bri).toBe(128); // round(50/100*255)
    expect(body.seg[0].col[0]).toEqual([255, 0, 0]);
    expect(body.seg[0].fx).toBe(2);

    // The service parsed the resulting state back.
    expect(updated?.online).toBe(true);
    expect(updated?.state?.on).toBe(true);
    expect(updated?.state?.brightness).toBe(50);
    expect(updated?.state?.color).toEqual([255, 0, 0]);
    expect(updated?.state?.effect).toBe(2);
    expect(updated?.state?.effectName).toBe('Breathe');
    expect(updated?.ledCount).toBe(30);

    const effects = await wledService.getEffects(light.id);
    expect(effects).toEqual(EFFECTS);

    // cleanup
    expect(wledService.removeLight(light.id)).toBe(true);
    expect(deviceManager.getDevice(light.id)).toBeNull();
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  test('accepts hex colors and maps brightness', async () => {
    const mock = await startMockWled();
    const light = wledService.addLight('Hex-Licht', `127.0.0.1:${mock.port}`);

    await wledService.control(light.id, { brightness: 100, color: '#00ff00' });
    const body = mock.lastBody();
    expect(body.bri).toBe(255);
    expect(body.on).toBe(true); // brightness implies on
    expect(body.seg[0].col[0]).toEqual([0, 255, 0]);

    wledService.removeLight(light.id);
    await new Promise<void>((r) => mock.server.close(() => r()));
  });
});
