// Unit Tests for Backend Core Services
import { EventSystem } from '../src/core/EventSystem';
import { DeviceManager } from '../src/core/DeviceManager';

describe('EventSystem', () => {
  let eventSystem: EventSystem;

  beforeEach(() => {
    eventSystem = new EventSystem();
  });

  test('should emit and receive events', async () => {
    let receivedEvent = null;

    eventSystem.on('test:event', (event) => {
      receivedEvent = event;
    });

    await eventSystem.emit('test:event', { message: 'hello' }, 'test-source');

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent?.type).toBe('test:event');
    expect(receivedEvent?.payload).toEqual({ message: 'hello' });
  });

  test('should maintain event history', async () => {
    await eventSystem.emit('test:event', { count: 1 }, 'test');
    await eventSystem.emit('test:event', { count: 2 }, 'test');

    const history = eventSystem.getHistory('test:event');
    expect(history.length).toBe(2);
  });

  test('should unsubscribe from events', async () => {
    let callCount = 0;

    const unsubscribe = eventSystem.on('test:event', () => {
      callCount++;
    });

    await eventSystem.emit('test:event', {}, 'test');
    expect(callCount).toBe(1);

    unsubscribe();
    await eventSystem.emit('test:event', {}, 'test');
    expect(callCount).toBe(1);
  });
});

describe('DeviceManager', () => {
  let deviceManager: DeviceManager;

  beforeEach(() => {
    deviceManager = new DeviceManager();
  });

  test('should register device', () => {
    const device = deviceManager.registerDevice(
      'local',
      'test-device',
      ['cpu', 'ram']
    );

    expect(device.id).toBeDefined();
    expect(device.type).toBe('local');
    expect(device.name).toBe('test-device');
    expect(device.status).toBe('online');
  });

  test('should get device', () => {
    const registered = deviceManager.registerDevice('local', 'test-device');
    const retrieved = deviceManager.getDevice(registered.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('test-device');
  });

  test('should update device status', () => {
    const device = deviceManager.registerDevice('local', 'test-device');
    const updated = deviceManager.updateDeviceStatus(device.id, 'offline');

    expect(updated?.status).toBe('offline');
  });

  test('should record and retrieve device data', () => {
    const device = deviceManager.registerDevice('local', 'test-device');
    const data = { cpu: 50, ram: 60 };

    deviceManager.recordData(device.id, data);
    const history = deviceManager.getDeviceData(device.id);

    expect(history.length).toBeGreaterThan(0);
    expect(history[0].data).toEqual(data);
  });
});
