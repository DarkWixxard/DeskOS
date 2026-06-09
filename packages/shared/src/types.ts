// Shared Types and Interfaces
export interface Device {
  id: string;
  type: 'local' | 'remote' | 'esp32' | 'sensor';
  name: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: number;
  metadata: Record<string, unknown>;
  capabilities: string[];
}

export interface SystemMetrics {
  cpu: number;
  ram: {
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
  priority: 'low' | 'normal' | 'high' | 'critical';
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
