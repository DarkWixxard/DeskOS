// Main Server Entry Point
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { setupRoutes } from './api/routes';
import { createWebSocketServer } from './services/WebSocketServer';
import { systemMonitor } from './services/SystemMonitor';
import { createDatabaseService } from './services/DatabaseService';
import { createPersistenceService } from './services/PersistenceService';
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

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Enable CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Initialize services
const database = createDatabaseService(DATABASE_PATH);
const wsServer = createWebSocketServer(server);
const persistence = createPersistenceService({
  db: database,
  eventSystem,
  deviceManager,
  automationEngine,
});

// Setup routes
setupRoutes(app, { persistence });

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

    // Restore persisted devices + automation rules, then attach live persistence
    // BEFORE anything starts emitting, so new state is written through to SQLite.
    await persistence.restore();
    persistence.attach();
    console.log('✅ Persistence restored & attached');

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
        trigger: {
          type: 'threshold',
          condition: { field: 'cpu', operator: 'gt', value: 85 },
        },
        actions: [{
          type: 'emit_event',
          payload: { eventType: 'alert:cpu-high', priority: 'high', message: 'CPU-Auslastung über 85%' },
        }],
        enabled: true,
        cooldownMs: 60000,
      });

      automationEngine.addRule({
        id: 'default-ram-high',
        name: 'RAM High Alert',
        trigger: {
          type: 'threshold',
          condition: { field: 'ram.percentage', operator: 'gt', value: 90 },
        },
        actions: [{
          type: 'emit_event',
          payload: { eventType: 'alert:ram-high', priority: 'high', message: 'RAM-Auslastung über 90%' },
        }],
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
      persistence.stop();
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
