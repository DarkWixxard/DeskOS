// Tests for the PluginRegistry / marketplace.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-plugins-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe('PluginRegistry', () => {
  test('seeds built-ins, installs/enables with settings and persists across reload', async () => {
    const dbFile = tempDbPath();
    const db = new DatabaseService(dbFile);
    const reg = new PluginRegistry(db);
    await reg.restore();
    await reg.seedDefaults();

    // Built-in functional plugins ship installed + enabled.
    const clock = reg.get('clock')!;
    expect(clock.installed).toBe(true);
    expect(clock.enabled).toBe(true);

    // External plugins start uninstalled.
    expect(reg.get('spotify')!.installed).toBe(false);

    await reg.install('spotify');
    await reg.setEnabled('spotify', true);
    await reg.updateSettings('spotify', { clientId: 'abc' });
    expect(reg.get('spotify')!.enabled).toBe(true);
    expect(reg.get('spotify')!.settings.clientId).toBe('abc');

    await db.close();

    // Reload from disk.
    const db2 = new DatabaseService(dbFile);
    const reg2 = new PluginRegistry(db2);
    await reg2.restore();
    const restored = reg2.get('spotify')!;
    expect(restored.installed).toBe(true);
    expect(restored.enabled).toBe(true);
    expect(restored.settings.clientId).toBe('abc');

    // Enabling requires the plugin to be installed.
    await reg2.uninstall('spotify');
    const afterUninstall = reg2.get('spotify')!;
    expect(afterUninstall.installed).toBe(false);
    expect(afterUninstall.enabled).toBe(false);
    const reEnabled = await reg2.setEnabled('spotify', true);
    expect(reEnabled!.enabled).toBe(false);

    expect(reg2.get('does-not-exist')).toBeNull();

    await db2.close();
    try {
      fs.unlinkSync(dbFile);
    } catch {
      /* ignore */
    }
  });
});
