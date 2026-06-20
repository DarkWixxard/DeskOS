// Configuration Management
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export interface DeskOSConfig {
  server: {
    port: number;
    env: string;
    host: string;
  };
  database: {
    path: string;
  };
  mqtt: {
    broker: string;
    port: number;
    username?: string;
    password?: string;
  };
  monitoring: {
    enabled: boolean;
    interval: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  security: {
    apiKey?: string;
    enableAuth: boolean;
  };
}

class ConfigManager {
  private config: DeskOSConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): DeskOSConfig {
    return {
      server: {
        port: parseInt(process.env.BACKEND_PORT || process.env.PORT || '4001'),
        env: process.env.NODE_ENV || 'development',
        host: process.env.HOST || 'localhost'
      },
      database: {
        path: process.env.DATABASE_PATH || './descos.db'
      },
      mqtt: {
        broker: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
        port: parseInt(process.env.MQTT_PORT || '1883'),
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD
      },
      monitoring: {
        enabled: process.env.MONITORING_ENABLED !== 'false',
        interval: parseInt(process.env.MONITORING_INTERVAL || '1000')
      },
      logging: {
        level: (process.env.LOG_LEVEL as any) || 'info'
      },
      security: {
        apiKey: process.env.API_KEY,
        enableAuth: process.env.ENABLE_AUTH === 'true'
      }
    };
  }

  get(key: keyof DeskOSConfig): any {
    return this.config[key];
  }

  getAll(): DeskOSConfig {
    return { ...this.config };
  }

  isDevelopment(): boolean {
    return this.config.server.env === 'development';
  }

  isProduction(): boolean {
    return this.config.server.env === 'production';
  }
}

export const configManager = new ConfigManager();
