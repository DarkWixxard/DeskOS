// Shared Types and Interfaces
//
// Single source of truth for the DeskOS domain types. Backend, frontend and
// agent import from here (via the "@shared/*" path alias) and re-export where
// needed, so a type only ever needs to change in one place.

export type DeviceType = 'local' | 'remote' | 'esp32' | 'sensor';
export type DeviceStatus = 'online' | 'offline' | 'error';
export type EventPriority = 'low' | 'normal' | 'high' | 'critical';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  status: DeviceStatus;
  lastSeen: number;
  metadata: Record<string, unknown>;
  capabilities: string[];
}

export interface GpuMetrics {
  model?: string;
  vendor?: string;
  load?: number; // %
  tempC?: number;
  memUsed?: number; // bytes
  memTotal?: number; // bytes
}

export interface DiskMetrics {
  fs?: string;
  mount?: string;
  type?: string;
  used: number; // bytes
  total: number; // bytes
  percentage: number;
}

export interface NetworkMetrics {
  iface?: string;
  rxSec: number; // bytes/second
  txSec: number; // bytes/second
  rxBytes?: number; // total received
  txBytes?: number; // total transmitted
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number; // %
  memBytes?: number;
}

export interface SystemMetrics {
  // The index signature keeps SystemMetrics assignable to Record<string, unknown>
  // (used by DeviceManager.recordData). All M1 fields below are optional so the
  // plain `os`-only fallback object still satisfies the type.
  [key: string]: unknown;
  cpu: number; // %
  cpuTempC?: number;
  cpuModel?: string;
  cpuCores?: number;
  ram: {
    used: number;
    total: number;
    percentage: number;
  };
  // Primary/root filesystem (kept for backwards compatibility); `disks` carries
  // the full per-filesystem breakdown.
  disk?: {
    used: number;
    total: number;
    percentage: number;
  };
  disks?: DiskMetrics[];
  gpus?: GpuMetrics[];
  fansRpm?: number[];
  network?: NetworkMetrics;
  processes?: {
    count?: number;
    top: ProcessInfo[];
  };
  uptime: number;
  hostname: string;
  platform: string;
}

export interface DeviceData {
  deviceId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface DeskOSEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: unknown;
  priority: EventPriority;
}

export interface LogEntry {
  id?: number;
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number;
  metadata?: unknown;
}

// --- RGB / WLED ---
export type RgbMode = 'manual' | 'temperature' | 'alarm';

export interface WledState {
  on: boolean;
  brightness: number; // 0-100 (UI scale; WLED uses 0-255 internally)
  color: [number, number, number]; // primary RGB
  effect: number; // WLED effect (fx) index
  effectName?: string;
}

// Per-light "turn off at a set time" schedule (evaluated by the WledService
// once a minute in local time). Stored on the backing device's metadata.
export interface WledOffSchedule {
  enabled: boolean;
  time: string; // 'HH:MM' (24h, local time)
  days?: number[]; // 0=Sun .. 6=Sat; empty/undefined = every day
}

export interface WledLight {
  id: string; // backing device id
  name: string;
  ip: string;
  online: boolean;
  mode: RgbMode;
  state?: WledState;
  ledCount?: number;
  version?: string;
  offSchedule?: WledOffSchedule;
}

export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export interface DeskNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  source: string;
  eventType?: string;
  deviceId?: string;
  read: boolean;
  timestamp: number;
}

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  backend?: any;
  frontend?: any;
}

// API Response types
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DashboardSummary {
  devices: {
    total: number;
    online: number;
    offline: number;
  };
  system: SystemMetrics;
  recentEvents: DeskOSEvent[];
}

// --- Automation Engine v2 ---
export type AutomationOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

export interface ThresholdTrigger {
  type: 'threshold';
  field: string; // e.g. 'cpu' or 'ram.percentage'
  operator: AutomationOperator;
  value: number;
}
export interface EventTrigger {
  type: 'event';
  eventType: string; // exact event type to react to
}
export interface DeviceStatusTrigger {
  type: 'device_status';
  status: DeviceStatus;
  deviceId?: string; // optional: only this device
}
export interface ScheduleTrigger {
  type: 'schedule';
  time: string; // 'HH:MM' (24h, local time)
  days?: number[]; // 0=Sun .. 6=Sat; empty/undefined = every day
}
export type AutomationTrigger = ThresholdTrigger | EventTrigger | DeviceStatusTrigger | ScheduleTrigger;

export interface EmitEventAction {
  type: 'emit_event';
  eventType: string;
  message?: string;
  priority?: EventPriority;
}
export interface NotifyAction {
  type: 'notify';
  title: string;
  message: string;
  level?: NotificationLevel;
}
export interface WledAction {
  type: 'wled';
  target: string; // 'all' or a light/device id
  on?: boolean;
  brightness?: number;
  color?: [number, number, number] | string;
  effect?: number;
  mode?: RgbMode;
}
export interface LayoutAction {
  type: 'layout';
  profileId?: string;
  view?: string;
}
// Runs a saved scene by id (the M4 "Szene ausführen" action). Handled by the
// SceneService, which reacts to the 'scene:apply' bus event and executes the
// scene's own actions — so automations and layout profiles reference a scene
// once instead of duplicating its WLED/notify actions inline.
export interface SceneAction {
  type: 'scene';
  sceneId: string;
}
export type AutomationAction = EmitEventAction | NotifyAction | WledAction | LayoutAction | SceneAction;

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  cooldownMs: number;
  lastFired: number;
}

// --- Layout / Profile System ---
export interface LayoutProfile {
  id: string;
  name: string;
  icon?: string;
  view?: string; // dashboard view to switch to
  actions: AutomationAction[]; // applied on activation: inline actions or a { type: 'scene' } reference
}

// --- Scenes ---
// Eine benannte, wiederverwendbare Momentaufnahme der Schreibtisch-Stimmung –
// in erster Linie Licht (WLED an/Helligkeit/Farbe/Effekt), allgemein ein Bündel
// von AutomationActions. Szenen sind der wiederverwendbare Baustein: einmal
// definiert ("Fokus", "Kino", "Aus") und per Ein-Klick anwendbar, aus
// Automationen (Aktionstyp 'scene') und aus Layout-Profilen referenzierbar.
export interface Scene {
  id: string;
  name: string;
  icon?: string; // HoloIcon-Name für die Kachel
  color?: [number, number, number]; // Akzentfarbe der Karte (RGB), rein kosmetisch
  actions: AutomationAction[]; // was die Szene beim Anwenden ausführt
}

// --- ESP32 / MQTT nodes, Sensor Hub, Module Manager ---
export interface NodeModule {
  id: string;
  type: string; // 'sensor' | 'led' | 'display' | 'audio' | 'macro' | ...
  sensors?: string[]; // e.g. ['temperature','humidity','co2','light','noise']
}

export interface SensorNode {
  device: Device;
  latest: Record<string, number> | null;
  modules: NodeModule[];
}

// --- Displays / Info-Panels ---
// Ein sekundärer Screen am Schreibtisch, den DeskOS mit Inhalten bespielt: ein
// kleines ESP32-/Pi-getriebenes TFT-/OLED-Panel, ein E-Ink-Display oder ein
// Browser-Tab als Screen. Jedes Panel wird von einem Device gebacked und nutzt
// so Persistenz, das Device Center und die Modul-Status-LEDs mit.

// Was ein Panel gerade anzeigt. Das Backend rendert jede Quelle aus Live-Daten.
export type DisplaySource =
  | 'clock' // Uhrzeit + Datum
  | 'system' // CPU / RAM / Temperatur des lokalen Hosts
  | 'sensor' // letzter Messwert eines Sensor-Nodes
  | 'text' // frei eingegebener Text
  | 'blank'; // leerer / ausgeschalteter Screen

// Wie der gerenderte Inhalt das Panel erreicht.
export type DisplayTransport =
  | 'virtual' // nur Vorschau im Dashboard (keine Hardware)
  | 'http' // POST an eine HTTP-Adresse (IP/URL)
  | 'mqtt'; // Kommando an einen ESP32-/MQTT-Node

// Der gerenderte Payload, der ans Panel geschickt und in der UI-Vorschau
// gespiegelt wird. Firmware-agnostisch gehalten: ein großer Titel, ein paar
// kleinere Zeilen und eine Akzentfarbe.
export interface DisplayContent {
  title: string;
  lines: string[];
  color?: [number, number, number]; // Akzentfarbe (RGB), z. B. temperaturabhängig
  updatedAt: number;
}

export interface DisplayPanel {
  id: string; // backing device id
  name: string;
  transport: DisplayTransport;
  target: string; // IP/URL (http) bzw. Node-Id (mqtt); leer für 'virtual'
  online: boolean;
  on: boolean;
  brightness: number; // 0-100
  source: DisplaySource;
  text?: string; // Inhalt für source 'text'
  sensorDeviceId?: string; // Quelle für source 'sensor'
  sensorMetric?: string; // Messfeld für source 'sensor' (z. B. 'temperature')
  content?: DisplayContent; // zuletzt gerenderter Inhalt (für die Vorschau)
}

// --- Plugin System v2 / Marketplace ---
export type PluginCategory = 'system' | 'media' | 'communication' | 'streaming' | 'gaming' | 'smart-home';

export interface PluginSettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  icon: string;
  author?: string;
  requiresAuth: boolean;
  hasWidget: boolean;
  builtin?: boolean;
  settingsSchema?: PluginSettingField[];
}

export interface PluginInstance extends PluginManifest {
  installed: boolean;
  enabled: boolean;
  // true, wenn Zugangsdaten hinterlegt sind. Die Werte selbst werden aus
  // Sicherheitsgründen nicht über die API zurückgegeben (settings bleibt leer).
  configured: boolean;
  settings: Record<string, string>;
}

// --- Spotify (Media-Plugin) ---
// Verbindungsstatus des Spotify-Plugins. Enthält keine Secrets – nur ob
// Client-ID/Secret hinterlegt sind und ob bereits ein OAuth-Login besteht.
export interface SpotifyStatus {
  hasCredentials: boolean; // Client ID + Secret vorhanden
  connected: boolean; // gültiger Refresh-Token vorhanden (Login erfolgt)
  redirectUri: string; // muss exakt so in der Spotify-App eingetragen sein
}

// Aktuell laufender Titel (Now Playing) aus der Spotify Web API.
export interface SpotifyTrack {
  isPlaying: boolean;
  title: string;
  artists: string; // zusammengeführte Künstlernamen
  album: string;
  albumArt: string | null; // Cover-URL (größtes Bild)
  durationMs: number;
  progressMs: number;
  trackUrl: string | null; // Link zum Track in Spotify
}

// --- Discord (Communication-Plugin) ---
// Verbindungsstatus des Discord-Plugins. Enthält keine Secrets – nur ob
// Client-ID/Secret hinterlegt sind und ob bereits ein OAuth-Login (mit dem
// eigenen Discord-Account, kein Bot) besteht.
export interface DiscordStatus {
  hasCredentials: boolean; // Client ID + Secret vorhanden
  connected: boolean; // gültiger Refresh-Token vorhanden (Login erfolgt)
  redirectUri: string; // muss exakt so in der Discord-App eingetragen sein
}

// Das verbundene Discord-Profil (aus /users/@me), zur Anzeige im Widget.
export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null; // Anzeigename, falls gesetzt
  avatarUrl: string | null;
}

// --- Bambu Lab (3D-Drucker-Plugin) ---
// Live-Status eines Bambu-Lab-Druckers (A1 & Co.), lokal per MQTT abgerufen.
// Enthält keine Secrets – nur ob Zugangsdaten hinterlegt sind (hasCredentials)
// und der zuletzt empfangene Druckstatus.
export interface BambuStatus {
  hasCredentials: boolean; // Zugangsdaten hinterlegt (lokal ODER Cloud)
  mode: 'local' | 'cloud' | 'none'; // aktiver Verbindungsmodus
  online: boolean; // kürzlich Daten vom Drucker empfangen
  gcodeState: string; // IDLE | PREPARE | RUNNING | PAUSE | FINISH | FAILED
  jobName: string; // aktueller Auftrag (subtask_name / Dateiname)
  progress: number; // Fortschritt 0–100 (mc_percent)
  remainingMin: number; // Restzeit in Minuten (mc_remaining_time)
  layerNum: number; // aktuelle Schicht
  totalLayers: number; // Gesamtzahl Schichten
  nozzleTemp: number; // Düsentemperatur °C (ist)
  nozzleTarget: number; // Düsentemperatur °C (soll)
  bedTemp: number; // Betttemperatur °C (ist)
  bedTarget: number; // Betttemperatur °C (soll)
  updatedAt: number; // Zeitpunkt des letzten Reports (epoch ms)
}
