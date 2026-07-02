// Main Server Entry Point
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { setupRoutes } from './api/routes';
import { requireToken, authEnabled } from './api/auth';
import { createWebSocketServer } from './services/WebSocketServer';
import { systemMonitor } from './services/SystemMonitor';
import { createDatabaseService } from './services/DatabaseService';
import { createPersistenceService } from './services/PersistenceService';
import { createNotificationService } from './services/NotificationService';
import { wledService } from './services/WledService';
import { displayService } from './services/DisplayService';
import { mqttService } from './services/MqttService';
import { createLayoutService } from './services/LayoutService';
import { createPluginRegistry } from './services/PluginRegistry';
import { createSpotifyService } from './services/SpotifyService';
import { createDiscordService } from './services/DiscordService';
import { pluginSystem } from './core/PluginSystem';
import { eventSystem } from './core/EventSystem';
import { deviceManager } from './core/DeviceManager';
import { automationEngine } from './core/AutomationEngine';
import * as path from 'path';

// Load environment variables
dotenv.config();

const PORT = process.env.BACKEND_PORT || process.env.PORT || 4001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_PATH = process.env.DATABASE_PATH || './descos.db';
const PLUGINS_DIR = path.join(__dirname, '..', '..', '..', 'plugins');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security-Header (für eine getrennte Frontend-Origin lesbar halten).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS: ohne CORS_ORIGINS wird die Anfrage-Origin gespiegelt (LAN-freundlich);
// mit Allowlist nur diese Origins; '*' = alles erlauben.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsAllowAll = CORS_ORIGINS.includes('*');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (corsAllowAll) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-deskos-token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rate-Limit auf die API (bremst Missbrauch / Token-Brute-Force).
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Token-Auth (aktiv, sobald DESKOS_TOKEN gesetzt ist).
app.use(requireToken);

// Initialize services
const database = createDatabaseService(DATABASE_PATH);
const wsServer = createWebSocketServer(server);
const persistence = createPersistenceService({
  db: database,
  eventSystem,
  deviceManager,
  automationEngine,
});
const notifications = createNotificationService({
  db: database,
  eventSystem,
  deviceManager,
});
const layout = createLayoutService(database);
const plugins = createPluginRegistry(database);
const spotify = createSpotifyService(plugins);
const discord = createDiscordService(plugins);

// Setup routes
setupRoutes(app, { persistence, notifications, layout, plugins, spotify, discord, wsServer });

// Event logging
eventSystem.on('*', (event) => {
  if (event.priority === 'critical') {
    console.error(`[CRITICAL] ${event.type}:`, event.payload);
  }
});

/**
 * Main startup function
 */
async function bootstrap(): Promise<void> {
  try {
    console.log(`🚀 DeskOS Backend v0.1.0`);
    console.log(`📍 Environment: ${NODE_ENV}`);
    console.log(`📊 Database: ${DATABASE_PATH}`);
    if (authEnabled()) {
      console.log('🔒 Auth aktiv (DESKOS_TOKEN gesetzt)');
    } else {
      console.warn('⚠️  Auth DEAKTIVIERT — setze DESKOS_TOKEN, um API + WebSocket zu schützen.');
    }

    // Restore persisted devices + automation rules, then attach live persistence
    // BEFORE anything starts emitting, so new state is written through to SQLite.
    await persistence.restore();
    persistence.attach();
    notifications.attach();
    console.log('✅ Persistence restored & attached');

    // RGB / WLED: seed configured lights on first run, then poll + drive modes.
    wledService.seedDefaults();
    wledService.attach();
    console.log('✅ WLED/RGB engine attached');

    // Displays / info-panels: seed a virtual panel on first run, then render + push.
    displayService.seedDefaults();
    displayService.attach();
    console.log('✅ Display panels attached');

    // Layout / profile system.
    await layout.restore();
    await layout.seedDefaults();
    console.log('✅ Layout profiles ready');

    // Plugin registry / marketplace.
    await plugins.restore();
    await plugins.seedDefaults();
    console.log('✅ Plugin registry ready');

    // Spotify: persistierten Refresh-Token (falls vorhanden) laden.
    spotify.restore();
    console.log('✅ Spotify service ready');

    // Discord: persistierten Refresh-Token (falls vorhanden) laden.
    discord.restore();
    console.log('✅ Discord service ready');

    // MQTT (ESP32 / sensor nodes) — embedded broker + client.
    await mqttService.start();

    // Start system monitoring
    systemMonitor.start();
    console.log('✅ System monitoring started');

    // Load plugins
    console.log(`🔌 Loading plugins from ${PLUGINS_DIR}`);
    try {
      const loadedPlugins = await pluginSystem.loadAllPluginsFromDirectory(PLUGINS_DIR);
      console.log(`✅ Loaded ${loadedPlugins.length} plugins`);
    } catch (error) {
      console.warn('⚠️ Warning loading plugins:', error);
    }

    // Seed default automation rules only when none were restored from the DB,
    // so user edits/deletions survive restarts instead of reappearing.
    if (automationEngine.getAllRules().length === 0) {
      automationEngine.addRule({
        id: 'default-cpu-high',
        name: 'CPU High Alert',
        trigger: { type: 'threshold', field: 'cpu', operator: 'gt', value: 85 },
        actions: [{ type: 'emit_event', eventType: 'alert:cpu-high', priority: 'high', message: 'CPU-Auslastung über 85%' }],
        enabled: true,
        cooldownMs: 60000,
      });

      automationEngine.addRule({
        id: 'default-ram-high',
        name: 'RAM High Alert',
        trigger: { type: 'threshold', field: 'ram.percentage', operator: 'gt', value: 90 },
        actions: [{ type: 'emit_event', eventType: 'alert:ram-high', priority: 'high', message: 'RAM-Auslastung über 90%' }],
        enabled: true,
        cooldownMs: 60000,
      });
    }

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ Server listening on http://localhost:${PORT}`);
      console.log(`✅ WebSocket server ready`);
      console.log(`✅ Dashboard available at http://localhost:${PORT}`);
      
      eventSystem.emit('system:ready', { port: PORT }, 'bootstrap');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n⏹️ Shutting down gracefully...');
      systemMonitor.stop();
      wledService.stop();
      displayService.stop();
      automationEngine.stop();
      persistence.stop();
      await mqttService.stop();
      await database.close();
      server.close(() => {
        console.log('✅ Server shut down');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Fatal error during bootstrap:', error);
    process.exit(1);
  }
}

// Start the server
bootstrap();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  eventSystem.emit('system:error', { error: error.message }, 'bootstrap', 'critical');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  eventSystem.emit('system:error', { error: String(reason) }, 'bootstrap', 'critical');
});

export { app, server, wsServer };
