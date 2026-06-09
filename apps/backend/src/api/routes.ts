// Express API Routes
import { Express } from 'express';
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import { systemMonitor } from '../services/SystemMonitor';

export function setupRoutes(app: Express): void {
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Devices
  app.get('/api/devices', (req, res) => {
    const devices = deviceManager.getAllDevices();
    res.json(devices);
  });

  app.get('/api/devices/:id', (req, res) => {
    const device = deviceManager.getDevice(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const data = deviceManager.getDeviceData(req.params.id, 100);
    res.json({ device, data });
  });

  app.get('/api/devices/:id/data', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const data = deviceManager.getDeviceData(req.params.id, limit);
    res.json(data);
  });

  app.delete('/api/devices/:id', (req, res) => {
    const removed = deviceManager.removeDevice(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json({ success: true, deviceId: req.params.id });
  });

  // System metrics
  app.get('/api/system/metrics', (req, res) => {
    const metrics = systemMonitor.getCurrentMetrics();
    res.json(metrics);
  });

  // Events
  app.get('/api/events', (req, res) => {
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const history = eventSystem.getHistory(type, limit);
    res.json(history);
  });

  // Dashboard summary
  app.get('/api/dashboard/summary', (req, res) => {
    const devices = deviceManager.getAllDevices();
    const onlineDevices = devices.filter(d => d.status === 'online').length;
    const metrics = systemMonitor.getCurrentMetrics();
    const recentEvents = eventSystem.getHistory(undefined, 50);

    res.json({
      devices: {
        total: devices.length,
        online: onlineDevices,
        offline: devices.length - onlineDevices
      },
      system: metrics,
      recentEvents: recentEvents.slice(-10)
    });
  });

  // Not found
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}
