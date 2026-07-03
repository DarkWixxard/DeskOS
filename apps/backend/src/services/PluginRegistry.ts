// Plugin Registry / Marketplace (M6)
//
// A curated catalog of plugins. Built-in functional plugins (clock, system
// summary) ship enabled and render real widgets; external-service plugins
// (Spotify/Discord/…) are catalog entries that can be installed and configured
// (they need user credentials, surfaced via settingsSchema). Install/enable
// state + settings are persisted.

import { eventSystem } from '../core/EventSystem';
import type { DatabaseService } from './DatabaseService';
import type { PluginInstance, PluginManifest } from '@shared/types';

interface PluginRow {
  id: string;
  installed: number;
  enabled: number;
  settings: string | null;
}

interface PluginState {
  installed: boolean;
  enabled: boolean;
  settings: Record<string, string>;
}

// The marketplace catalog.
const CATALOG: PluginManifest[] = [
  {
    id: 'clock',
    name: 'Uhr',
    description: 'Digitale Uhr mit Datum.',
    category: 'system',
    icon: 'activity',
    author: 'DeskOS',
    requiresAuth: false,
    hasWidget: true,
    builtin: true,
  },
  {
    id: 'system-summary',
    name: 'System-Übersicht',
    description: 'CPU, RAM und Netzwerk auf einen Blick.',
    category: 'system',
    icon: 'cpu',
    author: 'DeskOS',
    requiresAuth: false,
    hasWidget: true,
    builtin: true,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Aktueller Titel & Wiedergabesteuerung.',
    category: 'media',
    icon: 'speaker',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Discord-Konto verbinden & Profil anzeigen.',
    category: 'communication',
    icon: 'shield',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    description: 'Szenen wechseln & Aufnahme steuern.',
    category: 'streaming',
    icon: 'camera',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'host', label: 'Host', type: 'text' },
      { key: 'password', label: 'Passwort', type: 'password' },
    ],
  },
  {
    id: 'steam',
    name: 'Steam',
    description: 'Online-Status & zuletzt gespielt.',
    category: 'gaming',
    icon: 'zap',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'steamId', label: 'Steam ID', type: 'text' },
    ],
  },
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    description: 'Entitäten & Automationen.',
    category: 'smart-home',
    icon: 'grid',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'url', label: 'URL', type: 'url' },
      { key: 'token', label: 'Long-Lived Token', type: 'password' },
    ],
  },
  {
    id: 'hue',
    name: 'Philips Hue',
    description: 'Lampen & Szenen steuern.',
    category: 'smart-home',
    icon: 'bulb',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'bridgeIp', label: 'Bridge IP', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  {
    id: 'bambu',
    name: 'Bambu Lab A1',
    description: 'Druckfortschritt & Restzeit des 3D-Druckers.',
    category: 'smart-home',
    icon: 'layers',
    requiresAuth: true,
    hasWidget: true,
    settingsSchema: [
      { key: 'ip', label: 'Drucker-IP', type: 'text' },
      { key: 'accessCode', label: 'LAN-Zugangscode', type: 'password' },
      { key: 'serial', label: 'Seriennummer', type: 'text' },
    ],
  },
];

const BUILTIN_DEFAULT_ENABLED = ['clock', 'system-summary'];

export class PluginRegistry {
  private readonly db: DatabaseService;
  private readonly state = new Map<string, PluginState>();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async restore(): Promise<void> {
    const rows = await this.db.all<PluginRow>('SELECT * FROM plugins');
    for (const row of rows) {
      this.state.set(row.id, {
        installed: !!row.installed,
        enabled: !!row.enabled,
        settings: this.parseSettings(row.settings),
      });
    }
  }

  /** Install + enable built-in plugins on first run. */
  async seedDefaults(): Promise<void> {
    for (const id of BUILTIN_DEFAULT_ENABLED) {
      if (!this.state.has(id)) {
        const state: PluginState = { installed: true, enabled: true, settings: {} };
        this.state.set(id, state);
        await this.persist(id, state);
      }
    }
  }

  // Niemals gespeicherte Secret-Werte über die API zurückgeben – nur ob etwas
  // hinterlegt ist (configured). settings bleibt leer.
  private toPublic(manifest: PluginManifest, s: PluginState): PluginInstance {
    return {
      ...manifest,
      installed: s.installed,
      enabled: s.enabled,
      configured: Object.keys(s.settings).length > 0,
      settings: {},
    };
  }

  list(): PluginInstance[] {
    return CATALOG.map((manifest) =>
      this.toPublic(manifest, this.state.get(manifest.id) ?? { installed: false, enabled: false, settings: {} })
    );
  }

  get(id: string): PluginInstance | null {
    const manifest = CATALOG.find((m) => m.id === id);
    if (!manifest) return null;
    return this.toPublic(manifest, this.state.get(id) ?? { installed: false, enabled: false, settings: {} });
  }

  async install(id: string): Promise<PluginInstance | null> {
    return this.mutate(id, (s) => ({ ...s, installed: true }));
  }

  async uninstall(id: string): Promise<PluginInstance | null> {
    return this.mutate(id, (s) => ({ ...s, installed: false, enabled: false }));
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginInstance | null> {
    return this.mutate(id, (s) => ({ ...s, enabled: enabled && s.installed }));
  }

  async updateSettings(id: string, settings: Record<string, string>): Promise<PluginInstance | null> {
    // Leerwerte ignorieren, damit ein erneutes Speichern ohne Eingabe die
    // hinterlegten Secrets nicht überschreibt.
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (typeof v === 'string' && v.trim() !== '') clean[k] = v;
    }
    return this.mutate(id, (s) => ({ ...s, settings: { ...s.settings, ...clean } }));
  }

  // ---- interner Zugriff (NICHT über die API!) ----
  // Services wie der SpotifyService brauchen die echten Secrets (Client-Secret,
  // Refresh-Token). Diese Werte werden bewusst nie über list()/get() bzw. die
  // REST-API herausgegeben (siehe toPublic) – nur serverseitig.

  /** Rohe Settings inkl. Secrets (Kopie). Nur serverseitig verwenden. */
  getSettings(id: string): Record<string, string> {
    return { ...(this.state.get(id)?.settings ?? {}) };
  }

  /** Einzelne Settings-Schlüssel entfernen (z. B. Refresh-Token beim Trennen). */
  async clearSettings(id: string, keys: string[]): Promise<void> {
    const current = this.state.get(id);
    if (!current) return;
    const settings = { ...current.settings };
    for (const key of keys) delete settings[key];
    const next = { ...current, settings };
    this.state.set(id, next);
    await this.persist(id, next);
    eventSystem.emit('plugin:state-changed', { id, ...next }, 'plugin-registry');
  }

  private async mutate(id: string, fn: (s: PluginState) => PluginState): Promise<PluginInstance | null> {
    if (!CATALOG.some((m) => m.id === id)) return null;
    const current = this.state.get(id) ?? { installed: false, enabled: false, settings: {} };
    const next = fn(current);
    this.state.set(id, next);
    await this.persist(id, next);
    eventSystem.emit('plugin:state-changed', { id, ...next }, 'plugin-registry');
    return this.get(id);
  }

  private async persist(id: string, s: PluginState): Promise<void> {
    await this.db.run(
      `INSERT INTO plugins (id, installed, enabled, settings) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET installed = excluded.installed, enabled = excluded.enabled, settings = excluded.settings`,
      [id, s.installed ? 1 : 0, s.enabled ? 1 : 0, JSON.stringify(s.settings)]
    );
  }

  private parseSettings(value: string | null): Record<string, string> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}

export const createPluginRegistry = (db: DatabaseService): PluginRegistry => new PluginRegistry(db);
