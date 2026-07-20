// WebSocket Server - Real-time Communication
import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import { deviceManager } from '../core/DeviceManager';
import { systemMonitor } from './SystemMonitor';
import { terminalService } from './TerminalService';
import { socketAuth } from '../api/auth';

const corsOriginsEnv = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
// '*' = alles · Allowlist = nur diese · sonst Anfrage-Origin spiegeln (LAN-freundlich).
const socketCorsOrigin: '*' | string[] | boolean = corsOriginsEnv.includes('*')
  ? '*'
  : corsOriginsEnv.length
    ? corsOriginsEnv
    : true;

export class WebSocketServer {
  private io: SocketIOServer;
  private clientNamespaces: Map<string, Set<string>> = new Map();
  private localDeviceListenerRegistered = false;
  private agentSocketToDevice: Map<string, string> = new Map();

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: socketCorsOrigin,
        methods: ['GET', 'POST']
      },
      maxHttpBufferSize: 1e6
    });

    // Token-Auth beim Verbindungsaufbau (aktiv, sobald DESKOS_TOKEN gesetzt ist).
    this.io.use(socketAuth);

    this.setupHandlers();

    eventSystem.on('device:registered', () => {
      const devices = deviceManager.getAllDevices();
      this.io.emit('devices:list', devices);
    });

    eventSystem.on('device:removed', () => {
      const devices = deviceManager.getAllDevices();
      this.io.emit('devices:list', devices);
    });

    eventSystem.on('device:updated', () => {
      this.io.emit('devices:list', deviceManager.getAllDevices());
    });

    // Relay curated notifications to all connected clients.
    eventSystem.on('notification:new', (event: DeskOSEvent) => {
      this.io.emit('notification:new', event.payload);
    });

    // Relay live WLED light state.
    eventSystem.on('wled:update', (event: DeskOSEvent) => {
      this.io.emit('wled:update', event.payload);
    });

    // Relay live display-panel state.
    eventSystem.on('display:update', (event: DeskOSEvent) => {
      this.io.emit('display:update', event.payload);
    });

    // Relay live deej (volume mixer) slider state.
    eventSystem.on('deej:update', (event: DeskOSEvent) => {
      this.io.emit('deej:update', event.payload);
    });

    // Relay layout/profile activation to clients.
    eventSystem.on('layout:set', (event: DeskOSEvent) => {
      this.io.emit('layout:set', event.payload);
    });

    // Relay live scene-list changes (create/update/delete).
    eventSystem.on('scene:update', (event: DeskOSEvent) => {
      this.io.emit('scene:update', event.payload);
    });
  }

  private registerLocalDeviceListener(): void {
    if (this.localDeviceListenerRegistered) return;

    const localDeviceId = systemMonitor.getLocalDeviceId();
    if (!localDeviceId) {
      // Retry nach 100ms
      setTimeout(() => this.registerLocalDeviceListener(), 100);
      return;
    }

    this.localDeviceListenerRegistered = true;
    console.log(`📊 Registered listener for local device: ${localDeviceId}`);

    // Broadcast all local device metrics to all connected clients
    eventSystem.on(`device:${localDeviceId}:data`, (event: DeskOSEvent) => {
      this.io.emit('device:update', {
        deviceId: localDeviceId,
        data: event.payload,
        timestamp: event.timestamp
      });
    });
  }

  private setupHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);

      // Web-Terminal: PTY-Handler (räumt sich beim Disconnect selbst auf).
      terminalService.attach(socket);

      // Per-Connection: Unsubscribe-Funktion des '*'-Event-Abos (gegen Listener-Leak).
      let eventsUnsub: (() => void) | null = null;

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (eventsUnsub) {
          eventsUnsub();
          eventsUnsub = null;
        }
        // If this socket belonged to a registered agent, mark device offline
        const deviceId = this.agentSocketToDevice.get(socket.id);
        if (deviceId) {
          deviceManager.updateDeviceStatus(deviceId, 'offline');
          this.agentSocketToDevice.delete(socket.id);
        }
      });

      // Subscribe to device updates
      socket.on('subscribe:device', (deviceId: string) => {
        const namespace = `device:${deviceId}`;
        if (!this.clientNamespaces.has(namespace)) {
          this.clientNamespaces.set(namespace, new Set());
          
          // Subscribe to device events
          eventSystem.on(`device:${deviceId}:data`, (event: DeskOSEvent) => {
            this.io.emit('device:update', {
              deviceId,
              data: event.payload,
              timestamp: event.timestamp
            });
          });
        }

        this.clientNamespaces.get(namespace)!.add(socket.id);
        socket.emit('subscribed:device', { deviceId });
      });

      // Register a remote agent
      socket.on('register-agent', (payload: any, cb?: (resp: any) => void) => {
        try {
          const agentId = payload.agentId as string | undefined;
          const name = payload.name || `remote-${socket.id}`;
          const type = payload.type || 'remote';
          const capabilities = payload.capabilities || [];
          const metadata = payload.metadata || {};

          const device = deviceManager.registerOrUpdateDevice(
            type,
            name,
            capabilities,
            metadata,
            agentId
          );

          // Map this socket to the device id so we can update status on disconnect
          this.agentSocketToDevice.set(socket.id, device.id);

          console.log(`Registered remote agent device ${device.id} for socket ${socket.id}`);

          if (cb) cb({ agentId: device.id });
        } catch (err) {
          console.error('Error registering agent:', err);
          if (cb) cb({ error: String(err) });
        }
      });

      // Receive metrics from remote agents
      socket.on('metrics', (payload: any) => {
        try {
          const agentId = payload.agentId;
          const metrics = payload.metrics;
          if (!agentId) {
            console.warn('Received metrics without agentId');
            return;
          }

          const device = deviceManager.getDevice(agentId);
          if (!device) {
            console.warn(`Metrics for unknown agent/device ${agentId}`);
            return;
          }

          // Ensure device marked online
          deviceManager.updateDeviceStatus(device.id, 'online');

          deviceManager.recordData(device.id, metrics || {});
        } catch (err) {
          console.error('Error handling metrics:', err);
        }
      });

      // Get all devices
      socket.on('get:devices', () => {
        const devices = deviceManager.getAllDevices();
        socket.emit('devices:list', devices);
      });

      // Get device details
      socket.on('get:device', (deviceId: string) => {
        const device = deviceManager.getDevice(deviceId);
        if (device) {
          const data = deviceManager.getDeviceData(deviceId);
          socket.emit('device:details', { device, data });
        } else {
          socket.emit('error', { message: `Device ${deviceId} not found` });
        }
      });

      // Get event history
      socket.on('get:event-history', (eventType?: string) => {
        const history = eventSystem.getHistory(eventType);
        socket.emit('event:history', history);
      });

      // Listen to all events and broadcast
      socket.on('subscribe:events', () => {
        if (eventsUnsub) return; // bereits abonniert -> kein zweiter Listener
        eventsUnsub = eventSystem.on('*', (event: DeskOSEvent) => {
          socket.emit('event:new', event);
        });
        socket.emit('subscribed:events', {});
      });

      // Send local device info on connect
      const localDeviceId = systemMonitor.getLocalDeviceId();
      if (localDeviceId) {
        socket.emit('local:device:id', { deviceId: localDeviceId });
      }
    });

    // Register local device listener when system is ready
    eventSystem.on('monitor:started', () => {
      this.registerLocalDeviceListener();
    });
  }

  /**
   * Anzahl aktuell verbundener Socket.IO-Clients (für das Security-Center).
   */
  getClientCount(): number {
    return this.io.engine.clientsCount;
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastEvent(event: DeskOSEvent): void {
    this.io.emit('event', event);
  }

  /**
   * Broadcast device data
   */
  broadcastDeviceData(deviceId: string, data: unknown): void {
    this.io.emit('device:data', { deviceId, data, timestamp: Date.now() });
  }

  /**
   * Start server
   */
  start(port: number): void {
    console.log(`WebSocket server listening on port ${port}`);
  }
}

export const createWebSocketServer = (httpServer: HTTPServer): WebSocketServer => {
  return new WebSocketServer(httpServer);
};
