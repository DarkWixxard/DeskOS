// Shared Types and Interfaces
//
// Single source of truth for the DeskOS domain types. Backend, frontend and
// agent import from here (via the "@shared/*" path alias) and re-export where
// needed, so a type only ever needs to change in one place.

export type DeviceType = 'local' | 'remote' | 'esp32' | 'sensor';
export type DeviceStatus = 'online' | 'offline' | 'error';
export type EventPriority = 'low' | 'normal' | 'high' | 'critical';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  status: DeviceStatus;
  lastSeen: number;
  metadata: Record<string, unknown>;
  capabilities: string[];
}

export interface GpuMetrics {
  model?: string;
  vendor?: string;
  load?: number; // %
  tempC?: number;
  memUsed?: number; // bytes
  memTotal?: number; // bytes
}

export interface DiskMetrics {
  fs?: string;
  mount?: string;
  type?: string;
  used: number; // bytes
  total: number; // bytes
  percentage: number;
}

export interface NetworkMetrics {
  iface?: string;
  rxSec: number; // bytes/second
  txSec: number; // bytes/second
  rxBytes?: number; // total received
  txBytes?: number; // total transmitted
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number; // %
  memBytes?: number;
}

export interface SystemMetrics {
  // The index signature keeps SystemMetrics assignable to Record<string, unknown>
  // (used by DeviceManager.recordData). All M1 fields below are optional so the
  // plain `os`-only fallback object still satisfies the type.
  [key: string]: unknown;
  cpu: number; // %
  cpuTempC?: number;
  cpuModel?: string;
  cpuCores?: number;
  ram: {
    used: number;
    total: number;
    percentage: number;
  };
  // Primary/root filesystem (kept for backwards compatibility); `disks` carries
  // the full per-filesystem breakdown.
  disk?: {
    used: number;
    total: number;
    percentage: number;
  };
  disks?: DiskMetrics[];
  gpus?: GpuMetrics[];
  fansRpm?: number[];
  network?: NetworkMetrics;
  processes?: {
    count?: number;
    top: ProcessInfo[];
  };
  uptime: number;
  hostname: string;
  platform: string;
}

export interface DeviceData {
  deviceId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface DeskOSEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  payload: unknown;
  priority: EventPriority;
}

export interface LogEntry {
  id?: number;
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number;
  metadata?: unknown;
}

// --- RGB / WLED ---
export type RgbMode = 'manual' | 'temperature' | 'alarm';

export interface WledState {
  on: boolean;
  brightness: number; // 0-100 (UI scale; WLED uses 0-255 internally)
  color: [number, number, number]; // primary RGB
  effect: number; // WLED effect (fx) index
  effectName?: string;
}

export interface WledLight {
  id: string; // backing device id
  name: string;
  ip: string;
  online: boolean;
  mode: RgbMode;
  state?: WledState;
  ledCount?: number;
  version?: string;
}

export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export interface DeskNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  source: string;
  eventType?: string;
  deviceId?: string;
  read: boolean;
  timestamp: number;
}

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  backend?: any;
  frontend?: any;
}

// API Response types
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DashboardSummary {
  devices: {
    total: number;
    online: number;
    offline: number;
  };
  system: SystemMetrics;
  recentEvents: DeskOSEvent[];
}

// --- Automation Engine v2 ---
export type AutomationOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

export interface ThresholdTrigger {
  type: 'threshold';
  field: string; // e.g. 'cpu' or 'ram.percentage'
  operator: AutomationOperator;
  value: number;
}
export interface EventTrigger {
  type: 'event';
  eventType: string; // exact event type to react to
}
export interface DeviceStatusTrigger {
  type: 'device_status';
  status: DeviceStatus;
  deviceId?: string; // optional: only this device
}
export interface ScheduleTrigger {
  type: 'schedule';
  time: string; // 'HH:MM' (24h, local time)
  days?: number[]; // 0=Sun .. 6=Sat; empty/undefined = every day
}
export type AutomationTrigger = ThresholdTrigger | EventTrigger | DeviceStatusTrigger | ScheduleTrigger;

export interface EmitEventAction {
  type: 'emit_event';
  eventType: string;
  message?: string;
  priority?: EventPriority;
}
export interface NotifyAction {
  type: 'notify';
  title: string;
  message: string;
  level?: NotificationLevel;
}
export interface WledAction {
  type: 'wled';
  target: string; // 'all' or a light/device id
  on?: boolean;
  brightness?: number;
  color?: [number, number, number] | string;
  effect?: number;
  mode?: RgbMode;
}
export interface LayoutAction {
  type: 'layout';
  profileId?: string;
  view?: string;
}
export type AutomationAction = EmitEventAction | NotifyAction | WledAction | LayoutAction;

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  cooldownMs: number;
  lastFired: number;
}

// --- Layout / Profile System ---
export interface LayoutProfile {
  id: string;
  name: string;
  icon?: string;
  view?: string; // dashboard view to switch to
  actions: AutomationAction[]; // the "scene" applied on activation
}

// --- ESP32 / MQTT nodes, Sensor Hub, Module Manager ---
export interface NodeModule {
  id: string;
  type: string; // 'sensor' | 'led' | 'display' | 'audio' | 'macro' | ...
  sensors?: string[]; // e.g. ['temperature','humidity','co2','light','noise']
}

export interface SensorNode {
  device: Device;
  latest: Record<string, number> | null;
  modules: NodeModule[];
}

// --- Plugin System v2 / Marketplace ---
export type PluginCategory = 'system' | 'media' | 'communication' | 'streaming' | 'gaming' | 'smart-home';

export interface PluginSettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  icon: string;
  author?: string;
  requiresAuth: boolean;
  hasWidget: boolean;
  builtin?: boolean;
  settingsSchema?: PluginSettingField[];
}

export interface PluginInstance extends PluginManifest {
  installed: boolean;
  enabled: boolean;
  settings: Record<string, string>;
}
