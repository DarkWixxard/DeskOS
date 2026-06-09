// System Monitor Plugin Backend
import { PluginContext } from '../../apps/backend/src/core/PluginSystem';

export async function initialize(context: PluginContext): Promise<void> {
  context.logger.info('Initializing System Monitor Plugin');

  // Setup event listeners
  context.eventSystem.on('monitor:started', (event) => {
    context.logger.info('Monitor started: ' + JSON.stringify(event.payload));
  });

  // Example: Emit custom events
  context.eventSystem.emit('system-monitor:ready', { plugin: 'system-monitor' }, 'system-monitor-plugin');

  context.logger.info('System Monitor Plugin initialized');
}

export async function destroy(): Promise<void> {
  console.log('System Monitor Plugin destroyed');
}
