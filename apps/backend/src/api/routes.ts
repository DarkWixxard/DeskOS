// Express API Routes
import { Express } from 'express';
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import { systemMonitor } from '../services/SystemMonitor';
import { automationEngine } from '../core/AutomationEngine';
import { wledService } from '../services/WledService';
import { displayService } from '../services/DisplayService';
import { mqttService } from '../services/MqttService';
import { authEnabled } from './auth';
import { v4 as uuidv4 } from 'uuid';
import type { PersistenceService } from '../services/PersistenceService';
import type { NotificationService } from '../services/NotificationService';
import type { LayoutService } from '../services/LayoutService';
import type { SceneService } from '../services/SceneService';
import type { PluginRegistry } from '../services/PluginRegistry';
import type { SpotifyService, PlaybackAction } from '../services/SpotifyService';
import type { DiscordService } from '../services/DiscordService';
import type { BambuService, BambuAction } from '../services/BambuService';
import type { WebSocketServer } from '../services/WebSocketServer';
import type { LogLevel } from '@shared/types';

export interface RouteDeps {
  persistence?: PersistenceService;
  notifications?: NotificationService;
  layout?: LayoutService;
  scenes?: SceneService;
  plugins?: PluginRegistry;
  spotify?: SpotifyService;
  discord?: DiscordService;
  bambu?: BambuService;
  wsServer?: WebSocketServer;
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
    const { name, ip, mode, offSchedule } = req.body ?? {};
    const light = wledService.updateLight(req.params.id, { name, ip, mode, offSchedule });
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

  // ---- Displays / Info-Panels ----
  app.get('/api/displays', (req, res) => {
    res.json(displayService.listPanels());
  });

  app.post('/api/displays', (req, res) => {
    const { name, transport, target, source, text } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name erforderlich' });
    res.status(201).json(displayService.addPanel({ name: String(name), transport, target, source, text }));
  });

  app.patch('/api/displays/:id', (req, res) => {
    const panel = displayService.updatePanel(req.params.id, req.body ?? {});
    if (!panel) return res.status(404).json({ error: 'Display nicht gefunden' });
    res.json(panel);
  });

  app.delete('/api/displays/:id', (req, res) => {
    const ok = displayService.removePanel(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Display nicht gefunden' });
    res.json({ success: true, id: req.params.id });
  });

  app.post('/api/displays/:id/state', async (req, res) => {
    const { on, brightness } = req.body ?? {};
    const panel = await displayService.control(req.params.id, { on, brightness });
    if (!panel) return res.status(404).json({ error: 'Display nicht gefunden' });
    res.json(panel);
  });

  // ---- Layout / Profile System ----
  app.get('/api/layouts', (req, res) => {
    if (!deps.layout) return res.json({ profiles: [], activeId: null });
    res.json({ profiles: deps.layout.list(), activeId: deps.layout.getActiveId() });
  });

  app.post('/api/layouts', async (req, res) => {
    if (!deps.layout) return res.status(503).json({ error: 'Layout-Service nicht verfügbar' });
    const { name, icon, view, actions } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name erforderlich' });
    res.status(201).json(await deps.layout.create({ name, icon, view, actions: actions ?? [] }));
  });

  app.patch('/api/layouts/:id', async (req, res) => {
    if (!deps.layout) return res.status(503).json({ error: 'Layout-Service nicht verfügbar' });
    const updated = await deps.layout.update(req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json(updated);
  });

  app.delete('/api/layouts/:id', async (req, res) => {
    if (!deps.layout) return res.status(503).json({ error: 'Layout-Service nicht verfügbar' });
    const ok = await deps.layout.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json({ success: true, id: req.params.id });
  });

  app.post('/api/layouts/:id/activate', async (req, res) => {
    if (!deps.layout) return res.status(503).json({ error: 'Layout-Service nicht verfügbar' });
    const profile = await deps.layout.activate(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json(profile);
  });

  // ---- Scenes (Szenen) ----
  const scenesUnavailable = (res: any) => res.status(503).json({ error: 'Szenen-Service nicht verfügbar' });

  app.get('/api/scenes', (req, res) => {
    if (!deps.scenes) return res.json([]);
    res.json(deps.scenes.list());
  });

  app.post('/api/scenes', async (req, res) => {
    if (!deps.scenes) return scenesUnavailable(res);
    const { name, icon, color, actions, capture } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name erforderlich' });
    // `capture: true` snapshots the current WLED state; otherwise take the
    // provided actions (default: empty).
    const sceneActions = capture ? deps.scenes.captureLightActions() : actions ?? [];
    res.status(201).json(await deps.scenes.create({ name, icon, color, actions: sceneActions }));
  });

  app.patch('/api/scenes/:id', async (req, res) => {
    if (!deps.scenes) return scenesUnavailable(res);
    const updated = await deps.scenes.update(req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'Szene nicht gefunden' });
    res.json(updated);
  });

  app.delete('/api/scenes/:id', async (req, res) => {
    if (!deps.scenes) return scenesUnavailable(res);
    const ok = await deps.scenes.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Szene nicht gefunden' });
    res.json({ success: true, id: req.params.id });
  });

  app.post('/api/scenes/:id/apply', async (req, res) => {
    if (!deps.scenes) return scenesUnavailable(res);
    const scene = await deps.scenes.apply(req.params.id);
    if (!scene) return res.status(404).json({ error: 'Szene nicht gefunden' });
    res.json(scene);
  });

  // ---- Sensor Hub / MQTT nodes ----
  app.get('/api/sensors', (req, res) => {
    const nodes = deviceManager
      .getAllDevices()
      .filter((d) => (d.metadata as Record<string, unknown>)?.mqtt === true || d.capabilities.includes('sensor'));
    res.json(
      nodes.map((d) => ({
        device: d,
        latest: deviceManager.getDeviceData(d.id, 1)[0]?.data ?? null,
        modules: (d.metadata as Record<string, unknown>)?.modules ?? [],
      }))
    );
  });

  // Send a command to an MQTT node (by backing device id). Also used by the
  // Firmware Center for restart / wifi / ota actions.
  app.post('/api/devices/:id/command', (req, res) => {
    const sent = mqttService.sendCommandToDevice(req.params.id, req.body ?? {});
    res.json({ sent });
  });

  // ---- Plugin System v2 / Marketplace ----
  app.get('/api/plugins', (req, res) => {
    res.json(deps.plugins ? deps.plugins.list() : []);
  });

  const pluginAction = (handler: (reg: PluginRegistry, id: string, body: any) => Promise<unknown>) =>
    async (req: any, res: any) => {
      if (!deps.plugins) return res.status(503).json({ error: 'Plugin-Registry nicht verfügbar' });
      const result = await handler(deps.plugins, req.params.id, req.body ?? {});
      if (!result) return res.status(404).json({ error: 'Plugin nicht gefunden' });
      res.json(result);
    };

  app.post('/api/plugins/:id/install', pluginAction((reg, id) => reg.install(id)));
  app.post('/api/plugins/:id/uninstall', pluginAction((reg, id) => reg.uninstall(id)));
  app.post('/api/plugins/:id/enable', pluginAction((reg, id) => reg.setEnabled(id, true)));
  app.post('/api/plugins/:id/disable', pluginAction((reg, id) => reg.setEnabled(id, false)));
  app.patch('/api/plugins/:id/settings', pluginAction((reg, id, body) => reg.updateSettings(id, body)));

  // ---- Spotify (Media-Plugin) ----
  const spotifyUnavailable = (res: any) => res.status(503).json({ error: 'Spotify-Service nicht verfügbar' });

  app.get('/api/spotify/status', (req, res) => {
    if (!deps.spotify) return spotifyUnavailable(res);
    res.json(deps.spotify.getStatus());
  });

  // Liefert die Spotify-Login-URL; das Frontend öffnet sie in einem Popup.
  app.get('/api/spotify/login', (req, res) => {
    if (!deps.spotify) return spotifyUnavailable(res);
    try {
      res.json({ url: deps.spotify.getAuthUrl() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // OAuth-Redirect-Ziel (Browser-Navigation, ohne Token – siehe auth.ts).
  app.get('/api/spotify/callback', async (req, res) => {
    if (!deps.spotify) return res.status(503).send(oauthCallbackHtml('Spotify', 'Spotify-Service nicht verfügbar.', false, 'deskos:spotify'));
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return res.status(400).send(oauthCallbackHtml('Spotify', `Login abgebrochen: ${error}`, false, 'deskos:spotify'));
    if (!code || !state) return res.status(400).send(oauthCallbackHtml('Spotify', 'Fehlende Parameter im Callback.', false, 'deskos:spotify'));
    try {
      await deps.spotify.handleCallback(code, state);
      res.send(oauthCallbackHtml('Spotify', 'Spotify verbunden! Du kannst dieses Fenster schließen.', true, 'deskos:spotify'));
    } catch (err) {
      res.status(400).send(oauthCallbackHtml('Spotify', err instanceof Error ? err.message : 'Login fehlgeschlagen.', false, 'deskos:spotify'));
    }
  });

  app.get('/api/spotify/now-playing', async (req, res) => {
    if (!deps.spotify) return spotifyUnavailable(res);
    res.json(await deps.spotify.getNowPlaying());
  });

  app.post('/api/spotify/control/:action', async (req, res) => {
    if (!deps.spotify) return spotifyUnavailable(res);
    const action = req.params.action as PlaybackAction;
    if (!['play', 'pause', 'next', 'previous'].includes(action)) {
      return res.status(400).json({ error: 'Ungültige Aktion' });
    }
    res.json({ ok: await deps.spotify.control(action) });
  });

  app.post('/api/spotify/disconnect', async (req, res) => {
    if (!deps.spotify) return spotifyUnavailable(res);
    await deps.spotify.disconnect();
    res.json({ ok: true });
  });

  // ---- Discord (Communication-Plugin) ----
  // Verbindet das eigene Discord-KONTO per OAuth-Login (kein Bot-Token).
  const discordUnavailable = (res: any) => res.status(503).json({ error: 'Discord-Service nicht verfügbar' });

  app.get('/api/discord/status', (req, res) => {
    if (!deps.discord) return discordUnavailable(res);
    res.json(deps.discord.getStatus());
  });

  // Liefert die Discord-Login-URL; das Frontend öffnet sie in einem Popup.
  app.get('/api/discord/login', (req, res) => {
    if (!deps.discord) return discordUnavailable(res);
    try {
      res.json({ url: deps.discord.getAuthUrl() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // OAuth-Redirect-Ziel (Browser-Navigation, ohne Token – siehe auth.ts).
  app.get('/api/discord/callback', async (req, res) => {
    if (!deps.discord) return res.status(503).send(oauthCallbackHtml('Discord', 'Discord-Service nicht verfügbar.', false, 'deskos:discord'));
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return res.status(400).send(oauthCallbackHtml('Discord', `Login abgebrochen: ${error}`, false, 'deskos:discord'));
    if (!code || !state) return res.status(400).send(oauthCallbackHtml('Discord', 'Fehlende Parameter im Callback.', false, 'deskos:discord'));
    try {
      await deps.discord.handleCallback(code, state);
      res.send(oauthCallbackHtml('Discord', 'Discord-Konto verbunden! Du kannst dieses Fenster schließen.', true, 'deskos:discord'));
    } catch (err) {
      res.status(400).send(oauthCallbackHtml('Discord', err instanceof Error ? err.message : 'Login fehlgeschlagen.', false, 'deskos:discord'));
    }
  });

  app.get('/api/discord/profile', async (req, res) => {
    if (!deps.discord) return discordUnavailable(res);
    res.json(await deps.discord.getProfile());
  });

  app.post('/api/discord/disconnect', async (req, res) => {
    if (!deps.discord) return discordUnavailable(res);
    await deps.discord.disconnect();
    res.json({ ok: true });
  });

  // ---- Bambu Lab (3D-Drucker-Plugin) ----
  const bambuUnavailable = (res: any) => res.status(503).json({ error: 'Bambu-Service nicht verfügbar' });

  app.get('/api/bambu/status', (req, res) => {
    if (!deps.bambu) return bambuUnavailable(res);
    res.json(deps.bambu.getStatus());
  });

  app.post('/api/bambu/control/:action', (req, res) => {
    if (!deps.bambu) return bambuUnavailable(res);
    const action = req.params.action as BambuAction;
    if (!['pause', 'resume', 'stop'].includes(action)) {
      return res.status(400).json({ error: 'Ungültige Aktion' });
    }
    res.json({ ok: deps.bambu.control(action) });
  });

  // Cloud-Login Schritt 1: E-Mail + Passwort. Antwort-Status: ok | verifyCode | error.
  app.post('/api/bambu/cloud/login', async (req, res) => {
    if (!deps.bambu) return bambuUnavailable(res);
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string; region?: string };
    if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    const region = (req.body?.region === 'china' ? 'china' : 'global') as 'china' | 'global';
    res.json(await deps.bambu.cloudLogin(String(email), String(password), region));
  });

  // Cloud-Login Schritt 2: E-Mail-Code bestätigen.
  app.post('/api/bambu/cloud/code', async (req, res) => {
    if (!deps.bambu) return bambuUnavailable(res);
    const { email, code } = (req.body ?? {}) as { email?: string; code?: string; region?: string };
    if (!email || !code) return res.status(400).json({ error: 'E-Mail und Code erforderlich' });
    const region = (req.body?.region === 'china' ? 'china' : 'global') as 'china' | 'global';
    res.json(await deps.bambu.cloudSubmitCode(String(email), String(code), region));
  });

  app.post('/api/bambu/cloud/logout', async (req, res) => {
    if (!deps.bambu) return bambuUnavailable(res);
    await deps.bambu.cloudLogout();
    res.json({ ok: true });
  });

  // ---- Security-Center ----
  // Liefert eine geheimnis-freie Momentaufnahme der Sicherheitslage des Backends
  // (Auth an/aus, CORS-Modus, Rate-Limit, Header, offene Verbindungen). Der Token
  // selbst wird NIE ausgeliefert – nur ob überhaupt einer gesetzt ist.
  app.get('/api/security/status', (req, res) => {
    const corsOrigins = (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const corsMode: 'all' | 'allowlist' | 'mirror' = corsOrigins.includes('*')
      ? 'all'
      : corsOrigins.length > 0
        ? 'allowlist'
        : 'mirror';

    res.json({
      auth: {
        enabled: authEnabled(),
        scheme: 'shared-token',
        // Wo der Token akzeptiert wird – hilft beim Einrichten weiterer Geräte.
        accepts: ['x-deskos-token', 'Authorization: Bearer', '?token='],
        websocketProtected: authEnabled(),
      },
      cors: {
        mode: corsMode,
        // Bei 'all'/'mirror' bleibt die Liste leer (Anfrage-Origin wird gespiegelt).
        origins: corsMode === 'allowlist' ? corsOrigins : [],
      },
      rateLimit: {
        windowMs: 60_000,
        max: Number(process.env.RATE_LIMIT_MAX) || 300,
      },
      headers: {
        helmet: true,
      },
      connections: {
        websocketClients: deps.wsServer ? deps.wsServer.getClientCount() : 0,
      },
      server: {
        env: process.env.NODE_ENV || 'development',
        uptimeSec: Math.round(process.uptime()),
      },
    });
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

// Kleine, eigenständige HTML-Seite für OAuth-Callbacks (Popup), von
// Spotify und Discord gemeinsam genutzt. Meldet das Ergebnis per
// postMessage an das Dashboard und schließt sich dann.
function oauthCallbackHtml(service: string, message: string, success: boolean, eventType: string): string {
  const accent = success ? '#00ff88' : '#ff0055';
  const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>DeskOS · ${service}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#05070d;
    color:#cfe9ff;font-family:ui-monospace,Menlo,Consolas,monospace}
  .card{max-width:420px;padding:28px 32px;border:1px solid ${accent}55;background:#0a0f1a;
    text-align:center;box-shadow:0 0 24px ${accent}33}
  .dot{width:14px;height:14px;border-radius:50%;background:${accent};margin:0 auto 14px;
    box-shadow:0 0 12px ${accent}}
  p{margin:0;font-size:14px;line-height:1.5}
  small{display:block;margin-top:14px;color:#6e8299}
</style></head>
<body><div class="card"><div class="dot"></div><p>${safe}</p>
<small>DeskOS · ${service}</small></div>
<script>
  try { if (window.opener) window.opener.postMessage({ type: '${eventType}', connected: ${success} }, '*'); } catch (e) {}
  ${success ? 'setTimeout(function(){ window.close(); }, 2200);' : ''}
</script>
</body></html>`;
}
