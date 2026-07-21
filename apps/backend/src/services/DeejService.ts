// deej Service — hardware volume mixer integration.
//
// Brings the open-source "deej" project (https://github.com/omriharel/deej) into
// DeskOS. A deej box is an Arduino/ESP with a handful of potentiometers that
// streams its slider positions over USB serial as a single pipe-separated line,
// e.g. "512|1023|0|340\r\n" (each value 0–1023). This service:
//
//   1. opens the serial port and reads those lines,
//   2. normalises each slider to 0–100 %, optionally inverted + noise-reduced,
//   3. applies the value to the slider's mapped target (master / mic / an app)
//      via the AudioController, and
//   4. broadcasts the live slider state to the dashboard ('deej:update').
//
// Like the WLED/Display services, the whole configuration (port, baud, mapping)
// lives on a backing Device's metadata, so it is persisted + restored for free
// and shows up in the Device Center. `serialport` is an OPTIONAL dependency: it
// is imported lazily, so DeskOS still runs (and the mapping UI still works via
// manual/simulated input) on a box where the native module isn't installed.

import { deviceManager } from '../core/DeviceManager';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import { audioController } from './AudioController';
import type { Device } from '../core/DeviceManager';
import type { DeejSlider, DeejStatus, DeejTarget, DeejNoiseReduction } from '@shared/types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isDeejDevice = (d: Device) => (d.metadata as any)?.kind === 'deej';

// deej firmware sends 10-bit ADC readings (0–1023).
const ADC_MAX = 1023;

// How much a slider must move (in %) before we push a new volume. Mirrors deej's
// noise_reduction: more reduction = larger threshold = calmer, less twitchy.
const NOISE_THRESHOLD: Record<DeejNoiseReduction, number> = {
  low: 1.5,
  default: 3,
  high: 5,
};

interface StoredSlider {
  index: number;
  target: DeejTarget;
  app?: string;
  label: string;
  muted?: boolean;
}

interface DeejConfig {
  port: string;
  baud: number;
  invert: boolean;
  noiseReduction: DeejNoiseReduction;
  sliders: StoredSlider[];
}

interface ConfigPatch {
  port?: string;
  baud?: number;
  invert?: boolean;
  noiseReduction?: DeejNoiseReduction;
  sliderCount?: number;
}

interface SliderPatch {
  target?: DeejTarget;
  app?: string;
  label?: string;
  muted?: boolean;
}

const DEFAULT_LABELS = ['Master', 'Mikrofon', 'Spiel', 'Musik', 'Chat', 'Browser', 'System', 'Regler 8'];

function defaultSliders(count: number): StoredSlider[] {
  return Array.from({ length: count }, (_, i) => {
    let target: DeejTarget = 'unmapped';
    if (i === 0) target = 'master';
    else if (i === 1) target = 'mic';
    return { index: i, target, label: DEFAULT_LABELS[i] ?? `Regler ${i + 1}`, muted: false };
  });
}

export class DeejService {
  // Live slider values (0–100), keyed by slider index. Kept in memory only —
  // the mapping is persisted, the momentary reading is not.
  private readonly values = new Map<number, number>();
  private serialAvailable = false;
  private connected = false;
  private port: any = null; // SerialPort instance (typed loosely — optional dep)
  private rxBuffer = '';
  private lastLine = '';
  private emitTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  // ---------------------------------------------------------------- lifecycle

  /** Seed a single deej device on first run (disconnected until the user connects). */
  seedDefaults(): void {
    if (this.device()) return;
    const config: DeejConfig = {
      port: process.env.DEEJ_PORT || '',
      baud: Number(process.env.DEEJ_BAUD) || 9600,
      invert: process.env.DEEJ_INVERT === 'true',
      noiseReduction: (process.env.DEEJ_NOISE as DeejNoiseReduction) || 'default',
      sliders: defaultSliders(Number(process.env.DEEJ_SLIDERS) || 4),
    };
    const device = deviceManager.registerDevice('Arduino', 'deej Volume Mixer', ['audio'], {
      kind: 'deej',
      ...config,
    });
    deviceManager.updateDeviceStatus(device.id, 'offline');
  }

  async attach(): Promise<void> {
    // Automations / layout scenes can drive volume via a 'deej:command' event.
    eventSystem.on('deej:command', (e) => this.onCommand(e));
    await this.probeSerial();
    // Auto-connect on boot when a port is configured and opt-in flag is set.
    if (process.env.DEEJ_AUTOCONNECT === 'true' && this.config()?.port) {
      this.connect().catch(() => undefined);
    }
    this.emitUpdate();
  }

  stop(): void {
    if (this.emitTimer) {
      clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
    this.closePort();
    audioController.dispose();
  }

  private onCommand(event: DeskOSEvent): void {
    // { index?, target?, value, muted? } — set a slider (by index or by target).
    const cmd = (event.payload ?? {}) as { index?: number; target?: DeejTarget; value?: number; muted?: boolean };
    const sliders = this.storedSliders();
    const targets = cmd.index != null
      ? sliders.filter((s) => s.index === cmd.index)
      : cmd.target
        ? sliders.filter((s) => s.target === cmd.target)
        : [];
    for (const s of targets) {
      if (cmd.muted !== undefined) this.updateSlider(s.index, { muted: cmd.muted });
      if (cmd.value !== undefined) void this.setVolume(s.index, cmd.value);
    }
  }

  // ------------------------------------------------------------- device/config

  private device(): Device | null {
    return deviceManager.getAllDevices().find(isDeejDevice) ?? null;
  }

  private config(): DeejConfig | null {
    const d = this.device();
    if (!d) return null;
    const m = (d.metadata ?? {}) as Record<string, unknown>;
    return {
      port: String(m.port ?? ''),
      baud: typeof m.baud === 'number' ? m.baud : 9600,
      invert: m.invert === true,
      noiseReduction: (m.noiseReduction as DeejNoiseReduction) ?? 'default',
      sliders: Array.isArray(m.sliders) ? (m.sliders as StoredSlider[]) : defaultSliders(4),
    };
  }

  private storedSliders(): StoredSlider[] {
    return this.config()?.sliders ?? [];
  }

  private writeConfig(patch: Partial<DeejConfig>): void {
    const d = this.device();
    if (!d) return;
    const metadata = { ...(d.metadata as Record<string, unknown>), ...patch };
    deviceManager.updateDevice(d.id, { metadata });
  }

  // --------------------------------------------------------------- public API

  getStatus(): DeejStatus {
    const d = this.device();
    const cfg = this.config();
    const sliders: DeejSlider[] = (cfg?.sliders ?? []).map((s) => ({
      index: s.index,
      target: s.target,
      app: s.app,
      label: s.label,
      muted: s.muted ?? false,
      value: Math.round(this.values.get(s.index) ?? 0),
    }));
    return {
      id: d?.id ?? '',
      connected: this.connected,
      available: this.serialAvailable,
      port: cfg?.port ?? '',
      baud: cfg?.baud ?? 9600,
      invert: cfg?.invert ?? false,
      noiseReduction: cfg?.noiseReduction ?? 'default',
      platform: audioController.platform,
      perAppSupported: audioController.perAppSupported,
      sliders,
      lastLine: this.lastLine || undefined,
      updatedAt: Date.now(),
    };
  }

  /** List the serial ports the OS currently exposes (needs the serialport dep). */
  async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    const SerialPort = await this.loadSerial();
    if (!SerialPort) return [];
    try {
      const ports = await SerialPort.list();
      return ports.map((p: any) => ({ path: p.path, manufacturer: p.manufacturer }));
    } catch {
      return [];
    }
  }

  updateConfig(patch: ConfigPatch): DeejStatus {
    const cfg = this.config();
    const next: Partial<DeejConfig> = {};
    if (patch.port !== undefined) next.port = String(patch.port);
    if (patch.baud !== undefined) next.baud = clamp(Math.round(patch.baud), 300, 2_000_000);
    if (patch.invert !== undefined) next.invert = !!patch.invert;
    if (patch.noiseReduction !== undefined) next.noiseReduction = patch.noiseReduction;
    if (patch.sliderCount !== undefined && cfg) {
      // Grow/shrink the slider list, preserving existing mappings.
      const count = clamp(Math.round(patch.sliderCount), 1, 8);
      const existing = cfg.sliders;
      next.sliders = Array.from({ length: count }, (_, i) => existing[i] ?? defaultSliders(count)[i]);
    }
    this.writeConfig(next);
    this.emitUpdate();
    return this.getStatus();
  }

  updateSlider(index: number, patch: SliderPatch): DeejStatus {
    const cfg = this.config();
    if (!cfg) return this.getStatus();
    const sliders = cfg.sliders.map((s) => {
      if (s.index !== index) return s;
      const merged: StoredSlider = { ...s };
      if (patch.target !== undefined) merged.target = patch.target;
      if (patch.app !== undefined) merged.app = patch.app;
      if (patch.label !== undefined) merged.label = patch.label.trim() || s.label;
      if (patch.muted !== undefined) merged.muted = patch.muted;
      return merged;
    });
    this.writeConfig({ sliders });
    // Re-apply so a mapping/mute change takes effect immediately.
    const changed = sliders.find((s) => s.index === index);
    if (changed) void this.applySlider(changed, this.values.get(index) ?? 0);
    this.emitUpdate();
    return this.getStatus();
  }

  /** Manually set a slider's value (0–100) — drives the UI + OS volume without hardware. */
  async setVolume(index: number, value: number): Promise<DeejStatus> {
    const v = clamp(Math.round(value), 0, 100);
    this.values.set(index, v);
    const slider = this.storedSliders().find((s) => s.index === index);
    if (slider) await this.applySlider(slider, v);
    this.emitUpdate();
    return this.getStatus();
  }

  /** Feed a raw serial line manually (used by the "test" button + unit tests). */
  processLine(line: string): void {
    const cfg = this.config();
    if (!cfg) return;
    this.lastLine = line.trim();
    const parts = this.lastLine.split('|');
    const threshold = NOISE_THRESHOLD[cfg.noiseReduction];

    for (let i = 0; i < parts.length; i++) {
      const raw = Number(parts[i]);
      if (!Number.isFinite(raw)) continue;
      let pct = clamp((raw / ADC_MAX) * 100, 0, 100);
      if (cfg.invert) pct = 100 - pct;
      const prev = this.values.get(i);
      if (prev !== undefined && !significantlyDifferent(prev, pct, threshold)) continue;
      this.values.set(i, pct);
      const slider = cfg.sliders.find((s) => s.index === i);
      if (slider) void this.applySlider(slider, pct);
    }
    this.markDirty();
  }

  // ------------------------------------------------------------- volume apply

  private async applySlider(slider: StoredSlider, value: number): Promise<void> {
    const v = slider.muted ? 0 : clamp(Math.round(value), 0, 100);
    switch (slider.target) {
      case 'master':
        await audioController.setMaster(v);
        if (slider.muted !== undefined) await audioController.setMasterMute(!!slider.muted);
        break;
      case 'mic':
        await audioController.setMic(v);
        break;
      case 'app':
        if (slider.app) await audioController.setApp(slider.app, v);
        break;
      // 'system' and 'unmapped' are tracked in the UI but not pushed to the OS.
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- serial IO

  /** Lazily import the optional `serialport` dependency (null if unavailable). */
  private async loadSerial(): Promise<any> {
    try {
      // Indirect specifier: `serialport` is an OPTIONAL dependency, so we must
      // not let TypeScript/the bundler try to statically resolve it at build time.
      const moduleName = ['serial', 'port'].join('');
      const mod: any = await import(moduleName);
      this.serialAvailable = true;
      return mod.SerialPort ?? mod.default?.SerialPort ?? null;
    } catch {
      this.serialAvailable = false;
      return null;
    }
  }

  private async probeSerial(): Promise<void> {
    await this.loadSerial();
  }

  async connect(): Promise<DeejStatus> {
    const cfg = this.config();
    if (!cfg?.port) throw new Error('Kein serieller Port konfiguriert');
    const SerialPort = await this.loadSerial();
    if (!SerialPort) {
      throw new Error("Das optionale Paket 'serialport' ist nicht installiert (npm i serialport im Backend).");
    }
    this.closePort();

    await new Promise<void>((resolve, reject) => {
      try {
        this.port = new SerialPort({ path: cfg.port, baudRate: cfg.baud }, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.rxBuffer = '';
    this.port.on('data', (chunk: Buffer) => this.onData(chunk));
    this.port.on('error', (err: Error) => {
      console.error('[deej] serial error:', err.message);
    });
    this.port.on('close', () => this.markDisconnected());

    this.connected = true;
    const d = this.device();
    if (d) deviceManager.updateDeviceStatus(d.id, 'online');
    console.log(`🎚️  deej connected on ${cfg.port} @ ${cfg.baud} baud`);
    this.emitUpdate();
    return this.getStatus();
  }

  disconnect(): DeejStatus {
    this.closePort();
    this.markDisconnected();
    return this.getStatus();
  }

  private onData(chunk: Buffer): void {
    this.rxBuffer += chunk.toString('utf8');
    // Guard against a runaway buffer if newlines never arrive.
    if (this.rxBuffer.length > 4096) this.rxBuffer = this.rxBuffer.slice(-256);
    const lines = this.rxBuffer.split(/\r?\n/);
    this.rxBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) this.processLine(line);
    }
  }

  private closePort(): void {
    if (this.port) {
      try {
        if (this.port.isOpen) this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
  }

  private markDisconnected(): void {
    if (!this.connected && !this.device()) return;
    this.connected = false;
    const d = this.device();
    if (d) deviceManager.updateDeviceStatus(d.id, 'offline');
    this.emitUpdate();
  }

  // ------------------------------------------------------------- broadcasting

  // Serial lines arrive fast (~30/s). Coalesce updates onto a ~10 Hz timer so
  // the dashboard stays smooth without flooding the socket.
  private markDirty(): void {
    this.dirty = true;
    if (!this.emitTimer) {
      this.emitTimer = setInterval(() => {
        if (this.dirty) {
          this.dirty = false;
          this.emitUpdate();
        }
      }, 100);
      this.emitTimer.unref?.();
    }
  }

  private emitUpdate(): void {
    eventSystem.emit('deej:update', this.getStatus(), 'deej-service');
  }
}

/**
 * deej's "is this move worth acting on?" test: act when the slider moved by at
 * least `threshold` %, OR when it just hit an extreme (0/100) so full-off and
 * full-on are always reachable regardless of noise reduction. Exported for tests.
 */
export function significantlyDifferent(prev: number, next: number, threshold: number): boolean {
  if (Math.abs(next - prev) >= threshold) return true;
  const atExtreme = next <= 0.5 || next >= 99.5;
  const wasExtreme = prev <= 0.5 || prev >= 99.5;
  return atExtreme && !wasExtreme;
}

export const deejService = new DeejService();
