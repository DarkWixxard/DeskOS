// Display Service — Info-Panels / Secondary Screens
//
// Manages secondary "info screens" on the desk: small ESP32/Pi-driven TFT/OLED
// panels, e-ink displays or a browser tab acting as a screen. Each panel is
// modelled as a Device (type 'esp32', capability 'display', metadata.kind
// 'display'), so it reuses the existing persistence + Device Center, exactly
// like WLED lights do.
//
// The service periodically *renders* a panel's chosen content source (clock,
// system stats, a sensor reading, custom text …) into a firmware-agnostic
// payload (a big title + a few lines + an accent color) and *pushes* it to the
// hardware — over HTTP for network panels or MQTT for ESP32 nodes. 'virtual'
// panels are preview-only and always render into the dashboard without any
// hardware attached, so the feature works out-of-the-box.

import { deviceManager } from '../core/DeviceManager';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import { systemMonitor } from './SystemMonitor';
import { mqttService } from './MqttService';
import type { Device } from '../core/DeviceManager';
import type { DisplayPanel, DisplaySource, DisplayTransport, DisplayContent, SystemMetrics } from '@shared/types';

interface AddInput {
  name: string;
  transport?: DisplayTransport;
  target?: string;
  source?: DisplaySource;
  text?: string;
}

interface PatchInput {
  name?: string;
  transport?: DisplayTransport;
  target?: string;
  source?: DisplaySource;
  text?: string;
  brightness?: number;
  sensorDeviceId?: string;
  sensorMetric?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isDisplayDevice = (d: Device) => (d.metadata as any)?.kind === 'display';

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

const ACCENT: [number, number, number] = [0, 217, 255]; // DeskOS holo cyan

export class DisplayService {
  private readonly contentCache = new Map<string, DisplayContent>();
  private renderTimer: NodeJS.Timeout | null = null;
  private readonly renderIntervalMs = Number(process.env.DISPLAY_RENDER_INTERVAL_MS) || 5000;
  private readonly requestTimeoutMs = 2500;

  // ---------------------------------------------------------------- lifecycle

  /** Seed one virtual clock panel on first run (when none exist yet). */
  seedDefaults(): void {
    const existing = deviceManager.getAllDevices().filter(isDisplayDevice);
    if (existing.length > 0) return;
    this.addPanel({ name: 'Schreibtisch-Panel', transport: 'virtual', source: 'clock' });
  }

  attach(): void {
    // Commands from automations / layout scenes.
    eventSystem.on('display:command', (e) => this.onCommand(e));
    void this.renderAll();
    this.renderTimer = setInterval(() => void this.renderAll(), this.renderIntervalMs);
    this.renderTimer.unref?.();
  }

  stop(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
  }

  private onCommand(event: DeskOSEvent): void {
    const cmd = (event.payload ?? {}) as {
      target?: string;
      on?: boolean;
      brightness?: number;
      source?: DisplaySource;
      text?: string;
    };
    const ids = !cmd.target || cmd.target === 'all' ? this.displayDevices().map((d) => d.id) : [cmd.target];
    for (const id of ids) {
      if (cmd.source !== undefined || cmd.text !== undefined || cmd.brightness !== undefined) {
        this.updatePanel(id, { source: cmd.source, text: cmd.text, brightness: cmd.brightness });
      }
      if (cmd.on !== undefined) void this.control(id, { on: cmd.on }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------- panel config

  private displayDevices(): Device[] {
    return deviceManager.getAllDevices().filter(isDisplayDevice);
  }

  private toPanel(d: Device): DisplayPanel {
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    const transport = (meta.transport as DisplayTransport) ?? 'virtual';
    return {
      id: d.id,
      name: d.name,
      transport,
      target: String(meta.target ?? ''),
      // Virtual panels are always "on-screen"; real panels track device status.
      online: transport === 'virtual' ? true : d.status === 'online',
      on: meta.on !== false,
      brightness: typeof meta.brightness === 'number' ? meta.brightness : 80,
      source: (meta.source as DisplaySource) ?? 'clock',
      text: typeof meta.text === 'string' ? meta.text : undefined,
      sensorDeviceId: typeof meta.sensorDeviceId === 'string' ? meta.sensorDeviceId : undefined,
      sensorMetric: typeof meta.sensorMetric === 'string' ? meta.sensorMetric : undefined,
      content: this.contentCache.get(d.id),
    };
  }

  listPanels(): DisplayPanel[] {
    return this.displayDevices().map((d) => this.toPanel(d));
  }

  addPanel(input: AddInput): DisplayPanel {
    const transport = input.transport ?? 'virtual';
    const device = deviceManager.registerDevice('esp32', input.name, ['display'], {
      kind: 'display',
      transport,
      target: input.target ?? '',
      on: true,
      brightness: 80,
      source: input.source ?? 'clock',
      text: input.text ?? '',
    });
    // Real panels start offline until the first successful push; virtual ones stay online.
    if (transport !== 'virtual') deviceManager.updateDeviceStatus(device.id, 'offline');
    this.render(device.id);
    void this.push(device.id).catch(() => undefined);
    this.emitUpdate();
    return this.toPanel(deviceManager.getDevice(device.id)!);
  }

  updatePanel(id: string, patch: PatchInput): DisplayPanel | null {
    const device = deviceManager.getDevice(id);
    if (!device || !isDisplayDevice(device)) return null;
    const metadata = { ...(device.metadata as Record<string, unknown>) };
    if (patch.transport !== undefined) metadata.transport = patch.transport;
    if (patch.target !== undefined) metadata.target = patch.target;
    if (patch.source !== undefined) metadata.source = patch.source;
    if (patch.text !== undefined) metadata.text = patch.text;
    if (patch.brightness !== undefined) metadata.brightness = clamp(Math.round(patch.brightness), 0, 100);
    if (patch.sensorDeviceId !== undefined) metadata.sensorDeviceId = patch.sensorDeviceId;
    if (patch.sensorMetric !== undefined) metadata.sensorMetric = patch.sensorMetric;
    deviceManager.updateDevice(id, { name: patch.name, metadata });
    this.render(id);
    void this.push(id).catch(() => undefined);
    this.emitUpdate();
    return this.toPanel(deviceManager.getDevice(id)!);
  }

  removePanel(id: string): boolean {
    const device = deviceManager.getDevice(id);
    if (!device || !isDisplayDevice(device)) return false;
    this.contentCache.delete(id);
    const ok = deviceManager.removeDevice(id);
    this.emitUpdate();
    return ok;
  }

  // ----------------------------------------------------------------- control

  async control(id: string, input: { on?: boolean; brightness?: number }): Promise<DisplayPanel | null> {
    const device = deviceManager.getDevice(id);
    if (!device || !isDisplayDevice(device)) return null;
    const metadata = { ...(device.metadata as Record<string, unknown>) };
    if (input.on !== undefined) metadata.on = input.on;
    if (input.brightness !== undefined) metadata.brightness = clamp(Math.round(input.brightness), 0, 100);
    deviceManager.updateDevice(id, { metadata });
    this.render(id);
    await this.push(id).catch(() => undefined);
    this.emitUpdate();
    return this.toPanel(deviceManager.getDevice(id)!);
  }

  // ------------------------------------------------------------------ render

  /** Build the firmware-agnostic content payload for a panel from live data. */
  private render(id: string): DisplayContent {
    const device = deviceManager.getDevice(id);
    const meta = (device?.metadata ?? {}) as Record<string, unknown>;
    const on = meta.on !== false;
    const source = (meta.source as DisplaySource) ?? 'clock';

    let content: DisplayContent;
    if (!on || source === 'blank') {
      content = { title: '', lines: [], updatedAt: Date.now() };
    } else if (source === 'clock') {
      content = this.renderClock();
    } else if (source === 'system') {
      content = this.renderSystem();
    } else if (source === 'sensor') {
      content = this.renderSensor(String(meta.sensorDeviceId ?? ''), String(meta.sensorMetric ?? ''));
    } else {
      content = this.renderText(String(meta.text ?? ''));
    }

    this.contentCache.set(id, content);
    return content;
  }

  private renderClock(): DisplayContent {
    const now = new Date();
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    return { title: time, lines: [date], color: ACCENT, updatedAt: Date.now() };
  }

  private renderSystem(): DisplayContent {
    const m: SystemMetrics = systemMonitor.getCurrentMetrics();
    const cpu = Math.round(m.cpu ?? 0);
    const ram = Math.round(m.ram?.percentage ?? 0);
    const temp = typeof m.cpuTempC === 'number' ? Math.round(m.cpuTempC) : null;
    const lines = [`RAM ${ram}%`, temp != null ? `Temp ${temp}°C` : m.hostname];
    // Colour by the hottest signal we have (temperature, else CPU load).
    const heat = temp != null ? clamp(((temp - 40) / (85 - 40)) * 100, 0, 100) : cpu;
    return { title: `CPU ${cpu}%`, lines, color: valueToColor(heat), updatedAt: Date.now() };
  }

  private renderSensor(deviceId: string, metric: string): DisplayContent {
    const device = deviceId ? deviceManager.getDevice(deviceId) : null;
    const latest = device ? (deviceManager.getDeviceData(device.id, 1)[0]?.data as Record<string, unknown> | undefined) : undefined;
    if (!device || !latest) {
      return { title: '—', lines: ['Kein Sensor', 'ausgewählt'], color: ACCENT, updatedAt: Date.now() };
    }
    // Prefer the chosen metric; otherwise fall back to the first numeric field.
    const key = metric && metric in latest ? metric : Object.keys(latest).find((k) => typeof latest[k] === 'number');
    const value = key ? latest[key] : undefined;
    const title = typeof value === 'number' ? `${Math.round(value * 10) / 10}` : String(value ?? '—');
    return { title, lines: [key ?? 'value', device.name], color: ACCENT, updatedAt: Date.now() };
  }

  private renderText(text: string): DisplayContent {
    const parts = (text || '').split('\n');
    return { title: parts[0] ?? '', lines: parts.slice(1), color: ACCENT, updatedAt: Date.now() };
  }

  // -------------------------------------------------------------------- push

  /** Best-effort delivery of the rendered content to the physical panel. */
  private async push(id: string): Promise<void> {
    const device = deviceManager.getDevice(id);
    if (!device || !isDisplayDevice(device)) return;
    const meta = (device.metadata ?? {}) as Record<string, unknown>;
    const transport = (meta.transport as DisplayTransport) ?? 'virtual';
    if (transport === 'virtual') return; // preview-only, nothing to deliver

    const content = this.contentCache.get(id) ?? this.render(id);
    const payload = {
      on: meta.on !== false,
      brightness: typeof meta.brightness === 'number' ? meta.brightness : 80,
      title: content.title,
      lines: content.lines,
      color: content.color,
    };

    if (transport === 'mqtt') {
      const ok = mqttService.sendCommandToDevice(id, { type: 'display', ...payload });
      deviceManager.updateDeviceStatus(id, ok ? 'online' : 'offline');
      return;
    }

    // HTTP: POST the payload to the panel's endpoint.
    const target = String(meta.target ?? '');
    if (!target) {
      deviceManager.updateDeviceStatus(id, 'offline');
      return;
    }
    try {
      const url = target.startsWith('http') ? target : `http://${target}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      deviceManager.updateDeviceStatus(id, res.ok ? 'online' : 'offline');
    } catch {
      deviceManager.updateDeviceStatus(id, 'offline');
    }
  }

  private async renderAll(): Promise<void> {
    const devices = this.displayDevices();
    for (const d of devices) this.render(d.id);
    await Promise.all(devices.map((d) => this.push(d.id).catch(() => undefined)));
    this.emitUpdate();
  }

  private emitUpdate(): void {
    eventSystem.emit('display:update', this.listPanels(), 'display-service');
  }
}

export const displayService = new DisplayService();
