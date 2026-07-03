// WLED Service + RGB Engine (M3)
//
// Controls WLED lights over their JSON API (http://<ip>/json). Each light is
// modelled as a Device (type 'esp32', capability 'led', metadata.kind 'wled'),
// so it reuses the existing persistence + Device Center. Also drives the RGB
// modes (manual / temperature / alarm).

import { deviceManager } from '../core/DeviceManager';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import { systemMonitor } from './SystemMonitor';
import type { Device } from '../core/DeviceManager';
import type { SystemMetrics, WledLight, WledState, RgbMode, WledOffSchedule } from '@shared/types';

interface ControlInput {
  on?: boolean;
  brightness?: number; // 0-100
  color?: [number, number, number] | string;
  effect?: number;
}

const DEFAULT_LIGHTS: { name: string; ip: string }[] = (() => {
  if (process.env.WLED_LIGHTS) {
    try {
      return JSON.parse(process.env.WLED_LIGHTS);
    } catch {
      /* fall through */
    }
  }
  return [
    { name: 'Zimmerlicht', ip: '192.168.178.126' },
    { name: 'Schreibtisch-Regal', ip: '192.168.178.49' },
  ];
})();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isWledDevice = (d: Device) => d.type === 'esp32' && (d.metadata as any)?.kind === 'wled';

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// green (cool) -> red (hot) across a 0..100 value.
const valueToColor = (value: number): [number, number, number] =>
  hsvToRgb(120 - (120 * clamp(value, 0, 100)) / 100, 1, 1);

function toRgb(color: [number, number, number] | string): [number, number, number] {
  if (typeof color === 'string') {
    const hex = color.replace('#', '');
    return [
      parseInt(hex.slice(0, 2), 16) || 0,
      parseInt(hex.slice(2, 4), 16) || 0,
      parseInt(hex.slice(4, 6), 16) || 0,
    ];
  }
  return [clamp(color[0] | 0, 0, 255), clamp(color[1] | 0, 0, 255), clamp(color[2] | 0, 0, 255)];
}

export class WledService {
  private readonly stateCache = new Map<string, WledState>();
  private readonly tempThrottle = new Map<string, number>();
  // Last minute ('YYYY-M-D HH:MM') an auto-off fired per light, so a schedule
  // triggers at most once within its matching minute.
  private readonly offFiredAt = new Map<string, string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs = Number(process.env.WLED_POLL_INTERVAL_MS) || 7000;
  private readonly tempIntervalMs = 3000;
  private readonly requestTimeoutMs = 2500;

  // ---------------------------------------------------------------- lifecycle

  /** Seed the configured lights on first run (when none exist yet). */
  seedDefaults(): void {
    const existing = deviceManager.getAllDevices().filter(isWledDevice);
    if (existing.length > 0) return;
    for (const light of DEFAULT_LIGHTS) {
      this.addLight(light.name, light.ip);
    }
  }

  attach(): void {
    eventSystem.on('*', (e) => this.onEvent(e));
    // Commands from automations / layout scenes.
    eventSystem.on('wled:command', (e) => this.onCommand(e));
    void this.pollAll();
    this.pollTimer = setInterval(() => void this.pollAll(), this.pollIntervalMs);
    this.pollTimer.unref?.();
    // Per-light "turn off at HH:MM" schedules, checked once per minute.
    this.scheduleTimer = setInterval(() => this.tickSchedules(), 60_000);
    this.scheduleTimer.unref?.();
  }

  private onCommand(event: DeskOSEvent): void {
    const cmd = (event.payload ?? {}) as {
      target?: string;
      on?: boolean;
      brightness?: number;
      color?: [number, number, number] | string;
      effect?: number;
      mode?: RgbMode;
    };
    const ids = !cmd.target || cmd.target === 'all' ? this.wledDevices().map((d) => d.id) : [cmd.target];
    for (const id of ids) {
      if (cmd.mode) this.setMode(id, cmd.mode);
      if (cmd.on !== undefined || cmd.brightness !== undefined || cmd.color !== undefined || cmd.effect !== undefined) {
        void this.control(id, { on: cmd.on, brightness: cmd.brightness, color: cmd.color, effect: cmd.effect }).catch(() => undefined);
      }
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  // ------------------------------------------------------------- light config

  private wledDevices(): Device[] {
    return deviceManager.getAllDevices().filter(isWledDevice);
  }

  private toLight(d: Device): WledLight {
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    return {
      id: d.id,
      name: d.name,
      ip: String(meta.ip ?? ''),
      online: d.status === 'online',
      mode: (meta.mode as RgbMode) ?? 'manual',
      state: this.stateCache.get(d.id),
      ledCount: typeof meta.ledCount === 'number' ? meta.ledCount : undefined,
      version: typeof meta.version === 'string' ? meta.version : undefined,
      offSchedule: this.normalizeSchedule(meta.offSchedule),
    };
  }

  /** Coerce persisted metadata into a valid WledOffSchedule (or undefined). */
  private normalizeSchedule(raw: unknown): WledOffSchedule | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const s = raw as Record<string, unknown>;
    if (typeof s.time !== 'string' || !/^\d{2}:\d{2}$/.test(s.time)) return undefined;
    const days = Array.isArray(s.days)
      ? s.days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
      : undefined;
    return { enabled: !!s.enabled, time: s.time, days: days && days.length ? days : undefined };
  }

  listLights(): WledLight[] {
    return this.wledDevices().map((d) => this.toLight(d));
  }

  addLight(name: string, ip: string): WledLight {
    const device = deviceManager.registerDevice('esp32', name, ['led', 'rgb'], {
      kind: 'wled',
      ip,
      mode: 'manual',
    });
    deviceManager.updateDeviceStatus(device.id, 'offline');
    void this.poll(device.id);
    return this.toLight(deviceManager.getDevice(device.id)!);
  }

  updateLight(
    id: string,
    patch: { name?: string; ip?: string; mode?: RgbMode; offSchedule?: WledOffSchedule | null }
  ): WledLight | null {
    const device = deviceManager.getDevice(id);
    if (!device || !isWledDevice(device)) return null;
    const metadata = { ...(device.metadata as Record<string, unknown>) };
    if (patch.ip !== undefined) metadata.ip = patch.ip;
    if (patch.mode !== undefined) metadata.mode = patch.mode;
    if (patch.offSchedule !== undefined) {
      // `null` clears the schedule; otherwise store the normalized shape.
      const normalized = patch.offSchedule === null ? undefined : this.normalizeSchedule(patch.offSchedule);
      if (normalized) metadata.offSchedule = normalized;
      else delete metadata.offSchedule;
      this.offFiredAt.delete(id); // let an edited schedule fire again this minute
    }
    deviceManager.updateDevice(id, { name: patch.name, metadata });
    if (patch.ip) void this.poll(id);
    this.emitUpdate();
    return this.toLight(deviceManager.getDevice(id)!);
  }

  removeLight(id: string): boolean {
    const device = deviceManager.getDevice(id);
    if (!device || !isWledDevice(device)) return false;
    this.stateCache.delete(id);
    this.tempThrottle.delete(id);
    this.offFiredAt.delete(id);
    const ok = deviceManager.removeDevice(id);
    this.emitUpdate();
    return ok;
  }

  // ----------------------------------------------------------------- control

  async control(id: string, input: ControlInput): Promise<WledLight | null> {
    const device = deviceManager.getDevice(id);
    if (!device || !isWledDevice(device)) return null;
    const ip = String((device.metadata as any)?.ip ?? '');

    const body: Record<string, unknown> = {};
    if (input.on !== undefined) body.on = input.on;
    if (input.brightness !== undefined) {
      body.on = input.on ?? true;
      body.bri = clamp(Math.round((input.brightness / 100) * 255), 0, 255);
    }
    const seg: Record<string, unknown> = {};
    if (input.color !== undefined) seg.col = [toRgb(input.color)];
    if (input.effect !== undefined) seg.fx = input.effect;
    if (Object.keys(seg).length) {
      body.seg = [seg];
      if (body.on === undefined) body.on = true;
    }

    await this.applyState(ip, body);
    await this.poll(id);
    this.emitUpdate();
    return this.toLight(deviceManager.getDevice(id)!);
  }

  setMode(id: string, mode: RgbMode): WledLight | null {
    return this.updateLight(id, { mode });
  }

  async getEffects(id: string): Promise<string[]> {
    const device = deviceManager.getDevice(id);
    if (!device || !isWledDevice(device)) return [];
    const ip = String((device.metadata as any)?.ip ?? '');
    try {
      const eff = await this.getJson(ip, '/json/eff');
      return Array.isArray(eff) ? eff : [];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------- WLED HTTP

  private baseUrl(ip: string): string {
    return ip.startsWith('http') ? ip : `http://${ip}`;
  }

  private async getJson(ip: string, path: string): Promise<any> {
    const res = await fetch(this.baseUrl(ip) + path, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
    if (!res.ok) throw new Error(`WLED ${path} -> ${res.status}`);
    return res.json();
  }

  private async applyState(ip: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(this.baseUrl(ip) + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`WLED state -> ${res.status}`);
  }

  private parseState(json: any): WledState {
    const st = json?.state ?? {};
    const seg0 = (st.seg && st.seg[0]) || {};
    const col = (seg0.col && seg0.col[0]) || [255, 255, 255];
    const effects: string[] = json?.effects ?? [];
    const fx = seg0.fx ?? 0;
    return {
      on: !!st.on,
      brightness: Math.round(((st.bri ?? 0) / 255) * 100),
      color: [col[0] ?? 255, col[1] ?? 255, col[2] ?? 255],
      effect: fx,
      effectName: effects[fx],
    };
  }

  // ------------------------------------------------------------------ polling

  private async poll(id: string): Promise<void> {
    const device = deviceManager.getDevice(id);
    if (!device || !isWledDevice(device)) return;
    const ip = String((device.metadata as any)?.ip ?? '');
    try {
      const json = await this.getJson(ip, '/json');
      const state = this.parseState(json);
      this.stateCache.set(id, state);

      const meta = { ...(device.metadata as Record<string, unknown>) };
      const ledCount = json?.info?.leds?.count;
      const version = json?.info?.ver;
      if (typeof ledCount === 'number') meta.ledCount = ledCount;
      if (typeof version === 'string') meta.version = version;
      if (JSON.stringify(meta) !== JSON.stringify(device.metadata)) {
        deviceManager.updateDevice(id, { metadata: meta });
      }

      deviceManager.updateDeviceStatus(id, 'online');
      deviceManager.recordData(id, { ...state });
    } catch {
      deviceManager.updateDeviceStatus(id, 'offline');
    }
  }

  private async pollAll(): Promise<void> {
    const devices = this.wledDevices();
    await Promise.all(devices.map((d) => this.poll(d.id)));
    this.emitUpdate();
  }

  private emitUpdate(): void {
    eventSystem.emit('wled:update', this.listLights(), 'wled-service');
  }

  // ---------------------------------------------------------- auto-off timer

  /**
   * Turn off any light whose off-schedule matches the current minute. Runs once
   * a minute; the offFiredAt guard keeps it to a single shutdown per matching
   * minute even if the tick is invoked more than once.
   */
  private tickSchedules(): void {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.getDay();
    const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${hhmm}`;

    for (const device of this.wledDevices()) {
      const sched = this.normalizeSchedule((device.metadata as any)?.offSchedule);
      if (!sched || !sched.enabled) continue;
      if (sched.time !== hhmm) continue;
      if (sched.days && sched.days.length > 0 && !sched.days.includes(day)) continue;
      if (this.offFiredAt.get(device.id) === stamp) continue;
      this.offFiredAt.set(device.id, stamp);
      void this.control(device.id, { on: false }).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------- RGB engine

  private onEvent(event: DeskOSEvent): void {
    if (event.type.endsWith(':data')) {
      const localId = systemMonitor.getLocalDeviceId();
      if (localId && event.type === `device:${localId}:data`) {
        this.applyTemperatureMode(event.payload as SystemMetrics);
      }
      return;
    }
    if (event.type.startsWith('alert:') || event.priority === 'critical') {
      void this.applyAlarmMode();
    }
  }

  private applyTemperatureMode(metrics: SystemMetrics): void {
    const now = Date.now();
    const value = typeof metrics.cpuTempC === 'number'
      ? clamp(((metrics.cpuTempC - 40) / (85 - 40)) * 100, 0, 100)
      : (metrics.cpu ?? 0);
    const color = valueToColor(value);

    for (const device of this.wledDevices()) {
      if ((device.metadata as any)?.mode !== 'temperature' || device.status !== 'online') continue;
      const last = this.tempThrottle.get(device.id) ?? 0;
      if (now - last < this.tempIntervalMs) continue;
      this.tempThrottle.set(device.id, now);
      void this.control(device.id, { color, on: true }).catch(() => undefined);
    }
  }

  private async applyAlarmMode(): Promise<void> {
    for (const device of this.wledDevices()) {
      if ((device.metadata as any)?.mode !== 'alarm') continue;
      await this.control(device.id, { on: true, brightness: 100, color: [255, 0, 0] }).catch(() => undefined);
    }
  }
}

export const wledService = new WledService();
