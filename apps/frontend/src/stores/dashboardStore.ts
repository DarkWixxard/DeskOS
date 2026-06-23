// Store for application state using Zustand
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api';
import type { Device, SystemMetrics, DeskOSEvent, DeskNotification, WledLight, RgbMode } from '@shared/types';

// Canonical domain types live in @shared/types; re-exported so existing
// component imports keep working from a single source of truth.
export type { Device, SystemMetrics, DeskNotification, WledLight, RgbMode };
export type DashboardEvent = DeskOSEvent;

export interface WledControl {
  on?: boolean;
  brightness?: number;
  color?: [number, number, number] | string;
  effect?: number;
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
  // Notification Center
  notifications: DeskNotification[];
  unreadCount: number;
  notificationsOpen: boolean;
  // WLED / RGB
  wledLights: WledLight[];

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
  renameDevice: (deviceId: string, name: string) => Promise<boolean>;
  fetchNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  setNotificationsOpen: (open: boolean) => void;
  fetchWledLights: () => Promise<void>;
  controlWledLight: (id: string, patch: WledControl) => Promise<void>;
  setWledMode: (id: string, mode: RgbMode) => Promise<void>;
  addWledLight: (name: string, ip: string) => Promise<boolean>;
  updateWledLight: (id: string, patch: { name?: string; ip?: string }) => Promise<void>;
  removeWledLight: (id: string) => Promise<void>;
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
  notifications: [],
  unreadCount: 0,
  notificationsOpen: false,
  wledLights: [],

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
      get().fetchNotifications();
      get().fetchWledLights();
    });

    socket.on('notification:new', (n: DeskNotification) => {
      const notifications = [n, ...get().notifications].slice(0, 200);
      set({ notifications, unreadCount: get().unreadCount + (n.read ? 0 : 1) });
    });

    socket.on('wled:update', (lights: WledLight[]) => {
      set({ wledLights: lights });
    });

    socket.on('local:device:id', (data: { deviceId: string }) => {
      console.log('Local device ID:', data.deviceId);
      set({ localDeviceId: data.deviceId });
      socket.emit('subscribe:device', data.deviceId);
    });

    socket.on('devices:list', (devices: Device[]) => {
      // Keep an open device-detail view in sync (e.g. after a rename).
      const sel = get().selectedDevice;
      const selectedDevice = sel ? devices.find((d) => d.id === sel.id) ?? sel : null;
      set({ devices, selectedDevice });
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
  },

  renameDevice: async (deviceId: string, name: string) => {
    const baseUrl = getApiBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('rename failed');
      const updated = (await response.json()) as Device;
      const devices = get().devices.map((d) => (d.id === deviceId ? updated : d));
      const sel = get().selectedDevice;
      set({ devices, selectedDevice: sel?.id === deviceId ? updated : sel });
      return true;
    } catch (error) {
      console.error('Unable to rename device:', error);
      return false;
    }
  },

  fetchNotifications: async () => {
    const baseUrl = getApiBaseUrl();
    try {
      const [listRes, countRes] = await Promise.all([
        fetch(`${baseUrl}/api/notifications?limit=100`),
        fetch(`${baseUrl}/api/notifications/unread-count`),
      ]);
      const notifications = (await listRes.json()) as DeskNotification[];
      const { count } = await countRes.json();
      set({ notifications, unreadCount: count ?? 0 });
    } catch (error) {
      console.error('Unable to fetch notifications:', error);
    }
  },

  markNotificationRead: async (id: string) => {
    const baseUrl = getApiBaseUrl();
    const current = get().notifications.find((n) => n.id === id);
    if (current && !current.read) {
      set({
        notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, get().unreadCount - 1),
      });
    }
    try {
      await fetch(`${baseUrl}/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    } catch (error) {
      console.error('Unable to mark notification read:', error);
    }
  },

  markAllNotificationsRead: async () => {
    const baseUrl = getApiBaseUrl();
    set({ notifications: get().notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 });
    try {
      await fetch(`${baseUrl}/api/notifications/read-all`, { method: 'POST' });
    } catch (error) {
      console.error('Unable to mark all notifications read:', error);
    }
  },

  setNotificationsOpen: (open: boolean) => set({ notificationsOpen: open }),

  fetchWledLights: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/wled/lights`);
      set({ wledLights: (await res.json()) as WledLight[] });
    } catch (error) {
      console.error('Unable to fetch WLED lights:', error);
    }
  },

  controlWledLight: async (id: string, patch: WledControl) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/wled/lights/${encodeURIComponent(id)}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const light = (await res.json()) as WledLight;
        set({ wledLights: get().wledLights.map((l) => (l.id === id ? light : l)) });
      }
    } catch (error) {
      console.error('WLED control failed:', error);
    }
  },

  setWledMode: async (id: string, mode: RgbMode) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/wled/lights/${encodeURIComponent(id)}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const light = (await res.json()) as WledLight;
        set({ wledLights: get().wledLights.map((l) => (l.id === id ? light : l)) });
      }
    } catch (error) {
      console.error('WLED mode change failed:', error);
    }
  },

  addWledLight: async (name: string, ip: string) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/wled/lights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ip }),
      });
      if (!res.ok) return false;
      await get().fetchWledLights();
      return true;
    } catch (error) {
      console.error('WLED add failed:', error);
      return false;
    }
  },

  updateWledLight: async (id: string, patch: { name?: string; ip?: string }) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/wled/lights/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const light = (await res.json()) as WledLight;
        set({ wledLights: get().wledLights.map((l) => (l.id === id ? light : l)) });
      }
    } catch (error) {
      console.error('WLED update failed:', error);
    }
  },

  removeWledLight: async (id: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/wled/lights/${encodeURIComponent(id)}`, { method: 'DELETE' });
      set({ wledLights: get().wledLights.filter((l) => l.id !== id) });
    } catch (error) {
      console.error('WLED remove failed:', error);
    }
  },
}));
