// Tests für den Bambu-Cloud-Client + Cloud-Modus-Erkennung (ohne echtes Netzwerk).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as BambuCloud from '../src/services/BambuCloud';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';
import { BambuService } from '../src/services/BambuService';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function jsonResponse(obj: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => obj, text: async () => JSON.stringify(obj) } as unknown as Response;
}

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-bambu-cloud-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe('BambuCloud', () => {
  const realFetch = global.fetch;
  const created: string[] = [];

  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(() => {
    for (const f of created) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  test('mqttHost liefert die regionalen Hosts', () => {
    expect(BambuCloud.mqttHost('global')).toBe('us.mqtt.bambulab.com');
    expect(BambuCloud.mqttHost('china')).toBe('cn.mqtt.bambulab.com');
  });

  test('usernameFromToken liest den username-Claim aus dem JWT', () => {
    expect(BambuCloud.usernameFromToken(jwt({ username: 'u_123456' }))).toBe('u_123456');
    expect(BambuCloud.usernameFromToken('kein-jwt')).toBeNull();
    expect(BambuCloud.usernameFromToken(jwt({ foo: 'bar' }))).toBeNull();
  });

  test('login mit direktem Token liefert status ok', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ accessToken: 'tok-abc' })) as unknown as typeof fetch;
    const r = await BambuCloud.login('global', 'a@b.de', 'pw');
    expect(r).toEqual({ status: 'ok', token: 'tok-abc' });
  });

  test('login mit verifyCode fordert den E-Mail-Code an und meldet verifyCode', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: unknown) => {
      calls.push(String(url));
      if (String(url).includes('/user/login')) return jsonResponse({ loginType: 'verifyCode' });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const r = await BambuCloud.login('global', 'a@b.de', 'pw');
    expect(r).toEqual({ status: 'verifyCode' });
    expect(calls.some((u) => u.includes('/sendemail/code'))).toBe(true);
  });

  test('loginWithCode liefert das Token', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ accessToken: 'tok-xyz' })) as unknown as typeof fetch;
    const r = await BambuCloud.loginWithCode('global', 'a@b.de', '123456');
    expect(r).toEqual({ status: 'ok', token: 'tok-xyz' });
  });

  test('listDevices mappt dev_id auf serial', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ devices: [{ dev_id: '00M09ABC', name: 'A1' }, { dev_id: '', name: 'leer' }] })
    ) as unknown as typeof fetch;
    const devs = await BambuCloud.listDevices('global', 'tok');
    expect(devs).toEqual([{ serial: '00M09ABC', name: 'A1' }]);
  });

  test('BambuService erkennt den Cloud-Modus anhand der gespeicherten Settings', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const db = new DatabaseService(dbFile);
    const reg = new PluginRegistry(db);
    await reg.restore();
    await reg.seedDefaults();
    await reg.install('bambu');
    await reg.updateSettings('bambu', { cloudToken: 'tok', cloudUsername: 'u_1', cloudRegion: 'global', serial: '00M09ABC' });

    const bambu = new BambuService(reg);
    expect(bambu.mode()).toBe('cloud');
    const status = bambu.getStatus();
    expect(status.mode).toBe('cloud');
    expect(status.hasCredentials).toBe(true);
    expect(status.online).toBe(false);
  });
});
