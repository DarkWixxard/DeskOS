// Express API Routes
import { Express } from 'express';
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import { systemMonitor } from '../services/SystemMonitor';
import { automationEngine } from '../core/AutomationEngine';
import { wledService } from '../services/WledService';
import { v4 as uuidv4 } from 'uuid';
import type { PersistenceService } from '../services/PersistenceService';
import type { NotificationService } from '../services/NotificationService';
import type { LogLevel } from '@shared/types';

export interface RouteDeps {
  persistence?: PersistenceService;
  notifications?: NotificationService;
}

export function setupRoutes(app: Express, deps: RouteDeps = {}): void {
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

  app.get('/api/devices/:id/data', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    let data = deviceManager.getDeviceData(req.params.id, limit);
    // Fall back to durable history (survives restarts) when the in-memory
    // buffer is empty, e.g. right after a backend restart.
    if (data.length === 0 && deps.persistence) {
      data = await deps.persistence.getDeviceHistory(req.params.id, limit);
    }
    res.json(data);
  });

  app.patch('/api/devices/:id', (req, res) => {
    const { name, metadata } = req.body ?? {};
    const updated = deviceManager.updateDevice(req.params.id, { name, metadata });
    if (!updated) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(updated);
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

  // Logs (persisted) - durable, survives restarts. Foundation for the Log
  // Center view (M2).
  app.get('/api/logs', async (req, res) => {
    if (!deps.persistence) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const level = req.query.level as LogLevel | undefined;
    const logs = await deps.persistence.getLogs(limit, level);
    res.json(logs);
  });

  // Notifications (Notification Center)
  app.get('/api/notifications', async (req, res) => {
    if (!deps.notifications) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    res.json(await deps.notifications.list(limit, unreadOnly));
  });

  app.get('/api/notifications/unread-count', async (req, res) => {
    const count = deps.notifications ? await deps.notifications.unreadCount() : 0;
    res.json({ count });
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    if (deps.notifications) await deps.notifications.markRead(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/notifications/read-all', async (req, res) => {
    if (deps.notifications) await deps.notifications.markAllRead();
    res.json({ success: true });
  });

  // ---- WLED / RGB Engine ----
  app.get('/api/wled/lights', (req, res) => {
    res.json(wledService.listLights());
  });

  app.post('/api/wled/lights', (req, res) => {
    const { name, ip } = req.body ?? {};
    if (!name || !ip) return res.status(400).json({ error: 'name und ip erforderlich' });
    res.status(201).json(wledService.addLight(String(name), String(ip)));
  });

  app.patch('/api/wled/lights/:id', (req, res) => {
    const { name, ip, mode } = req.body ?? {};
    const light = wledService.updateLight(req.params.id, { name, ip, mode });
    if (!light) return res.status(404).json({ error: 'WLED-Licht nicht gefunden' });
    res.json(light);
  });

  app.delete('/api/wled/lights/:id', (req, res) => {
    const ok = wledService.removeLight(req.params.id);
    if (!ok) return res.status(404).json({ error: 'WLED-Licht nicht gefunden' });
    res.json({ success: true, id: req.params.id });
  });

  app.post('/api/wled/lights/:id/state', async (req, res) => {
    try {
      const light = await wledService.control(req.params.id, req.body ?? {});
      if (!light) return res.status(404).json({ error: 'WLED-Licht nicht gefunden' });
      res.json(light);
    } catch (err) {
      res.status(502).json({ error: 'WLED nicht erreichbar', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/wled/lights/:id/mode', (req, res) => {
    const light = wledService.setMode(req.params.id, req.body?.mode);
    if (!light) return res.status(404).json({ error: 'WLED-Licht nicht gefunden' });
    res.json(light);
  });

  app.get('/api/wled/lights/:id/effects', async (req, res) => {
    res.json(await wledService.getEffects(req.params.id));
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

  // Automations
  app.get('/api/automations', (req, res) => {
    res.json(automationEngine.getAllRules());
  });

  app.post('/api/automations', (req, res) => {
    const rule = req.body;
    if (!rule.id) rule.id = uuidv4();
    if (!rule.cooldownMs) rule.cooldownMs = 60000;
    const created = automationEngine.addRule(rule);
    res.status(201).json(created);
  });

  app.delete('/api/automations/:id', (req, res) => {
    const removed = automationEngine.removeRule(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }
    res.json({ success: true, id: req.params.id });
  });

  app.patch('/api/automations/:id', (req, res) => {
    // Toggling via setEnabled emits an event so the change is persisted.
    if (typeof req.body.enabled === 'boolean') {
      const updated = automationEngine.setEnabled(req.params.id, req.body.enabled);
      if (!updated) {
        return res.status(404).json({ error: 'Automation rule not found' });
      }
      return res.json(updated);
    }
    const rule = automationEngine.getRule(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }
    res.json(rule);
  });

  // ---- Oszi (Oszilloskop) Service-Proxy: /api/oszi/* -> Flask-Dienst ----
  // Leitet die Anfragen der nativen "Oszi"-Ansicht an den Python/Flask-Dienst
  // weiter. So spricht das Frontend nur das Backend an -> kein CORS,
  // und der Oszi-Port bleibt intern (konfigurierbar via OSZI_URL/OSZI_PORT).
  const OSZI_TARGET =
    process.env.OSZI_URL ||
    `http://${process.env.OSZI_HOST || 'localhost'}:${process.env.OSZI_PORT || 4002}`;

  app.all('/api/oszi/*', async (req, res) => {
    // CORS-Preflight direkt beantworten
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      return res.sendStatus(204);
    }

    const subPath = req.originalUrl.replace(/^\/api\/oszi/, '') || '/';
    const target = OSZI_TARGET + subPath;

    try {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const headers: Record<string, string> = {};
      if (hasBody) headers['Content-Type'] = 'application/json';

      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      const disposition = upstream.headers.get('content-disposition');
      if (disposition) res.setHeader('Content-Disposition', disposition);

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      res.status(502).json({
        error: 'Oszi-Service nicht erreichbar',
        target,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Not found
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}
