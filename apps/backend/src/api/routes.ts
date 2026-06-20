// Express API Routes
import { Express } from 'express';
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import { systemMonitor } from '../services/SystemMonitor';
import { automationEngine } from '../core/AutomationEngine';
import { v4 as uuidv4 } from 'uuid';

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
    const rule = automationEngine.getRule(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }
    if (typeof req.body.enabled === 'boolean') {
      rule.enabled = req.body.enabled;
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
