// Bambu Lab Service (3D-Drucker-Plugin)
//
// Bindet einen Bambu-Lab-Drucker (A1 & Co.) LOKAL über MQTT an. Der Drucker
// veröffentlicht seinen kompletten Live-Status (Fortschritt, Restzeit, Layer,
// Temperaturen) auf `device/<serial>/report` über TLS:
//   - Host:     mqtts://<drucker-ip>:8883
//   - Username: "bblp"
//   - Passwort: LAN-Zugangscode (am Drucker abzulesen)
//   - Zertifikat: selbstsigniert -> rejectUnauthorized:false
//
// Wir abonnieren das Report-Topic, halten den letzten (ggf. per Delta
// aktualisierten) Status im Cache und liefern ihn über das Backend an die
// Dashboard-Kachel. Steuerbefehle (Pause/Fortsetzen/Abbrechen) gehen auf
// `device/<serial>/request`.
//
// Zugangsdaten (IP / Access Code / Serial) kommen aus den Plugin-Settings (UI)
// oder optional aus BAMBU_IP / BAMBU_ACCESS_CODE / BAMBU_SERIAL. Der Access Code
// ist ein Secret und wird – wie alle Plugin-Secrets – nie über die REST-API
// herausgegeben (siehe PluginRegistry.toPublic).

import mqtt, { MqttClient } from 'mqtt';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import type { PluginRegistry } from './PluginRegistry';
import type { BambuStatus } from '@shared/types';

const PLUGIN_ID = 'bambu';
// Nach dieser Zeit ohne neuen Report gilt der Drucker als offline.
const FRESHNESS_MS = 60_000;

interface Credentials {
  ip: string;
  accessCode: string;
  serial: string;
}

export type BambuAction = 'pause' | 'resume' | 'stop';

// Robustes Zahl-Parsing: Bambu liefert einige Felder als String.
function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

// Dateinamen aus einem gcode_file-Pfad ziehen (ohne Verzeichnis/Endung).
function baseName(file: unknown): string {
  if (typeof file !== 'string' || !file) return '';
  const name = file.split('/').pop() ?? file;
  return name.replace(/\.(gcode|3mf)$/i, '');
}

export class BambuService {
  private readonly registry: PluginRegistry;
  private client: MqttClient | null = null;
  private lastReport = 0; // epoch ms des letzten Reports
  private lastError?: string;
  // Zuletzt bekannte Rohwerte aus dem `print`-Objekt (Reports sind oft partiell).
  private print: Record<string, unknown> = {};

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Beim Start verbinden und auf Settings-Änderungen reagieren. */
  attach(): void {
    // Nach dem Speichern der Zugangsdaten (oder Install/Enable) neu verbinden,
    // damit die Kachel ohne Neustart live geht.
    eventSystem.on('plugin:state-changed', (e: DeskOSEvent) => {
      if ((e.payload as { id?: string } | undefined)?.id === PLUGIN_ID) this.reconnect();
    });
    this.reconnect();
  }

  stop(): void {
    this.disconnectClient();
  }

  // ------------------------------------------------------------------ config

  private credentials(): Credentials | null {
    const s = this.registry.getSettings(PLUGIN_ID);
    const ip = (s.ip || process.env.BAMBU_IP || '').trim();
    const accessCode = (s.accessCode || process.env.BAMBU_ACCESS_CODE || '').trim();
    const serial = (s.serial || process.env.BAMBU_SERIAL || '').trim();
    if (!ip || !accessCode || !serial) return null;
    return { ip, accessCode, serial };
  }

  // ----------------------------------------------------------------- MQTT

  private reconnect(): void {
    this.disconnectClient();
    const creds = this.credentials();
    if (!creds) return; // Ohne Zugangsdaten passiv bleiben (keine Fehler-Flut).
    this.connect(creds);
  }

  private connect(creds: Credentials): void {
    const url = `mqtts://${creds.ip}:8883`;
    const client = mqtt.connect(url, {
      username: 'bblp',
      password: creds.accessCode,
      rejectUnauthorized: false, // Drucker nutzt ein selbstsigniertes Zertifikat.
      reconnectPeriod: 5000,
      connectTimeout: 8000,
      clientId: `deskos-${creds.serial}-${Math.random().toString(16).slice(2, 8)}`,
    });
    this.client = client;

    client.on('connect', () => {
      this.lastError = undefined;
      console.log(`🖨️  Bambu MQTT connected (${creds.ip})`);
      client.subscribe(`device/${creds.serial}/report`);
      // Vollen Statusdump anfordern – sonst kommen nur Deltas.
      this.publishRaw(creds.serial, { pushing: { sequence_id: '0', command: 'pushall' } });
    });
    client.on('message', (_topic, payload) => this.onMessage(payload));
    client.on('error', (err) => {
      // Wie beim MqttService: bei fehlendem/unerreichbarem Drucker nicht die
      // Konsole fluten – dieselbe Meldung nur einmal ausgeben.
      const msg = (err && (err.message || (err as NodeJS.ErrnoException).code)) || String(err);
      if (msg !== this.lastError) {
        this.lastError = msg;
        console.warn(`⚠️ Bambu MQTT (${url}): ${msg} — Druckerdaten bleiben aus, bis der Drucker erreichbar ist.`);
      }
    });
  }

  private onMessage(payload: Buffer): void {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString() || '{}');
    } catch {
      return;
    }
    this.ingestReport(data);
  }

  /**
   * Verarbeitet einen (evtl. partiellen) Report und aktualisiert den Cache.
   * Public, damit das Report-Parsing ohne echte MQTT-Verbindung testbar ist.
   */
  ingestReport(data: unknown): void {
    const print = (data as { print?: unknown } | null)?.print;
    if (!print || typeof print !== 'object') return;
    this.print = { ...this.print, ...(print as Record<string, unknown>) };
    this.lastReport = Date.now();
    eventSystem.emit('bambu:update', this.getStatus(), 'bambu-service');
  }

  private publishRaw(serial: string, payload: unknown): boolean {
    if (!this.client?.connected) return false;
    this.client.publish(`device/${serial}/request`, JSON.stringify(payload));
    return true;
  }

  private disconnectClient(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
    }
  }

  // ----------------------------------------------------------------- status

  getStatus(): BambuStatus {
    const p = this.print;
    const online = this.lastReport > 0 && Date.now() - this.lastReport < FRESHNESS_MS;
    return {
      hasCredentials: this.credentials() !== null,
      online,
      gcodeState: String(p.gcode_state ?? ''),
      jobName: String(p.subtask_name || baseName(p.gcode_file) || ''),
      progress: num(p.mc_percent),
      remainingMin: num(p.mc_remaining_time),
      layerNum: num(p.layer_num),
      totalLayers: num(p.total_layer_num),
      nozzleTemp: num(p.nozzle_temper),
      nozzleTarget: num(p.nozzle_target_temper),
      bedTemp: num(p.bed_temper),
      bedTarget: num(p.bed_target_temper),
      updatedAt: this.lastReport,
    };
  }

  // ---------------------------------------------------------------- control

  /** Druck steuern (Pause / Fortsetzen / Abbrechen). Liefert true bei Erfolg. */
  control(action: BambuAction): boolean {
    const creds = this.credentials();
    if (!creds) return false;
    // Bambu-Befehle: pause | resume | stop.
    return this.publishRaw(creds.serial, { print: { sequence_id: '0', command: action } });
  }
}

export const createBambuService = (registry: PluginRegistry): BambuService => new BambuService(registry);
