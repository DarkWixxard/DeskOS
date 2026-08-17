// PiholeService tests against mock Pi-hole APIs (v6 and v5).
//
// Beide Generationen werden mit einem kleinen HTTP-Server nachgebaut, damit die
// Erkennung, die Normalisierung der sehr unterschiedlichen Antwortformate und
// das Schalten des Blockings ohne echten Pi-hole geprüft werden können.
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';
import { PiholeService } from '../src/services/PiholeService';

const PASSWORD = 'geheim';
const SID = 'sid-12345';

interface Mock {
  server: http.Server;
  port: number;
  calls: string[]; // 'METHOD /pfad?query' jedes Aufrufs
  bodies: any[]; // JSON-Bodies der POSTs
  setBlocking: (on: boolean) => void;
}

function listen(server: http.Server, calls: string[], bodies: any[], setBlocking: (on: boolean) => void): Promise<Mock> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, calls, bodies, setBlocking });
    });
  });
}

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

/** Liest den kompletten Request-Body als JSON (leer -> {}). */
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

/** Pi-hole v6: FTL-REST unter /api, Session per X-FTL-SID. */
function startMockV6(opts: { requireSid?: boolean } = {}): Promise<Mock> {
  const calls: string[] = [];
  const bodies: any[] = [];
  let blocking = true;
  let timer: number | null = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/api/auth') {
      if (req.method === 'DELETE') return json(res, { ok: true });
      const body = await readJson(req);
      if (body.password !== PASSWORD) return json(res, { session: { valid: false } }, 401);
      return json(res, { session: { valid: true, sid: SID, csrf: 'c', validity: 1800 } });
    }

    // Alle übrigen Endpunkte verlangen die Session-ID.
    if (opts.requireSid !== false && req.headers['x-ftl-sid'] !== SID) {
      return json(res, { error: { key: 'unauthorized' } }, 401);
    }

    if (url.pathname === '/api/dns/blocking') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        bodies.push(body);
        blocking = !!body.blocking;
        timer = typeof body.timer === 'number' ? body.timer : null;
        return json(res, { blocking: blocking ? 'enabled' : 'disabled', timer });
      }
      return json(res, { blocking: blocking ? 'enabled' : 'disabled', timer });
    }

    if (url.pathname === '/api/stats/summary') {
      return json(res, {
        queries: {
          total: 12345,
          blocked: 2469,
          percent_blocked: 20,
          unique_domains: 500,
          types: { 'A (IPv4)': 8000, 'AAAA (IPv6)': 4000, HTTPS: 345 },
        },
        clients: { active: 7, total: 19 },
        gravity: { domains_being_blocked: 120000, last_update: 1700000000 },
      });
    }

    if (url.pathname === '/api/stats/top_domains') {
      const blockedList = url.searchParams.get('blocked') === 'true';
      return json(res, {
        domains: blockedList
          ? [{ domain: 'ads.example.com', count: 900 }]
          : [
              { domain: 'github.com', count: 500 },
              { domain: 'anthropic.com', count: 300 },
            ],
      });
    }

    if (url.pathname === '/api/stats/top_clients') {
      return json(res, { clients: [{ ip: '192.168.178.20', name: 'laptop', count: 4000 }] });
    }

    if (url.pathname === '/api/stats/upstreams') {
      return json(res, { upstreams: [{ ip: '1.1.1.1', name: 'cloudflare', count: 900 }] });
    }

    if (url.pathname === '/api/history') {
      return json(res, {
        history: [
          { timestamp: 1700000000, total: 100, blocked: 20, cached: 30, forwarded: 50 },
          { timestamp: 1700000600, total: 140, blocked: 40, cached: 40, forwarded: 60 },
        ],
      });
    }

    return json(res, {}, 404);
  });

  return listen(server, calls, bodies, (on) => {
    blocking = on;
  });
}

/** Pi-hole v5: /admin/api.php, Token als ?auth=. /api/auth existiert nicht (404). */
function startMockV5(): Promise<Mock> {
  const calls: string[] = [];
  const bodies: any[] = [];
  let blocking = true;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push(`${req.method} ${url.pathname}${url.search}`);

    // Entscheidend für die Erkennung: v5 kennt den v6-Endpunkt nicht.
    if (url.pathname === '/api/auth') return json(res, { error: 'not found' }, 404);
    if (url.pathname !== '/admin/api.php') return json(res, {}, 404);

    // v5 antwortet bei falschem Token mit einem leeren Array.
    if (url.searchParams.get('auth') !== PASSWORD) return json(res, []);

    if (url.searchParams.has('summaryRaw')) {
      return json(res, {
        domains_being_blocked: 98000,
        dns_queries_today: 5000,
        ads_blocked_today: 750,
        ads_percentage_today: 15,
        unique_clients: 4,
        gravity_last_updated: { file_exists: true, absolute: 1699990000 },
        status: blocking ? 'enabled' : 'disabled',
      });
    }
    if (url.searchParams.has('enable')) {
      blocking = true;
      return json(res, { status: 'enabled' });
    }
    if (url.searchParams.has('disable')) {
      blocking = false;
      return json(res, { status: 'disabled' });
    }
    if (url.searchParams.has('topItems')) {
      return json(res, {
        top_queries: { 'github.com': 400, 'anthropic.com': 200 },
        top_ads: { 'ads.example.com': 300 },
      });
    }
    if (url.searchParams.has('getQuerySources')) {
      return json(res, { top_sources: { 'laptop|192.168.178.20': 2000 } });
    }
    if (url.searchParams.has('getQueryTypes')) {
      return json(res, { querytypes: { 'A (IPv4)': 65.5, 'AAAA (IPv6)': 34.5 } });
    }
    if (url.searchParams.has('getForwardDestinations')) {
      return json(res, { forward_destinations: { 'cloudflare|1.1.1.1': 88.2 } });
    }
    if (url.searchParams.has('overTimeData10mins')) {
      return json(res, {
        domains_over_time: { '1700000600': 140, '1700000000': 100 },
        ads_over_time: { '1700000600': 40, '1700000000': 20 },
      });
    }
    return json(res, {}, 404);
  });

  return listen(server, calls, bodies, (on) => {
    blocking = on;
  });
}

/** Registry mit installiertem, konfiguriertem Pi-hole-Plugin. */
async function makeRegistry(url: string, password = PASSWORD): Promise<{ registry: PluginRegistry; dbFile: string }> {
  const dbFile = path.join(os.tmpdir(), `descos-pihole-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const registry = new PluginRegistry(new DatabaseService(dbFile));
  await registry.restore();
  await registry.install('pihole');
  await registry.setEnabled('pihole', true);
  await registry.updateSettings('pihole', { url, password });
  return { registry, dbFile };
}

const close = (mock: Mock) => new Promise<void>((r) => mock.server.close(() => r()));
const rm = (f: string) => fs.existsSync(f) && fs.unlinkSync(f);

describe('PiholeService', () => {
  // Ohne hinterlegte URL/Passwort darf nichts nach außen gehen.
  const savedEnv = { url: process.env.PIHOLE_URL, password: process.env.PIHOLE_PASSWORD };
  beforeAll(() => {
    delete process.env.PIHOLE_URL;
    delete process.env.PIHOLE_PASSWORD;
  });
  afterAll(() => {
    if (savedEnv.url) process.env.PIHOLE_URL = savedEnv.url;
    if (savedEnv.password) process.env.PIHOLE_PASSWORD = savedEnv.password;
  });

  test('erkennt v6, meldet sich per SID an und normalisiert die Summary', async () => {
    const mock = await startMockV6();
    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${mock.port}`);
    const service = new PiholeService(registry);

    const status = await service.testConnection();

    expect(status.apiVersion).toBe('v6');
    expect(status.online).toBe(true);
    expect(status.error).toBeNull();
    expect(status.blocking).toBe(true);
    expect(status.queriesToday).toBe(12345);
    expect(status.blockedToday).toBe(2469);
    expect(status.blockedPercent).toBe(20);
    expect(status.domainsOnBlocklist).toBe(120000);
    expect(status.uniqueClients).toBe(7);
    expect(status.gravityLastUpdate).toBe(1700000000 * 1000); // Sekunden -> Millisekunden

    // Der Login lief über /api/auth, danach wurden die Statistiken geholt.
    expect(mock.calls[0]).toBe('POST /api/auth');
    expect(mock.calls.some((c) => c.startsWith('GET /api/stats/summary'))).toBe(true);

    service.stop();
    await close(mock);
    rm(dbFile);
  });

  test('fällt auf v5 zurück, wenn /api/auth fehlt', async () => {
    const mock = await startMockV5();
    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${mock.port}`);
    const service = new PiholeService(registry);

    const status = await service.testConnection();

    expect(status.apiVersion).toBe('v5');
    expect(status.online).toBe(true);
    expect(status.queriesToday).toBe(5000);
    expect(status.blockedToday).toBe(750);
    expect(status.blockedPercent).toBe(15);
    expect(status.domainsOnBlocklist).toBe(98000);
    expect(status.uniqueClients).toBe(4);
    expect(status.blockingTimerSec).toBeNull(); // summaryRaw kennt keine Restzeit
    expect(status.gravityLastUpdate).toBe(1699990000 * 1000);

    // Erst wurde v6 probiert, dann api.php.
    expect(mock.calls[0]).toBe('POST /api/auth');
    expect(mock.calls.some((c) => c.includes('summaryRaw'))).toBe(true);

    service.stop();
    await close(mock);
    rm(dbFile);
  });

  test('v6: setBlocking schickt blocking + timer und zieht den Status nach', async () => {
    const mock = await startMockV6();
    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${mock.port}`);
    const service = new PiholeService(registry);
    await service.testConnection();

    const off = await service.setBlocking(false, 300);
    expect(mock.bodies.at(-1)).toEqual({ blocking: false, timer: 300 });
    expect(off.blocking).toBe(false);
    expect(off.blockingTimerSec).toBe(300);

    const on = await service.setBlocking(true);
    expect(mock.bodies.at(-1)).toEqual({ blocking: true, timer: null });
    expect(on.blocking).toBe(true);

    service.stop();
    await close(mock);
    rm(dbFile);
  });

  test('v5: setBlocking nutzt ?disable=<sek> bzw. ?enable', async () => {
    const mock = await startMockV5();
    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${mock.port}`);
    const service = new PiholeService(registry);
    await service.testConnection();

    const off = await service.setBlocking(false, 300);
    expect(mock.calls.some((c) => c.includes('disable=300'))).toBe(true);
    expect(off.blocking).toBe(false);

    const on = await service.setBlocking(true);
    expect(mock.calls.some((c) => c.includes('enable'))).toBe(true);
    expect(on.blocking).toBe(true);

    service.stop();
    await close(mock);
    rm(dbFile);
  });

  test('normalisiert Detaildaten beider Generationen auf dieselbe Struktur', async () => {
    const v6 = await startMockV6();
    const a = await makeRegistry(`http://127.0.0.1:${v6.port}`);
    const s6 = new PiholeService(a.registry);
    await s6.testConnection();
    const d6 = await s6.getDetails();

    expect(d6.topQueries[0]).toEqual({ name: 'github.com', count: 500 });
    expect(d6.topBlocked[0]).toEqual({ name: 'ads.example.com', count: 900 });
    expect(d6.topClients[0]).toEqual({ name: 'laptop', count: 4000 });
    expect(d6.upstreams[0]).toEqual({ name: 'cloudflare', count: 900 });
    expect(d6.queryTypes[0]).toEqual({ name: 'A (IPv4)', count: 8000 });
    expect(d6.history).toEqual([
      { t: 1700000000 * 1000, total: 100, blocked: 20 },
      { t: 1700000600 * 1000, total: 140, blocked: 40 },
    ]);

    s6.stop();
    await close(v6);
    rm(a.dbFile);

    const v5 = await startMockV5();
    const b = await makeRegistry(`http://127.0.0.1:${v5.port}`);
    const s5 = new PiholeService(b.registry);
    await s5.testConnection();
    const d5 = await s5.getDetails();

    expect(d5.topQueries[0]).toEqual({ name: 'github.com', count: 400 });
    expect(d5.topBlocked[0]).toEqual({ name: 'ads.example.com', count: 300 });
    // "hostname|ip" wird auf den Hostnamen gekürzt.
    expect(d5.topClients[0]).toEqual({ name: 'laptop', count: 2000 });
    expect(d5.upstreams[0]).toEqual({ name: 'cloudflare', count: 88.2 });
    // Der Verlauf kommt unsortiert als Objekt und wird chronologisch geordnet.
    expect(d5.history).toEqual([
      { t: 1700000000 * 1000, total: 100, blocked: 20 },
      { t: 1700000600 * 1000, total: 140, blocked: 40 },
    ]);

    s5.stop();
    await close(v5);
    rm(b.dbFile);
  });

  test('meldet ein abgelehntes Passwort, statt zu werfen', async () => {
    const mock = await startMockV6();
    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${mock.port}`, 'falsch');
    const service = new PiholeService(registry);

    const status = await service.testConnection();
    expect(status.online).toBe(false);
    expect(status.apiVersion).toBe('none');
    expect(status.error).toBeTruthy();
    // Zugangsdaten liegen vor – die UI zeigt also "nicht erreichbar", nicht "nicht eingerichtet".
    expect(status.hasCredentials).toBe(true);

    service.stop();
    await close(mock);
    rm(dbFile);
  });

  test('ein nicht erreichbarer Pi-hole setzt online:false ohne Ausnahme', async () => {
    // Port sofort wieder schließen -> garantiert nichts erreichbar.
    const mock = await startMockV6();
    const port = mock.port;
    await close(mock);

    const { registry, dbFile } = await makeRegistry(`http://127.0.0.1:${port}`);
    const service = new PiholeService(registry);

    const status = await service.testConnection();
    expect(status.online).toBe(false);
    expect(status.error).toBeTruthy();
    // Detailabruf darf ebenfalls nicht werfen, sondern liefert leere Listen.
    await expect(service.getDetails()).resolves.toMatchObject({ topQueries: [], history: [] });

    service.stop();
    rm(dbFile);
  });

  test('ohne hinterlegte Zugangsdaten wird gar nicht erst angefragt', async () => {
    const dbFile = path.join(os.tmpdir(), `descos-pihole-none-${Date.now()}.db`);
    const registry = new PluginRegistry(new DatabaseService(dbFile));
    await registry.restore();
    const service = new PiholeService(registry);

    const status = await service.testConnection();
    expect(status.hasCredentials).toBe(false);
    expect(status.apiVersion).toBe('none');
    expect(status.error).toBeNull();

    service.stop();
    rm(dbFile);
  });
});
