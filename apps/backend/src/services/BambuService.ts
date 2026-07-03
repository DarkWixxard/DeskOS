// Bambu Lab Service (3D-Drucker-Plugin)
//
// Bindet einen Bambu-Lab-Drucker (A1 & Co.) über MQTT an – in zwei Modi:
//
//   LOKAL:  mqtts://<drucker-ip>:8883, User "bblp", Passwort = LAN-Zugangscode.
//           Voll offline, aber bei A1/P1 nur im „LAN Only"-Modus möglich (der
//           die Cloud kappt und Handy-App/Bambu Studio abmeldet).
//   CLOUD:  <region>.mqtt.bambulab.com:8883, User "u_<uid>", Passwort = Access-
//           Token aus dem Bambu-Cloud-Login. Läuft parallel zur Cloud, sodass
//           App und Studio weiter funktionieren.
//
// Beide Modi liefern denselben Report auf `device/<serial>/report`; das Parsing
// (getStatus) ist identisch. Steuerbefehle gehen auf `device/<serial>/request`.
//
// Zugangsdaten kommen aus den Plugin-Settings (UI) bzw. für den lokalen Modus
// optional aus BAMBU_IP / BAMBU_ACCESS_CODE / BAMBU_SERIAL. Cloud-Login-Daten
// (E-Mail/Passwort) werden nur transient verwendet; persistiert wird nur das
// Token – und wie alle Secrets nie über die REST-API herausgegeben.

import mqtt, { MqttClient } from 'mqtt';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import type { PluginRegistry } from './PluginRegistry';
import type { BambuStatus } from '@shared/types';
import * as BambuCloud from './BambuCloud';
import type { BambuRegion } from './BambuCloud';

const PLUGIN_ID = 'bambu';
// Nach dieser Zeit ohne neuen Report gilt der Drucker als offline.
const FRESHNESS_MS = 60_000;

interface LocalCreds {
  ip: string;
  accessCode: string;
  serial: string;
}

export type BambuAction = 'pause' | 'resume' | 'stop';
export type BambuMode = 'local' | 'cloud' | 'none';

export interface CloudLoginResult {
  status: 'ok' | 'verifyCode' | 'error';
  message?: string;
}

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

function normalizeRegion(v: unknown): BambuRegion {
  return v === 'china' ? 'china' : 'global';
}

export class BambuService {
  private readonly registry: PluginRegistry;
  private client: MqttClient | null = null;
  private lastReport = 0; // epoch ms des letzten Reports
  private lastError?: string;
  private activeSerial = ''; // Serial der aktuell verbundenen Sitzung
  // Zuletzt bekannte Rohwerte aus dem `print`-Objekt (Reports sind oft partiell).
  private print: Record<string, unknown> = {};

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Beim Start verbinden und auf Settings-Änderungen reagieren. */
  attach(): void {
    // Nach dem Speichern der Zugangsdaten / erfolgreichem Cloud-Login neu
    // verbinden, damit die Kachel ohne Neustart live geht.
    eventSystem.on('plugin:state-changed', (e: DeskOSEvent) => {
      if ((e.payload as { id?: string } | undefined)?.id === PLUGIN_ID) this.reconnect();
    });
    this.reconnect();
  }

  stop(): void {
    this.disconnectClient();
  }

  // ------------------------------------------------------------------ config

  private localCreds(s: Record<string, string>): LocalCreds | null {
    const ip = (s.ip || process.env.BAMBU_IP || '').trim();
    const accessCode = (s.accessCode || process.env.BAMBU_ACCESS_CODE || '').trim();
    const serial = (s.serial || process.env.BAMBU_SERIAL || '').trim();
    if (!ip || !accessCode || !serial) return null;
    return { ip, accessCode, serial };
  }

  private hasCloud(s: Record<string, string>): boolean {
    return Boolean(s.cloudToken && s.cloudUsername && s.serial);
  }

  /** Aktiver Modus: Cloud hat Vorrang, sonst lokal, sonst keiner. */
  mode(): BambuMode {
    const s = this.registry.getSettings(PLUGIN_ID);
    if (this.hasCloud(s)) return 'cloud';
    if (this.localCreds(s)) return 'local';
    return 'none';
  }

  // ----------------------------------------------------------------- MQTT

  private reconnect(): void {
    this.disconnectClient();
    const s = this.registry.getSettings(PLUGIN_ID);
    if (this.hasCloud(s)) {
      const region = normalizeRegion(s.cloudRegion);
      this.connect(`mqtts://${BambuCloud.mqttHost(region)}:8883`, s.cloudUsername, s.cloudToken, s.serial, `cloud/${region}`);
      return;
    }
    const local = this.localCreds(s);
    if (local) {
      this.connect(`mqtts://${local.ip}:8883`, 'bblp', local.accessCode, local.serial, `lokal/${local.ip}`);
    }
  }

  private connect(url: string, username: string, password: string, serial: string, label: string): void {
    this.activeSerial = serial;
    const client = mqtt.connect(url, {
      username,
      password,
      rejectUnauthorized: false, // lokal: selbstsigniert; Cloud: CA-Probleme vermeiden.
      reconnectPeriod: 5000,
      connectTimeout: 8000,
      clientId: `deskos-${serial}-${Math.random().toString(16).slice(2, 8)}`,
    });
    this.client = client;

    client.on('connect', () => {
      this.lastError = undefined;
      console.log(`🖨️  Bambu MQTT connected (${label})`);
      client.subscribe(`device/${serial}/report`);
      // Vollen Statusdump anfordern – sonst kommen nur Deltas.
      this.publishRaw(serial, { pushing: { sequence_id: '0', command: 'pushall' } });
    });
    client.on('message', (_topic, payload) => this.onMessage(payload));
    client.on('error', (err) => {
      // Bei unerreichbarem Drucker / abgelaufenem Token nicht die Konsole
      // fluten – dieselbe Meldung nur einmal ausgeben.
      const msg = (err && (err.message || (err as NodeJS.ErrnoException).code)) || String(err);
      if (msg !== this.lastError) {
        this.lastError = msg;
        console.warn(`⚠️ Bambu MQTT (${label}): ${msg}`);
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
    if (!serial || !this.client?.connected) return false;
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
    const mode = this.mode();
    const online = mode !== 'none' && this.lastReport > 0 && Date.now() - this.lastReport < FRESHNESS_MS;
    return {
      hasCredentials: mode !== 'none',
      mode,
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
    const serial = this.activeSerial || this.registry.getSettings(PLUGIN_ID).serial || '';
    // Bambu-Befehle: pause | resume | stop.
    return this.publishRaw(serial, { print: { sequence_id: '0', command: action } });
  }

  // ------------------------------------------------------------- cloud login

  /** Schritt 1: Cloud-Login mit E-Mail + Passwort. */
  async cloudLogin(email: string, password: string, region: BambuRegion): Promise<CloudLoginResult> {
    const r = await BambuCloud.login(region, email, password);
    if (r.status === 'ok') return this.finishCloudLogin(r.token, region);
    if (r.status === 'verifyCode') return { status: 'verifyCode' };
    if (r.status === 'tfa')
      return { status: 'error', message: 'App-2FA wird nicht unterstützt – bitte den E-Mail-Code-Login verwenden.' };
    return { status: 'error', message: r.message };
  }

  /** Schritt 2: Cloud-Login mit E-Mail-Code abschließen. */
  async cloudSubmitCode(email: string, code: string, region: BambuRegion): Promise<CloudLoginResult> {
    const r = await BambuCloud.loginWithCode(region, email, code);
    if (r.status === 'ok') return this.finishCloudLogin(r.token, region);
    return { status: 'error', message: r.status === 'error' ? r.message : 'Login fehlgeschlagen.' };
  }

  private async finishCloudLogin(token: string, region: BambuRegion): Promise<CloudLoginResult> {
    const username = BambuCloud.usernameFromToken(token) ?? (await BambuCloud.usernameFromApi(region, token));
    if (!username) return { status: 'error', message: 'Konto-Kennung konnte nicht ermittelt werden.' };

    const devices = await BambuCloud.listDevices(region, token);
    const existingSerial = (this.registry.getSettings(PLUGIN_ID).serial || '').trim();
    const serial = devices[0]?.serial || existingSerial;
    if (!serial) return { status: 'error', message: 'Kein gebundener Drucker im Konto gefunden.' };

    // Token + Verbindungsdaten persistieren (löst über plugin:state-changed die
    // Neuverbindung aus).
    await this.registry.updateSettings(PLUGIN_ID, {
      cloudToken: token,
      cloudUsername: username,
      cloudRegion: region,
      serial,
    });
    return { status: 'ok' };
  }

  /** Cloud-Verbindung trennen (Token verwerfen). Lokale Zugangsdaten bleiben. */
  async cloudLogout(): Promise<void> {
    await this.registry.clearSettings(PLUGIN_ID, ['cloudToken', 'cloudUsername', 'cloudRegion']);
  }
}

export const createBambuService = (registry: PluginRegistry): BambuService => new BambuService(registry);
