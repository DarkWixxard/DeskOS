// MQTT Service (M5)
//
// Bridges MQTT nodes (ESP32 / sensors) to the DeskOS core. Optionally starts an
// embedded broker (aedes) so the simulator + real nodes work out-of-the-box
// without external infrastructure; falls back to an external broker if one is
// configured or already running.
//
//   Topics: deskos/nodes/<nodeId>/{announce,telemetry,status,cmd}
//     announce  -> auto-register/update device (modules, capabilities)
//     telemetry -> record sensor readings
//     status    -> online/offline (LWT)
//     cmd       -> commands published to the node

import Aedes from 'aedes';
import { createServer, Server } from 'net';
import mqtt, { MqttClient } from 'mqtt';
import { deviceManager } from '../core/DeviceManager';
import type { Device } from '../core/DeviceManager';

const TOPIC_BASE = 'deskos/nodes';

export class MqttService {
  private broker?: Aedes;
  private brokerServer?: Server;
  private client?: MqttClient;
  private readonly nodeToDevice = new Map<string, string>();
  // Last logged client-error message — used to avoid flooding the console with
  // identical reconnect errors while no broker is reachable.
  private lastClientError?: string;

  async start(): Promise<void> {
    const port = Number(process.env.MQTT_PORT) || 1883;
    // Default to the IPv4 loopback (not "localhost") for the embedded broker:
    // on Windows "localhost" can resolve to ::1 while the broker binds IPv4,
    // which makes every local connect attempt fail and spam reconnect errors.
    const url = process.env.MQTT_BROKER || `mqtt://127.0.0.1:${port}`;

    // Embed a broker unless an external one is explicitly configured.
    if (process.env.MQTT_EMBEDDED !== 'false' && !process.env.MQTT_BROKER) {
      try {
        await this.startBroker(port);
        console.log(`📡 Embedded MQTT broker listening on :${port}`);
      } catch (err) {
        console.warn('⚠️ Embedded MQTT broker not started:', err instanceof Error ? err.message : err);
      }
    }

    this.connectClient(url);
  }

  private startBroker(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const user = process.env.MQTT_USERNAME;
      const pass = process.env.MQTT_PASSWORD ?? '';
      this.broker = new Aedes({
        // Ohne MQTT_USERNAME ist der Broker offen (Default: nur an localhost gebunden).
        authenticate: (_client, username, password, cb) => {
          if (!user) return cb(null, true);
          const ok = username === user && (password ? password.toString() : '') === pass;
          if (ok) return cb(null, true);
          // returnCode 4 = "Bad username or password" (aedes AuthErrorCode-Enum).
          const err = Object.assign(new Error('Auth error'), { returnCode: 4 });
          cb(err as any, false);
        },
      });
      this.brokerServer = createServer(this.broker.handle);
      this.brokerServer.once('error', reject);
      this.brokerServer.listen(port, () => resolve());
    });
  }

  private connectClient(url: string): void {
    this.client = mqtt.connect(url, {
      reconnectPeriod: 5000,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    });
    this.client.on('connect', () => {
      this.lastClientError = undefined;
      console.log('📡 MQTT client connected');
      this.client!.subscribe([`${TOPIC_BASE}/+/announce`, `${TOPIC_BASE}/+/telemetry`, `${TOPIC_BASE}/+/status`]);
    });
    this.client.on('message', (topic, payload) => this.handleMessage(topic, payload));
    this.client.on('error', (err) => {
      // MQTT is optional (ESP32 / sensor nodes). With reconnectPeriod set, a
      // missing broker would otherwise log the same error every few seconds, so
      // only surface a given error once — until it changes or we reconnect.
      const msg = (err && (err.message || (err as NodeJS.ErrnoException).code)) || String(err);
      if (msg !== this.lastClientError) {
        this.lastClientError = msg;
        console.warn(
          `⚠️ MQTT not reachable (${url}): ${msg} — ESP32/sensor features stay disabled until a broker is available. Safe to ignore if you don't use MQTT nodes.`
        );
      }
    });
  }

  /** Parse and dispatch an incoming node message. Public for unit testing. */
  handleMessage(topic: string, payload: Buffer): void {
    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'deskos' || parts[1] !== 'nodes') return;
    const nodeId = parts[2];
    const kind = parts[3];

    if (kind === 'status') {
      this.onStatus(nodeId, payload.toString());
      return;
    }

    let data: any = {};
    try {
      data = JSON.parse(payload.toString() || '{}');
    } catch {
      return;
    }
    if (kind === 'announce') this.onAnnounce(nodeId, data);
    else if (kind === 'telemetry') this.onTelemetry(nodeId, data);
  }

  private findDevice(nodeId: string): Device | null {
    const mapped = this.nodeToDevice.get(nodeId);
    if (mapped) {
      const d = deviceManager.getDevice(mapped);
      if (d) return d;
    }
    const found = deviceManager.getAllDevices().find((d) => (d.metadata as any)?.nodeId === nodeId);
    if (found) {
      this.nodeToDevice.set(nodeId, found.id);
      return found;
    }
    return null;
  }

  private onAnnounce(nodeId: string, data: any): void {
    const type: Device['type'] = data?.type === 'sensor' ? 'sensor' : 'esp32';
    const capabilities: string[] = Array.isArray(data?.capabilities) ? data.capabilities : [];
    const meta = { mqtt: true, nodeId, modules: data?.modules ?? [], fw: data?.fw };

    const existing = this.findDevice(nodeId);
    if (existing) {
      deviceManager.updateDevice(existing.id, {
        name: data?.name ?? existing.name,
        metadata: { ...existing.metadata, ...meta },
      });
      deviceManager.updateDeviceStatus(existing.id, 'online');
    } else {
      const device = deviceManager.registerDevice(type, data?.name ?? nodeId, capabilities, meta);
      this.nodeToDevice.set(nodeId, device.id);
    }
  }

  private onTelemetry(nodeId: string, data: any): void {
    let device = this.findDevice(nodeId);
    if (!device) {
      // Telemetry before an announce -> register a minimal node.
      device = deviceManager.registerDevice('sensor', nodeId, ['sensor'], { mqtt: true, nodeId, modules: [] });
      this.nodeToDevice.set(nodeId, device.id);
    }
    deviceManager.updateDeviceStatus(device.id, 'online');
    deviceManager.recordData(device.id, data && typeof data === 'object' ? data : { value: data });
  }

  private onStatus(nodeId: string, status: string): void {
    const device = this.findDevice(nodeId);
    if (device) deviceManager.updateDeviceStatus(device.id, status.trim() === 'online' ? 'online' : 'offline');
  }

  /** Publish a command to a node by its backing device id. */
  sendCommandToDevice(deviceId: string, cmd: unknown): boolean {
    const device = deviceManager.getDevice(deviceId);
    const nodeId = (device?.metadata as any)?.nodeId as string | undefined;
    if (!device || !nodeId || !this.client?.connected) return false;
    this.client.publish(`${TOPIC_BASE}/${nodeId}/cmd`, JSON.stringify(cmd ?? {}));
    return true;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.client) this.client.end(true, {}, () => resolve());
      else resolve();
    });
    this.brokerServer?.close();
    this.broker?.close();
  }
}

export const mqttService = new MqttService();
