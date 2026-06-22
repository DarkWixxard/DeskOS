// Store for application state using Zustand
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api';
import type { Device, SystemMetrics, DeskOSEvent } from '@shared/types';

// Canonical domain types live in @shared/types; re-exported so existing
// component imports keep working from a single source of truth.
export type { Device, SystemMetrics };
export type DashboardEvent = DeskOSEvent;

export interface MetricsSnapshot extends SystemMetrics {
  timestamp: number;
}

interface DashboardStore {
  devices: Device[];
  selectedDevice: Device | null;
  events: DashboardEvent[];
  systemMetrics: SystemMetrics | null;
  metricsHistory: MetricsSnapshot[];
  // Per-device latest metrics + rolling history (keyed by device id).
  localDeviceId: string | null;
  metricsByDevice: Record<string, MetricsSnapshot>;
  historyByDevice: Record<string, MetricsSnapshot[]>;
  wsConnected: boolean;
  socket: Socket | null;
  loading: boolean;
  deviceFilter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor';
  searchQuery: string;
  activeView: string;

  // Actions
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  setDeviceFilter: (filter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor') => void;
  setSearchQuery: (query: string) => void;
  setActiveView: (view: string) => void;
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
  localDeviceId: null,
  metricsByDevice: {},
  historyByDevice: {},
  wsConnected: false,
  socket: null,
  loading: false,
  deviceFilter: 'all',
  searchQuery: '',
  activeView: 'dashboard',

  connectWebSocket: () => {
    const apiUrl = getApiBaseUrl();

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
      set({ localDeviceId: data.deviceId });
      socket.emit('subscribe:device', data.deviceId);
    });

    socket.on('devices:list', (devices: Device[]) => {
      set({ devices });
    });

    socket.on('device:update', (data: any) => {
      const deviceId = data.deviceId as string;
      const metrics = data.data as SystemMetrics | undefined;
      const timestamp = data.timestamp || Date.now();

      // Update lastSeen immutably.
      const devices = get().devices.map((d) =>
        d.id === deviceId ? { ...d, lastSeen: timestamp } : d
      );
      const patch: Partial<DashboardStore> = { devices };

      if (metrics && typeof metrics.cpu === 'number') {
        const snapshot: MetricsSnapshot = { ...metrics, timestamp };

        patch.metricsByDevice = { ...get().metricsByDevice, [deviceId]: snapshot };
        const prevHistory = get().historyByDevice[deviceId] ?? [];
        const history = [...prevHistory, snapshot];
        if (history.length > 120) history.shift();
        patch.historyByDevice = { ...get().historyByDevice, [deviceId]: history };

        // Mirror the local device into the legacy single-metrics fields used by
        // the overview widgets.
        const localId = get().localDeviceId;
        const isLocal = localId ? deviceId === localId : !!metrics.hostname;
        if (isLocal) {
          patch.systemMetrics = metrics;
          patch.metricsHistory = history.slice(-30);
        }
      }

      set(patch);
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
  setActiveView: (view: string) => set({ activeView: view }),
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
    const baseUrl = getApiBaseUrl();
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
