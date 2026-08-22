// Pi-hole Service (DNS-Blocking-Plugin)
//
// Ruft die Statistiken eines Pi-hole im LAN ab und schaltet dessen DNS-Blocking.
// Der Aufruf läuft bewusst über das Backend: Pi-hole liefert keine CORS-Header,
// und so bleibt das App-Passwort serverseitig (siehe PluginRegistry.getSettings,
// das nie über die REST-API herausgegeben wird).
//
// Unterstützt beide API-Generationen und erkennt sie selbst:
//   * v6 – native FTL-REST-API unter /api, Login gegen /api/auth liefert eine
//     Session-ID (SID), die als X-FTL-SID-Header mitgeschickt wird.
//   * v5 – die alte /admin/api.php, bei der das Token als ?auth= angehängt wird.
// Beide Antwortformen werden auf PiholeStatus / PiholeDetails normalisiert, damit
// das Frontend nur eine Struktur kennt.

import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import type { PluginRegistry } from './PluginRegistry';
import type {
  PiholeDetails,
  PiholeHistoryPoint,
  PiholeStatus,
  PiholeTopItem,
} from '@shared/types';

const PLUGIN_ID = 'pihole';
const TOP_COUNT = 10;

type ApiVersion = 'v6' | 'v5' | 'none';

interface Credentials {
  url: string; // normalisiert, ohne abschließenden Slash
  password: string;
}

/** Fehler mit HTTP-Status, damit ein 401 gezielt ein Re-Login auslösen kann. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** Objekt der Form { name: count } in eine absteigend sortierte Top-Liste wandeln. */
function mapToTopItems(obj: unknown): PiholeTopItem[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>)
    .map(([name, count]) => ({ name, count: num(count) }))
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_COUNT);
}

/** Epoch-Sekunden (Pi-hole) in Millisekunden; 0/ungültig -> null. */
const secToMs = (v: unknown): number | null => {
  const s = num(v);
  return s > 0 ? s * 1000 : null;
};

const emptyDetails = (): PiholeDetails => ({
  topQueries: [],
  topBlocked: [],
  topClients: [],
  queryTypes: [],
  upstreams: [],
  history: [],
});

export class PiholeService {
  private readonly registry: PluginRegistry;
  private readonly pollIntervalMs = Number(process.env.PIHOLE_POLL_INTERVAL_MS) || 15000;
  private readonly requestTimeoutMs = Number(process.env.PIHOLE_TIMEOUT_MS) || 4000;
  /** Detaildaten werden nur bei Bedarf geholt und kurz zwischengespeichert. */
  private readonly detailsTtlMs = 20000;

  private pollTimer: NodeJS.Timeout | null = null;
  private apiVersion: ApiVersion = 'none';
  private sid: string | null = null; // nur v6
  private polling = false; // verhindert überlappende Polls bei langsamem Pi-hole

  private status: PiholeStatus = this.emptyStatus();
  private details: PiholeDetails = emptyDetails();
  private detailsFetchedAt = 0;
  private detailsInFlight: Promise<PiholeDetails> | null = null;

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Beim Start pollen und auf Settings-Änderungen reagieren. */
  attach(): void {
    // Nach dem Speichern von URL/Passwort sofort neu verbinden, damit die Kachel
    // ohne Neustart live geht (gleiches Muster wie im BambuService).
    eventSystem.on('plugin:state-changed', (e: DeskOSEvent) => {
      if ((e.payload as { id?: string } | undefined)?.id === PLUGIN_ID) this.reset();
    });
    // Blocking aus Automations/Szenen heraus schalten (ActionExecutor -> pihole:command).
    eventSystem.on('pihole:command', (e: DeskOSEvent) => {
      const cmd = e.payload as { enabled?: boolean; seconds?: number } | undefined;
      if (typeof cmd?.enabled !== 'boolean') return;
      void this.setBlocking(cmd.enabled, cmd.seconds).catch((err) =>
        console.error('[pihole] Blocking-Kommando fehlgeschlagen:', err)
      );
    });
    this.startPolling();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    void this.logout();
  }

  /** Erkannte Version + Session verwerfen und sofort neu pollen. */
  private reset(): void {
    void this.logout();
    this.apiVersion = 'none';
    this.detailsFetchedAt = 0;
    this.details = emptyDetails();
    void this.poll();
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
    void this.poll();
  }

  // ------------------------------------------------------------------ config

  private credentials(): Credentials | null {
    const s = this.registry.getSettings(PLUGIN_ID);
    const raw = (s.url || process.env.PIHOLE_URL || '').trim();
    const password = (s.password || process.env.PIHOLE_PASSWORD || '').trim();
    if (!raw || !password) return null;
    // Ohne Schema wäre die URL für fetch() unbrauchbar – http:// ist im LAN der Normalfall.
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return { url: withScheme.replace(/\/+$/, ''), password };
  }

  // -------------------------------------------------------------------- HTTP

  private async request(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) });
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    return res.json();
  }

  /** v6-Login: liefert eine SID, die ~30 min gültig ist. */
  private async login(creds: Credentials): Promise<void> {
    const body = await this.request(`${creds.url}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: creds.password }),
    });
    const session = (body as { session?: { valid?: boolean; sid?: string } }).session;
    if (!session?.valid || !session.sid) throw new Error('Passwort wurde abgelehnt');
    this.sid = session.sid;
  }

  /** v6-Session am Pi-hole abmelden (die Zahl paralleler Sessions ist begrenzt). */
  private async logout(): Promise<void> {
    const creds = this.credentials();
    if (!this.sid || !creds) {
      this.sid = null;
      return;
    }
    const sid = this.sid;
    this.sid = null;
    try {
      await fetch(`${creds.url}/api/auth`, {
        method: 'DELETE',
        headers: { 'X-FTL-SID': sid },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      /* Abmelden ist Kür – die Session läuft ohnehin ab. */
    }
  }

  /** v6-Aufruf inkl. SID; bei abgelaufener Session einmal neu anmelden. */
  private async v6(creds: Credentials, path: string, init?: RequestInit): Promise<unknown> {
    if (!this.sid) await this.login(creds);
    const call = () =>
      this.request(`${creds.url}/api${path}`, {
        ...init,
        headers: { ...(init?.headers ?? {}), 'X-FTL-SID': this.sid as string },
      });
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 401) throw err;
      this.sid = null;
      await this.login(creds);
      return call();
    }
  }

  /** v5-Aufruf gegen /admin/api.php; das Token hängt als ?auth= an. */
  private v5(creds: Credentials, query: string): Promise<unknown> {
    return this.request(`${creds.url}/admin/api.php?${query}&auth=${encodeURIComponent(creds.password)}`);
  }

  /**
   * Ermittelt die API-Generation: erst v6 (Login gegen /api/auth), bei fehlendem
   * Endpunkt Fallback auf v5. Das Ergebnis wird gecacht, bis reset() es verwirft.
   */
  private async detect(creds: Credentials): Promise<ApiVersion> {
    if (this.apiVersion !== 'none') return this.apiVersion;
    try {
      await this.login(creds);
      this.apiVersion = 'v6';
      return 'v6';
    } catch (err) {
      // Ein 404 bedeutet: /api/auth existiert nicht -> vermutlich Pi-hole v5.
      // Ein abgelehntes Passwort ist dagegen ein echter v6-Fehler.
      if (!(err instanceof HttpError) || err.status !== 404) throw err;
    }
    const body = await this.v5(creds, 'summaryRaw');
    if (!body || typeof body !== 'object' || !('dns_queries_today' in body)) {
      // v5 antwortet bei falschem Token mit einem leeren Array statt einem Objekt.
      throw new Error('Kein Pi-hole erreichbar oder Token ungültig');
    }
    this.apiVersion = 'v5';
    return 'v5';
  }

  // ----------------------------------------------------------------- polling

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const creds = this.credentials();
      if (!creds) {
        this.status = this.emptyStatus();
        return;
      }
      const version = await this.detect(creds);
      this.status = version === 'v6' ? await this.pollV6(creds) : await this.pollV5(creds);
    } catch (err) {
      // Bei einem Fehler die erkannte Version verwerfen, damit sich ein neu
      // gestarteter / aktualisierter Pi-hole beim nächsten Poll neu einordnet.
      this.apiVersion = 'none';
      this.sid = null;
      this.status = {
        ...this.status,
        hasCredentials: true,
        apiVersion: 'none',
        online: false,
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      };
    } finally {
      this.polling = false;
      void eventSystem.emit('pihole:update', this.status, 'pihole-service');
    }
  }

  private async pollV6(creds: Credentials): Promise<PiholeStatus> {
    const [summary, blocking] = await Promise.all([
      this.v6(creds, '/stats/summary') as Promise<any>,
      this.v6(creds, '/dns/blocking') as Promise<any>,
    ]);
    const q = summary?.queries ?? {};
    return {
      hasCredentials: true,
      apiVersion: 'v6',
      online: true,
      blocking: blocking?.blocking === 'enabled',
      blockingTimerSec: blocking?.timer == null ? null : Math.round(num(blocking.timer)),
      queriesToday: num(q.total),
      blockedToday: num(q.blocked),
      blockedPercent: num(q.percent_blocked),
      domainsOnBlocklist: num(summary?.gravity?.domains_being_blocked),
      uniqueClients: num(summary?.clients?.active),
      gravityLastUpdate: secToMs(summary?.gravity?.last_update),
      error: null,
      updatedAt: Date.now(),
    };
  }

  private async pollV5(creds: Credentials): Promise<PiholeStatus> {
    const s = (await this.v5(creds, 'summaryRaw')) as any;
    return {
      hasCredentials: true,
      apiVersion: 'v5',
      online: true,
      blocking: s?.status === 'enabled',
      blockingTimerSec: null, // summaryRaw kennt keine Restzeit
      queriesToday: num(s?.dns_queries_today),
      blockedToday: num(s?.ads_blocked_today),
      blockedPercent: num(s?.ads_percentage_today),
      domainsOnBlocklist: num(s?.domains_being_blocked),
      uniqueClients: num(s?.unique_clients),
      gravityLastUpdate: secToMs(s?.gravity_last_updated?.absolute),
      error: null,
      updatedAt: Date.now(),
    };
  }

  // ------------------------------------------------------------------ public

  getStatus(): PiholeStatus {
    // hasCredentials live auswerten, damit die UI direkt nach dem Speichern
    // umschaltet, auch wenn der erste Poll noch läuft.
    return { ...this.status, hasCredentials: this.credentials() !== null };
  }

  /** Detaildaten für die Vollansicht; kurz gecacht, damit Reloads den Pi-hole schonen. */
  async getDetails(force = false): Promise<PiholeDetails> {
    if (!force && Date.now() - this.detailsFetchedAt < this.detailsTtlMs) return this.details;
    if (this.detailsInFlight) return this.detailsInFlight;

    this.detailsInFlight = (async () => {
      const creds = this.credentials();
      if (!creds) return emptyDetails();
      const version = await this.detect(creds);
      const details = version === 'v6' ? await this.detailsV6(creds) : await this.detailsV5(creds);
      this.details = details;
      this.detailsFetchedAt = Date.now();
      return details;
    })();

    try {
      return await this.detailsInFlight;
    } catch {
      // Fehler stehen bereits im Status (poll) – hier lieber die letzten
      // bekannten Werte zeigen als die Ansicht mit einem 500er abzuschießen.
      return this.details;
    } finally {
      this.detailsInFlight = null;
    }
  }

  /**
   * Blocking schalten. `seconds` gilt nur beim Deaktivieren; Pi-hole schaltet
   * danach selbst zurück, DeskOS muss keinen Timer halten.
   */
  async setBlocking(enabled: boolean, seconds?: number): Promise<PiholeStatus> {
    const creds = this.credentials();
    if (!creds) throw new Error('Pi-hole ist nicht konfiguriert');
    const timer = !enabled && seconds && seconds > 0 ? Math.round(seconds) : null;
    const version = await this.detect(creds);

    if (version === 'v6') {
      await this.v6(creds, '/dns/blocking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocking: enabled, timer }),
      });
    } else {
      await this.v5(creds, enabled ? 'enable' : timer ? `disable=${timer}` : 'disable');
    }

    await this.poll(); // Status sofort nachziehen, statt bis zum nächsten Intervall zu warten
    return this.getStatus();
  }

  /** Verbindungstest für den „Verbinden"-Button: erzwingt eine Neuerkennung. */
  async testConnection(): Promise<PiholeStatus> {
    this.apiVersion = 'none';
    this.sid = null;
    await this.poll();
    return this.getStatus();
  }

  // ----------------------------------------------------------------- details

  private async detailsV6(creds: Credentials): Promise<PiholeDetails> {
    const [topQueries, topBlocked, clients, upstreams, history, summary] = await Promise.all([
      this.v6(creds, `/stats/top_domains?count=${TOP_COUNT}`) as Promise<any>,
      this.v6(creds, `/stats/top_domains?blocked=true&count=${TOP_COUNT}`) as Promise<any>,
      this.v6(creds, `/stats/top_clients?count=${TOP_COUNT}`) as Promise<any>,
      this.v6(creds, '/stats/upstreams') as Promise<any>,
      this.v6(creds, '/history') as Promise<any>,
      this.v6(creds, '/stats/summary') as Promise<any>,
    ]);

    const domains = (b: any): PiholeTopItem[] =>
      (Array.isArray(b?.domains) ? b.domains : []).map((d: any) => ({
        name: String(d?.domain ?? ''),
        count: num(d?.count),
      }));

    return {
      topQueries: domains(topQueries),
      topBlocked: domains(topBlocked),
      topClients: (Array.isArray(clients?.clients) ? clients.clients : []).map((c: any) => ({
        name: String(c?.name || c?.ip || ''),
        count: num(c?.count),
      })),
      // v6 liefert die Query-Typen als Teil der Summary, nicht als eigener Endpunkt.
      queryTypes: mapToTopItems(summary?.queries?.types),
      upstreams: (Array.isArray(upstreams?.upstreams) ? upstreams.upstreams : []).map((u: any) => ({
        name: String(u?.name || u?.ip || ''),
        count: num(u?.count),
      })),
      history: (Array.isArray(history?.history) ? history.history : []).map(
        (h: any): PiholeHistoryPoint => ({
          t: num(h?.timestamp) * 1000,
          total: num(h?.total),
          blocked: num(h?.blocked),
        })
      ),
    };
  }

  private async detailsV5(creds: Credentials): Promise<PiholeDetails> {
    const [top, sources, types, forwards, overTime] = await Promise.all([
      this.v5(creds, `topItems=${TOP_COUNT}`) as Promise<any>,
      this.v5(creds, `getQuerySources=${TOP_COUNT}`) as Promise<any>,
      this.v5(creds, 'getQueryTypes') as Promise<any>,
      this.v5(creds, 'getForwardDestinations') as Promise<any>,
      this.v5(creds, 'overTimeData10mins') as Promise<any>,
    ]);

    // v5 schlüsselt Clients als "hostname|ip" – für die Anzeige reicht der Hostname.
    const clientLabel = (key: string) => key.split('|')[0] || key;

    const totals: Record<string, unknown> = overTime?.domains_over_time ?? {};
    const blocked: Record<string, unknown> = overTime?.ads_over_time ?? {};
    const history = Object.keys(totals)
      .map(Number)
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
      .map(
        (ts): PiholeHistoryPoint => ({
          t: ts * 1000,
          total: num(totals[String(ts)]),
          blocked: num(blocked[String(ts)]),
        })
      );

    return {
      topQueries: mapToTopItems(top?.top_queries),
      topBlocked: mapToTopItems(top?.top_ads),
      topClients: mapToTopItems(sources?.top_sources).map((i) => ({ ...i, name: clientLabel(i.name) })),
      // getQueryTypes / getForwardDestinations liefern Prozente statt Absolutwerten.
      queryTypes: mapToTopItems(types?.querytypes),
      upstreams: mapToTopItems(forwards?.forward_destinations).map((i) => ({
        ...i,
        name: clientLabel(i.name),
      })),
      history,
    };
  }

  // ------------------------------------------------------------------ helper

  private emptyStatus(): PiholeStatus {
    return {
      hasCredentials: false,
      apiVersion: 'none',
      online: false,
      blocking: false,
      blockingTimerSec: null,
      queriesToday: 0,
      blockedToday: 0,
      blockedPercent: 0,
      domainsOnBlocklist: 0,
      uniqueClients: 0,
      gravityLastUpdate: null,
      error: null,
      updatedAt: 0,
    };
  }
}

export const createPiholeService = (registry: PluginRegistry): PiholeService => new PiholeService(registry);
