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

  async start(): Promise<void> {
    const port = Number(process.env.MQTT_PORT) || 1883;
    const url = process.env.MQTT_BROKER || `mqtt://localhost:${port}`;

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
      this.broker = new Aedes();
      this.brokerServer = createServer(this.broker.handle);
      this.brokerServer.once('error', reject);
      this.brokerServer.listen(port, () => resolve());
    });
  }

  private connectClient(url: string): void {
    this.client = mqtt.connect(url, { reconnectPeriod: 5000 });
    this.client.on('connect', () => {
      console.log('📡 MQTT client connected');
      this.client!.subscribe([`${TOPIC_BASE}/+/announce`, `${TOPIC_BASE}/+/telemetry`, `${TOPIC_BASE}/+/status`]);
    });
    this.client.on('message', (topic, payload) => this.handleMessage(topic, payload));
    this.client.on('error', (err) => console.warn('⚠️ MQTT client error:', err.message));
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
