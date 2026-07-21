// Store for application state using Zustand
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl, getAuthToken, installAuthFetch } from '@/lib/api';
import type {
  Device,
  DeviceType,
  SystemMetrics,
  DeskOSEvent,
  DeskNotification,
  WledLight,
  WledOffSchedule,
  RgbMode,
  DisplayPanel,
  DisplaySource,
  DisplayTransport,
  DeejStatus,
  DeejSlider,
  DeejTarget,
  DeejNoiseReduction,
  AutomationRule,
  AutomationTrigger,
  AutomationAction,
  LayoutProfile,
  Scene,
  PluginInstance,
} from '@shared/types';

// Canonical domain types live in @shared/types; re-exported so existing
// component imports keep working from a single source of truth.
export type {
  Device,
  SystemMetrics,
  DeskNotification,
  WledLight,
  WledOffSchedule,
  RgbMode,
  DisplayPanel,
  DisplaySource,
  DisplayTransport,
  DeejStatus,
  DeejSlider,
  DeejTarget,
  DeejNoiseReduction,
  AutomationRule,
  AutomationTrigger,
  AutomationAction,
  LayoutProfile,
  Scene,
  PluginInstance,
};
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

// One tile's placement in the free 2D dashboard grid. Mirrors react-grid-layout's
// item shape (declared locally so the store carries no UI-library dependency).
export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
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
  deviceFilter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor' | 'RaspberryPi' | 'Arduino';
  searchQuery: string;
  activeView: string;
  // Notification Center
  notifications: DeskNotification[];
  unreadCount: number;
  notificationsOpen: boolean;
  // WLED / RGB
  wledLights: WledLight[];
  // Displays / info-panels
  displayPanels: DisplayPanel[];
  // deej (hardware volume mixer)
  deejStatus: DeejStatus | null;
  // Automations + Layout profiles
  automations: AutomationRule[];
  layouts: LayoutProfile[];
  activeLayoutId: string | null;
  // Scenes (Szenen)
  scenes: Scene[];
  // Plugins
  plugins: PluginInstance[];
  // Per-section dashboard visibility (id -> shown). Missing id defaults to visible.
  dashboardWidgets: Record<string, boolean>;
  // Extra module views embedded on the dashboard (id -> shown). Missing id defaults
  // to hidden — the user opts a module in.
  dashboardModules: Record<string, boolean>;
  // Labs: experimental feature flags (id -> enabled). Missing id defaults to OFF —
  // every experiment is strictly opt-in.
  labsFlags: Record<string, boolean>;
  // Free 2D placement of the dashboard tiles (desktop / "lg" breakpoint). Empty =
  // fall back to each tile's default placement. Persisted to localStorage.
  dashboardLayout: LayoutItem[];
  // "Anordnen" (arrange) mode: while on, dashboard tiles can be dragged/resized.
  // Transient UI state — deliberately NOT persisted.
  dashboardEditMode: boolean;

  // Actions
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  setDeviceFilter: (filter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor' | 'RaspberryPi' | 'Arduino') => void;
  setSearchQuery: (query: string) => void;
  hydrateDashboardWidgets: () => void;
  toggleDashboardWidget: (id: string) => void;
  setDashboardWidget: (id: string, visible: boolean) => void;
  hydrateDashboardModules: () => void;
  toggleDashboardModule: (id: string) => void;
  hydrateLabsFlags: () => void;
  toggleLabsFlag: (id: string) => void;
  resetLabsFlags: () => void;
  hydrateDashboardLayout: () => void;
  setDashboardLayout: (layout: LayoutItem[]) => void;
  setDashboardEditMode: (on: boolean) => void;
  toggleDashboardEditMode: () => void;
  resetDashboardLayout: () => void;
  setActiveView: (view: string) => void;
  setDevices: (devices: Device[]) => void;
  selectDevice: (device: Device | null) => void;
  updateEvents: (events: DashboardEvent[]) => void;
  addEvent: (event: DashboardEvent) => void;
  setSystemMetrics: (metrics: SystemMetrics) => void;
  setLoading: (loading: boolean) => void;
  removeDevice: (deviceId: string) => Promise<boolean>;
  renameDevice: (deviceId: string, name: string) => Promise<boolean>;
  updateDeviceType: (deviceId: string, type: DeviceType) => Promise<boolean>;
  fetchNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  setNotificationsOpen: (open: boolean) => void;
  fetchWledLights: () => Promise<void>;
  controlWledLight: (id: string, patch: WledControl) => Promise<void>;
  setWledMode: (id: string, mode: RgbMode) => Promise<void>;
  addWledLight: (name: string, ip: string) => Promise<boolean>;
  updateWledLight: (
    id: string,
    patch: { name?: string; ip?: string; offSchedule?: WledOffSchedule | null }
  ) => Promise<void>;
  removeWledLight: (id: string) => Promise<void>;
  fetchDisplays: () => Promise<void>;
  addDisplay: (input: { name: string; transport?: DisplayTransport; target?: string; source?: DisplaySource }) => Promise<boolean>;
  updateDisplay: (id: string, patch: Partial<Pick<DisplayPanel, 'name' | 'transport' | 'target' | 'source' | 'text' | 'brightness' | 'sensorDeviceId' | 'sensorMetric'>>) => Promise<void>;
  controlDisplay: (id: string, patch: { on?: boolean; brightness?: number }) => Promise<void>;
  removeDisplay: (id: string) => Promise<void>;
  fetchDeej: () => Promise<void>;
  fetchDeejPorts: () => Promise<{ path: string; manufacturer?: string }[]>;
  connectDeej: () => Promise<string | null>;
  disconnectDeej: () => Promise<void>;
  updateDeejConfig: (patch: { port?: string; baud?: number; invert?: boolean; noiseReduction?: DeejNoiseReduction; sliderCount?: number }) => Promise<void>;
  updateDeejSlider: (index: number, patch: { target?: DeejTarget; apps?: string[]; label?: string; muted?: boolean }) => Promise<void>;
  setDeejVolume: (index: number, value: number) => Promise<void>;
  simulateDeej: (line: string) => Promise<void>;
  reloadDeejConfig: () => Promise<void>;
  fetchAutomations: () => Promise<void>;
  createAutomation: (rule: Omit<AutomationRule, 'lastFired'>) => Promise<boolean>;
  deleteAutomation: (id: string) => Promise<void>;
  toggleAutomation: (id: string, enabled: boolean) => Promise<void>;
  fetchLayouts: () => Promise<void>;
  activateLayout: (id: string) => Promise<void>;
  fetchScenes: () => Promise<void>;
  applyScene: (id: string) => Promise<void>;
  createScene: (input: { name: string; icon?: string; color?: [number, number, number]; actions?: AutomationAction[]; capture?: boolean }) => Promise<boolean>;
  updateScene: (id: string, patch: Partial<Pick<Scene, 'name' | 'icon' | 'color' | 'actions'>>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  fetchPlugins: () => Promise<void>;
  pluginAction: (id: string, action: 'install' | 'uninstall' | 'enable' | 'disable') => Promise<void>;
  updatePluginSettings: (id: string, settings: Record<string, string>) => Promise<void>;
}

// Visibility maps (dashboard sections, menu tiles) persist across reloads in
// localStorage. Guarded for SSR (the store module can be evaluated on the server,
// where there is no window/localStorage).
const WIDGET_STORAGE_KEY = 'deskos.dashboardWidgets';
const MODULES_STORAGE_KEY = 'deskos.dashboardModules';
const LABS_STORAGE_KEY = 'deskos.labsFlags';
const LAYOUT_STORAGE_KEY = 'deskos.dashboardLayout';

function loadVisibility(key: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveVisibility(key: string, value: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// Generic JSON persistence for the grid layout array (same SSR guards as above).
function loadLayout(key: string): LayoutItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LayoutItem[]) : [];
  } catch {
    return [];
  }
}

function saveLayout(key: string, value: LayoutItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
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
  displayPanels: [],
  deejStatus: null,
  automations: [],
  layouts: [],
  activeLayoutId: null,
  scenes: [],
  plugins: [],
  // Start empty (all visible) so server and first client render match; the saved
  // selection is applied after mount via hydrateDashboardWidgets()/hydrateDashboardModules().
  dashboardWidgets: {},
  dashboardModules: {},
  // Start empty (every experiment off) so SSR and first client render match; the
  // saved flags are applied after mount via hydrateLabsFlags().
  labsFlags: {},
  // Start empty (default placement) so SSR and first client render match; the saved
  // arrangement is applied after mount via hydrateDashboardLayout().
  dashboardLayout: [],
  dashboardEditMode: false,

  connectWebSocket: () => {
    installAuthFetch();
    const apiUrl = getApiBaseUrl();

    console.log('Connecting to backend API URL:', apiUrl);
    const socket = io(apiUrl, { auth: { token: getAuthToken() } });

    socket.on('connect', () => {
      console.log('Connected to WebSocket');
      set({ wsConnected: true });
      
      // Request initial data
      socket.emit('get:devices');
      socket.emit('subscribe:events');
      get().fetchNotifications();
      get().fetchWledLights();
      get().fetchDisplays();
      get().fetchDeej();
      get().fetchAutomations();
      get().fetchLayouts();
      get().fetchScenes();
      get().fetchPlugins();
    });

    socket.on('layout:set', (data: { profileId?: string; view?: string }) => {
      const patch: Partial<DashboardStore> = { activeLayoutId: data.profileId ?? null };
      if (data.view) patch.activeView = data.view;
      set(patch);
    });

    socket.on('notification:new', (n: DeskNotification) => {
      const notifications = [n, ...get().notifications].slice(0, 200);
      set({ notifications, unreadCount: get().unreadCount + (n.read ? 0 : 1) });
    });

    socket.on('wled:update', (lights: WledLight[]) => {
      set({ wledLights: lights });
    });

    socket.on('display:update', (panels: DisplayPanel[]) => {
      set({ displayPanels: panels });
    });

    socket.on('deej:update', (status: DeejStatus) => {
      set({ deejStatus: status });
    });

    socket.on('scene:update', (scenes: Scene[]) => {
      set({ scenes });
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
  setDeviceFilter: (filter: 'all' | 'local' | 'remote' | 'esp32' | 'sensor' | 'RaspberryPi' | 'Arduino') => set({ deviceFilter: filter }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setActiveView: (view: string) => set({ activeView: view }),
  hydrateDashboardWidgets: () => set({ dashboardWidgets: loadVisibility(WIDGET_STORAGE_KEY) }),
  toggleDashboardWidget: (id: string) => {
    // Missing id counts as visible, so the first toggle hides it.
    const current = get().dashboardWidgets[id] !== false;
    const next = { ...get().dashboardWidgets, [id]: !current };
    saveVisibility(WIDGET_STORAGE_KEY, next);
    set({ dashboardWidgets: next });
  },
  setDashboardWidget: (id: string, visible: boolean) => {
    const next = { ...get().dashboardWidgets, [id]: visible };
    saveVisibility(WIDGET_STORAGE_KEY, next);
    set({ dashboardWidgets: next });
  },
  hydrateDashboardModules: () => set({ dashboardModules: loadVisibility(MODULES_STORAGE_KEY) }),
  toggleDashboardModule: (id: string) => {
    // Missing id counts as hidden, so the first toggle shows it.
    const current = get().dashboardModules[id] === true;
    const next = { ...get().dashboardModules, [id]: !current };
    saveVisibility(MODULES_STORAGE_KEY, next);
    set({ dashboardModules: next });
  },
  hydrateLabsFlags: () => set({ labsFlags: loadVisibility(LABS_STORAGE_KEY) }),
  toggleLabsFlag: (id: string) => {
    // Missing id counts as OFF (experiments are opt-in), so the first toggle enables it.
    const current = get().labsFlags[id] === true;
    const next = { ...get().labsFlags, [id]: !current };
    saveVisibility(LABS_STORAGE_KEY, next);
    set({ labsFlags: next });
  },
  resetLabsFlags: () => {
    // Turn every experiment back off and forget the saved selection.
    saveVisibility(LABS_STORAGE_KEY, {});
    set({ labsFlags: {} });
  },
  hydrateDashboardLayout: () => set({ dashboardLayout: loadLayout(LAYOUT_STORAGE_KEY) }),
  setDashboardLayout: (layout: LayoutItem[]) => {
    saveLayout(LAYOUT_STORAGE_KEY, layout);
    set({ dashboardLayout: layout });
  },
  setDashboardEditMode: (on: boolean) => set({ dashboardEditMode: on }),
  toggleDashboardEditMode: () => set({ dashboardEditMode: !get().dashboardEditMode }),
  resetDashboardLayout: () => {
    // Wipe the saved visibility maps and the free arrangement back to defaults (all
    // sections visible, all extra modules hidden, tiles in their default placement).
    // Empty maps/array let the render fall back to the per-id defaults, so this
    // restores the shipped dashboard layout.
    saveVisibility(WIDGET_STORAGE_KEY, {});
    saveVisibility(MODULES_STORAGE_KEY, {});
    saveLayout(LAYOUT_STORAGE_KEY, []);
    set({ dashboardWidgets: {}, dashboardModules: {}, dashboardLayout: [] });
  },
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

  updateDeviceType: async (deviceId: string, type: DeviceType) => {
    const baseUrl = getApiBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!response.ok) throw new Error('category update failed');
      const updated = (await response.json()) as Device;
      const devices = get().devices.map((d) => (d.id === deviceId ? updated : d));
      const sel = get().selectedDevice;
      set({ devices, selectedDevice: sel?.id === deviceId ? updated : sel });
      return true;
    } catch (error) {
      console.error('Unable to update device category:', error);
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

  updateWledLight: async (id: string, patch: { name?: string; ip?: string; offSchedule?: WledOffSchedule | null }) => {
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

  fetchDisplays: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/displays`);
      set({ displayPanels: (await res.json()) as DisplayPanel[] });
    } catch (error) {
      console.error('Unable to fetch displays:', error);
    }
  },

  addDisplay: async (input) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/displays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      await get().fetchDisplays();
      return true;
    } catch (error) {
      console.error('Display add failed:', error);
      return false;
    }
  },

  updateDisplay: async (id, patch) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/displays/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const panel = (await res.json()) as DisplayPanel;
        set({ displayPanels: get().displayPanels.map((p) => (p.id === id ? panel : p)) });
      }
    } catch (error) {
      console.error('Display update failed:', error);
    }
  },

  controlDisplay: async (id, patch) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/displays/${encodeURIComponent(id)}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const panel = (await res.json()) as DisplayPanel;
        set({ displayPanels: get().displayPanels.map((p) => (p.id === id ? panel : p)) });
      }
    } catch (error) {
      console.error('Display control failed:', error);
    }
  },

  removeDisplay: async (id: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/displays/${encodeURIComponent(id)}`, { method: 'DELETE' });
      set({ displayPanels: get().displayPanels.filter((p) => p.id !== id) });
    } catch (error) {
      console.error('Display remove failed:', error);
    }
  },

  // ---- deej (hardware volume mixer) ----
  fetchDeej: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/status`);
      set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('Unable to fetch deej status:', error);
    }
  },

  fetchDeejPorts: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/ports`);
      return (await res.json()) as { path: string; manufacturer?: string }[];
    } catch (error) {
      console.error('Unable to list serial ports:', error);
      return [];
    }
  },

  connectDeej: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/connect`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) return (body?.error as string) || 'Verbindung fehlgeschlagen';
      set({ deejStatus: body as DeejStatus });
      return null;
    } catch (error) {
      console.error('deej connect failed:', error);
      return 'Verbindung fehlgeschlagen';
    }
  },

  disconnectDeej: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/disconnect`, { method: 'POST' });
      set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej disconnect failed:', error);
    }
  },

  updateDeejConfig: async (patch) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej config update failed:', error);
    }
  },

  updateDeejSlider: async (index, patch) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/sliders/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej slider update failed:', error);
    }
  },

  setDeejVolume: async (index, value) => {
    // Optimistic: reflect the new value immediately for a snappy slider.
    const cur = get().deejStatus;
    if (cur) {
      set({
        deejStatus: {
          ...cur,
          sliders: cur.sliders.map((s) => (s.index === index ? { ...s, value } : s)),
        },
      });
    }
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/sliders/${index}/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (res.ok) set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej volume set failed:', error);
    }
  },

  simulateDeej: async (line: string) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      });
      if (res.ok) set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej simulate failed:', error);
    }
  },

  reloadDeejConfig: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/deej/reload-config`, { method: 'POST' });
      if (res.ok) set({ deejStatus: (await res.json()) as DeejStatus });
    } catch (error) {
      console.error('deej config reload failed:', error);
    }
  },

  fetchAutomations: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/automations`);
      set({ automations: (await res.json()) as AutomationRule[] });
    } catch (error) {
      console.error('Unable to fetch automations:', error);
    }
  },

  createAutomation: async (rule) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) return false;
      await get().fetchAutomations();
      return true;
    } catch (error) {
      console.error('Unable to create automation:', error);
      return false;
    }
  },

  deleteAutomation: async (id: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      set({ automations: get().automations.filter((a) => a.id !== id) });
    } catch (error) {
      console.error('Unable to delete automation:', error);
    }
  },

  toggleAutomation: async (id: string, enabled: boolean) => {
    set({ automations: get().automations.map((a) => (a.id === id ? { ...a, enabled } : a)) });
    try {
      await fetch(`${getApiBaseUrl()}/api/automations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      console.error('Unable to toggle automation:', error);
    }
  },

  fetchLayouts: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/layouts`);
      const data = await res.json();
      set({ layouts: data.profiles ?? [], activeLayoutId: data.activeId ?? null });
    } catch (error) {
      console.error('Unable to fetch layouts:', error);
    }
  },

  activateLayout: async (id: string) => {
    set({ activeLayoutId: id });
    try {
      await fetch(`${getApiBaseUrl()}/api/layouts/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    } catch (error) {
      console.error('Unable to activate layout:', error);
    }
  },

  fetchScenes: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/scenes`);
      set({ scenes: (await res.json()) as Scene[] });
    } catch (error) {
      console.error('Unable to fetch scenes:', error);
    }
  },

  applyScene: async (id: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/scenes/${encodeURIComponent(id)}/apply`, { method: 'POST' });
    } catch (error) {
      console.error('Unable to apply scene:', error);
    }
  },

  createScene: async (input) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      // The list refreshes via the scene:update broadcast; fetch as a fallback.
      await get().fetchScenes();
      return true;
    } catch (error) {
      console.error('Unable to create scene:', error);
      return false;
    }
  },

  updateScene: async (id, patch) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/scenes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const scene = (await res.json()) as Scene;
        set({ scenes: get().scenes.map((s) => (s.id === id ? scene : s)) });
      }
    } catch (error) {
      console.error('Unable to update scene:', error);
    }
  },

  deleteScene: async (id: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      set({ scenes: get().scenes.filter((s) => s.id !== id) });
    } catch (error) {
      console.error('Unable to delete scene:', error);
    }
  },

  fetchPlugins: async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/plugins`);
      set({ plugins: (await res.json()) as PluginInstance[] });
    } catch (error) {
      console.error('Unable to fetch plugins:', error);
    }
  },

  pluginAction: async (id, action) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/plugins/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      if (res.ok) {
        const updated = (await res.json()) as PluginInstance;
        set({ plugins: get().plugins.map((p) => (p.id === id ? updated : p)) });
      }
    } catch (error) {
      console.error(`Plugin ${action} failed:`, error);
    }
  },

  updatePluginSettings: async (id, settings) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/plugins/${encodeURIComponent(id)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const updated = (await res.json()) as PluginInstance;
        set({ plugins: get().plugins.map((p) => (p.id === id ? updated : p)) });
      }
    } catch (error) {
      console.error('Plugin settings update failed:', error);
    }
  },
}));

// Convenience hook for reading a single Labs feature flag (default OFF). Components
// opt into experimental behaviour with `useLabsFlag('my-flag')` without pulling the
// whole flag map. Reads {} until hydrateLabsFlags() runs after mount, so the first
// client render matches the server (no hydration mismatch).
export const useLabsFlag = (id: string): boolean =>
  useDashboardStore((s) => s.labsFlags[id] === true);
