// Plugin System - Extensible Architecture
import * as path from 'path';
import { pathToFileURL } from 'url';
import { eventSystem } from '../core/EventSystem';

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  backend?: {
    initialize: (context: PluginContext) => Promise<void>;
    destroy?: () => Promise<void>;
  };
  frontend?: {
    widgets?: string[];
    components?: string[];
  };
}

export interface PluginContext {
  eventSystem: typeof eventSystem;
  config: PluginConfig;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface RawPluginConfig {
  id: string;
  name: string;
  version: string;
  backend?: {
    initialize: string | ((context: PluginContext) => Promise<void>);
    destroy?: string | (() => Promise<void>);
  };
  frontend?: {
    widgets?: string[];
    components?: string[];
  };
}

export class PluginSystem {
  private plugins: Map<string, PluginConfig> = new Map();
  private pluginInstances: Map<string, any> = new Map();

  private async resolveBackendModule(pluginDir: string, backendRef: string | undefined): Promise<{ initialize?: (context: PluginContext) => Promise<void>; destroy?: () => Promise<void> }> {
    if (!backendRef) {
      return {};
    }

    const backendPath = path.isAbsolute(backendRef)
      ? backendRef
      : path.join(pluginDir, backendRef);

    // Convert the absolute path to a file:// URL before importing. On Windows a
    // bare path like "S:\\plugins\\x\\backend.ts" makes the ESM loader read the
    // drive letter as a URL scheme (ERR_UNSUPPORTED_ESM_URL_SCHEME).
    const module = await import(pathToFileURL(backendPath).href);
    return {
      initialize: module.initialize,
      destroy: module.destroy,
    };
  }

  /**
   * Load a plugin
   */
  async loadPlugin(configPath: string): Promise<PluginConfig> {
    try {
      const rawConfig = require(configPath) as RawPluginConfig;
      const pluginDir = path.dirname(configPath);

      if (!rawConfig.id || !rawConfig.name || !rawConfig.version) {
        throw new Error('Plugin must have id, name, and version');
      }

      let backend: PluginConfig['backend'] | undefined;
      if (rawConfig.backend) {
        const rawBackend = rawConfig.backend;
        const initializePath = typeof rawBackend.initialize === 'string' ? rawBackend.initialize : undefined;
        const destroyPath = typeof rawBackend.destroy === 'string' ? rawBackend.destroy : undefined;

        if (initializePath || destroyPath) {
          const resolved = await this.resolveBackendModule(pluginDir, initializePath || destroyPath);
          backend = {
            initialize:
              typeof rawBackend.initialize === 'function'
                ? rawBackend.initialize
                : resolved.initialize!,
            destroy:
              typeof rawBackend.destroy === 'function'
                ? rawBackend.destroy
                : resolved.destroy,
          };
        } else {
          backend = {
            initialize: rawBackend.initialize as (context: PluginContext) => Promise<void>,
            destroy:
              typeof rawBackend.destroy === 'function'
                ? rawBackend.destroy
                : undefined,
          };
        }
      }

      const config: PluginConfig = {
        ...rawConfig,
        backend,
      };

      this.plugins.set(config.id, config);

      if (config.backend?.initialize) {
        const context: PluginContext = {
          eventSystem,
          config,
          logger: {
            info: (msg) => console.log(`[${config.id}] ${msg}`),
            warn: (msg) => console.warn(`[${config.id}] ${msg}`),
            error: (msg) => console.error(`[${config.id}] ${msg}`),
          }
        };

        await config.backend.initialize(context);
        this.pluginInstances.set(config.id, config);

        eventSystem.emit('plugin:loaded', { pluginId: config.id, name: config.name }, 'plugin-system');
      }

      return config;
    } catch (error) {
      console.error(`Failed to load plugin from ${configPath}:`, error);
      throw error;
    }
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const config = this.plugins.get(pluginId);
    if (!config) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (config.backend?.destroy) {
      await config.backend.destroy();
    }

    this.plugins.delete(pluginId);
    this.pluginInstances.delete(pluginId);

    eventSystem.emit('plugin:unloaded', { pluginId }, 'plugin-system');
  }

  /**
   * Get plugin
   */
  getPlugin(pluginId: string): PluginConfig | null {
    return this.plugins.get(pluginId) || null;
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginConfig[] {
    return Array.from(this.plugins.values());
  }

  /**
   * List available plugins in plugins directory
   */
  async loadAllPluginsFromDirectory(pluginDir: string): Promise<PluginConfig[]> {
    const fs = await import('fs').then(m => m.promises);
    const loaded: PluginConfig[] = [];

    try {
      const entries = await fs.readdir(pluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const configPath = path.join(pluginDir, entry.name, 'plugin.json');
          try {
            if ((await fs.stat(configPath)).isFile()) {
              const config = await this.loadPlugin(configPath);
              loaded.push(config);
            }
          } catch (error) {
            console.warn(`Could not load plugin from ${entry.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not read plugins directory ${pluginDir}:`, error);
    }

    return loaded;
  }
}

export const pluginSystem = new PluginSystem();
