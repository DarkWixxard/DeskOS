// Store for application state using Zustand
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export interface Device {
  id: string;
  type: 'local' | 'remote' | 'esp32' | 'sensor';
  name: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: number;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface DashboardEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: unknown;
}

export interface SystemMetrics {
  cpu: number;
  ram: {
    used: number;
    total: number;
    percentage: number;
  };
  disk?: {
    used: number;
    total: number;
    percentage: number;
  };
  uptime: number;
  hostname: string;
  platform: string;
}

export interface MetricsSnapshot extends SystemMetrics {
  timestamp: number;
}

interface DashboardStore {
  devices: Device[];
  selectedDevice: Device | null;
  events: DashboardEvent[];
  systemMetrics: SystemMetrics | null;
  metricsHistory: MetricsSnapshot[];
  wsConnected: boolean;
  socket: Socket | null;
  loading: boolean;
  deviceFilter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor';
  searchQuery: string;

  // Actions
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  setDeviceFilter: (filter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor') => void;
  setSearchQuery: (query: string) => void;
  setDevices: (devices: Device[]) => void;
  selectDevice: (device: Device | null) => void;
  updateEvents: (events: DashboardEvent[]) => void;
  addEvent: (event: DashboardEvent) => void;
  setSystemMetrics: (metrics: SystemMetrics) => void;
  setLoading: (loading: boolean) => void;
  removeDevice: (deviceId: string) => Promise<boolean>;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  devices: [],
  selectedDevice: null,
  events: [],
  systemMetrics: null,
  metricsHistory: [],
  wsConnected: false,
  socket: null,
  loading: false,
  deviceFilter: 'all',
  searchQuery: '',

  connectWebSocket: () => {
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001');

    console.log('Connecting to backend API URL:', apiUrl);
    const socket = io(apiUrl);

    socket.on('connect', () => {
      console.log('Connected to WebSocket');
      set({ wsConnected: true });
      
      // Request initial data
      socket.emit('get:devices');
      socket.emit('subscribe:events');
    });

    socket.on('local:device:id', (data: { deviceId: string }) => {
      console.log('Local device ID:', data.deviceId);
      socket.emit('subscribe:device', data.deviceId);
    });

    socket.on('devices:list', (devices: Device[]) => {
      set({ devices });
    });

    socket.on('device:update', (data: any) => {
      // Update device list
      const devices = get().devices;
      const deviceIndex = devices.findIndex(d => d.id === data.deviceId);
      if (deviceIndex >= 0) {
        devices[deviceIndex].lastSeen = data.timestamp;
      }
      
      // Update system metrics if it's the local device
      if (data.deviceId === 'local' || data.data?.hostname) {
        const snapshot: MetricsSnapshot = {
          ...(data.data as SystemMetrics),
          timestamp: data.timestamp || Date.now(),
        };
        const history = [...get().metricsHistory, snapshot];
        if (history.length > 30) history.shift();
        set({ systemMetrics: data.data as SystemMetrics, metricsHistory: history });
      }

      set({ devices: [...devices] });
    });

    socket.on('event:new', (event: DashboardEvent) => {
      const events = get().events;
      events.push(event);
      if (events.length > 100) events.shift();
      set({ events: [...events] });
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket');
      set({ wsConnected: false });
    });

    set({ socket });
  },

  disconnectWebSocket: () => {
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
      set({ socket: null, wsConnected: false });
    }
  },

  setDevices: (devices: Device[]) => set({ devices }),
  setDeviceFilter: (filter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor') => set({ deviceFilter: filter }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  selectDevice: (device: Device | null) => set({ selectedDevice: device }),
  updateEvents: (events: DashboardEvent[]) => set({ events }),
  addEvent: (event: DashboardEvent) => {
    const events = get().events;
    events.push(event);
    if (events.length > 100) events.shift();
    set({ events: [...events] });
  },
  setSystemMetrics: (metrics: SystemMetrics) => set({ systemMetrics: metrics }),
  setLoading: (loading: boolean) => set({ loading }),
  removeDevice: async (deviceId: string) => {
    const baseUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001');
    try {
      const response = await fetch(
        `${baseUrl}/api/devices/${encodeURIComponent(deviceId)}`,
        {
          method: 'DELETE'
        }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || 'Failed to remove device');
      }
      const devices = get().devices.filter((device) => device.id !== deviceId);
      const selectedDevice = get().selectedDevice;
      set({
        devices,
        selectedDevice:
          selectedDevice?.id === deviceId ? null : selectedDevice
      });
      return true;
    } catch (error) {
      console.error('Unable to remove device:', error);
      return false;
    }
  }
}));
