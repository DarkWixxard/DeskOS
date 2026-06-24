// MqttService integration test: embedded broker + a fake ESP32 node.
import mqtt, { MqttClient } from 'mqtt';
import { mqttService } from '../src/services/MqttService';
import { deviceManager } from '../src/core/DeviceManager';

jest.setTimeout(15000);

const NODE = 'esp32-test';
const base = `deskos/nodes/${NODE}`;

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const findDev = () => deviceManager.getAllDevices().find((d) => (d.metadata as any)?.nodeId === NODE);

describe('MqttService', () => {
  let fake: MqttClient;

  beforeAll(async () => {
    const port = 18830 + Math.floor(Math.random() * 2000);
    process.env.MQTT_PORT = String(port);
    delete process.env.MQTT_BROKER;
    process.env.MQTT_EMBEDDED = 'true';

    await mqttService.start();
    await new Promise((r) => setTimeout(r, 700)); // let the service client connect + subscribe

    fake = mqtt.connect(`mqtt://localhost:${port}`);
    await new Promise<void>((res) => fake.on('connect', () => res()));
    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(async () => {
    await new Promise<void>((r) => fake.end(true, {}, () => r()));
    await mqttService.stop();
  });

  test('announce auto-registers a node with its modules', async () => {
    fake.publish(
      `${base}/announce`,
      JSON.stringify({
        name: 'Test Node',
        type: 'sensor',
        capabilities: ['sensor', 'led'],
        modules: [{ id: 'env', type: 'sensor', sensors: ['temperature'] }],
        fw: 't1',
      }),
      { retain: true }
    );

    await waitFor(() => !!findDev());
    const dev = findDev()!;
    expect(dev.name).toBe('Test Node');
    expect(dev.type).toBe('sensor');
    expect((dev.metadata as any).modules[0].id).toBe('env');
    expect((dev.metadata as any).mqtt).toBe(true);
  });

  test('telemetry is recorded as device data', async () => {
    fake.publish(`${base}/telemetry`, JSON.stringify({ temperature: 23.4, humidity: 50 }));
    const dev = findDev()!;
    await waitFor(() => {
      const latest = deviceManager.getDeviceData(dev.id, 1)[0]?.data as any;
      return latest?.temperature === 23.4;
    });
    expect((deviceManager.getDeviceData(dev.id, 1)[0].data as any).humidity).toBe(50);
  });

  test('sendCommandToDevice publishes to the node cmd topic', async () => {
    const dev = findDev()!;
    let received: any = null;
    fake.subscribe(`${base}/cmd`);
    fake.on('message', (topic, payload) => {
      if (topic === `${base}/cmd`) received = JSON.parse(payload.toString());
    });
    await new Promise((r) => setTimeout(r, 150)); // ensure subscription is active

    const ok = mqttService.sendCommandToDevice(dev.id, { action: 'led', color: [255, 0, 0] });
    expect(ok).toBe(true);
    await waitFor(() => received !== null);
    expect(received.action).toBe('led');
    expect(received.color).toEqual([255, 0, 0]);
  });
});
