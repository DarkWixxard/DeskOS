// Device Manager - Verwaltet alle Geräte
import { v4 as uuidv4 } from 'uuid';
import { eventSystem } from './EventSystem';
import type { Device, DeviceData } from '@shared/types';

// Canonical definitions live in @shared/types; re-exported here for backwards
// compatibility with existing `import { Device } from './DeviceManager'` callers.
export type { Device, DeviceData };

export class DeviceManager {
  private devices: Map<string, Device> = new Map();
  private deviceData: Map<string, DeviceData[]> = new Map();
  private maxDataPoints = 1000;

  /**
   * Register a new device
   */
  registerDevice(
    type: Device['type'],
    name: string,
    capabilities: string[] = [],
    metadata: Record<string, unknown> = {}
  ): Device {
    const device: Device = {
      id: uuidv4(),
      type,
      name,
      status: 'online',
      lastSeen: Date.now(),
      metadata,
      capabilities
    };

    this.devices.set(device.id, device);
    this.deviceData.set(device.id, []);

    eventSystem.emit('device:registered', device, 'device-manager');

    return device;
  }

  /**
   * Load a previously persisted device back into memory (e.g. on startup).
   * Does not emit `device:registered` so it is not re-persisted, and keeps the
   * stored id/status as-is (restored devices come back as `offline`).
   */
  loadDevice(device: Device): Device {
    this.devices.set(device.id, device);
    if (!this.deviceData.has(device.id)) {
      this.deviceData.set(device.id, []);
    }
    eventSystem.emit('device:loaded', { deviceId: device.id }, 'device-manager');
    return device;
  }

  /**
   * Update device status
   */
  updateDeviceStatus(
    deviceId: string,
    status: Device['status']
  ): Device | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    const oldStatus = device.status;
    device.status = status;
    device.lastSeen = Date.now();

    if (oldStatus !== status) {
      eventSystem.emit('device:status-changed', {
        deviceId,
        oldStatus,
        newStatus: status
      }, 'device-manager');
    }

    return device;
  }

  /**
   * Record device data
   */
  recordData(deviceId: string, data: Record<string, unknown>): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`Device ${deviceId} not found`);
      return;
    }

    const deviceData: DeviceData = {
      deviceId,
      timestamp: Date.now(),
      data
    };

    let history = this.deviceData.get(deviceId);
    if (!history) {
      history = [];
      this.deviceData.set(deviceId, history);
    }

    history.push(deviceData);

    // Keep only recent data
    if (history.length > this.maxDataPoints) {
      history.shift();
    }

    device.lastSeen = Date.now();

    eventSystem.emit(`device:${deviceId}:data`, data, 'device-manager');
  }

  /**
   * Update editable device fields (name/metadata) and persist via event.
   */
  updateDevice(
    deviceId: string,
    patch: { name?: string; metadata?: Record<string, unknown> }
  ): Device | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    if (typeof patch.name === 'string' && patch.name.trim()) device.name = patch.name.trim();
    if (patch.metadata !== undefined) device.metadata = patch.metadata;
    device.lastSeen = Date.now();

    eventSystem.emit('device:updated', device, 'device-manager');
    return device;
  }

  /**
   * Get device by ID
   */
  getDevice(deviceId: string): Device | null {
    return this.devices.get(deviceId) || null;
  }

  /**
   * Get all devices
   */
  getAllDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  /**
   * Find a device by name and type.
   */
  findDeviceByNameAndType(name: string, type: Device['type']): Device | null {
    return Array.from(this.devices.values()).find(
      (device) => device.name === name && device.type === type
    ) || null;
  }

  /**
   * Register or update a device when an agent reconnects.
   */
  registerOrUpdateDevice(
    type: Device['type'],
    name: string,
    capabilities: string[] = [],
    metadata: Record<string, unknown> = {},
    deviceId?: string
  ): Device {
    let device: Device | null = null;

    if (deviceId) {
      device = this.devices.get(deviceId) || null;
    }

    if (!device) {
      device = this.findDeviceByNameAndType(name, type);
    }

    if (device) {
      device.capabilities = capabilities;
      device.metadata = metadata;
      device.lastSeen = Date.now();
      this.updateDeviceStatus(device.id, 'online');
      return device;
    }

    return this.registerDevice(type, name, capabilities, metadata);
  }

  /**
   * Get devices by type
   */
  getDevicesByType(type: Device['type']): Device[] {
    return Array.from(this.devices.values()).filter(d => d.type === type);
  }

  /**
   * Get device data history
   */
  getDeviceData(deviceId: string, limit: number = 100): DeviceData[] {
    const data = this.deviceData.get(deviceId) || [];
    return data.slice(-limit);
  }

  /**
   * Remove device
   */
  removeDevice(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    this.deviceData.delete(deviceId);

    if (removed) {
      eventSystem.emit('device:removed', { deviceId }, 'device-manager');
    }

    return removed;
  }
}

export const deviceManager = new DeviceManager();
