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

export interface SystemMetrics {
  // The index signature keeps SystemMetrics assignable to Record<string, unknown>
  // (used by DeviceManager.recordData) and leaves room for the richer metrics
  // added in M1 (GPU, temperatures, fans, network throughput, top processes).
  [key: string]: unknown;
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
