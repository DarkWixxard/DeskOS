// Tests for Automation Engine v2 + ActionExecutor + LayoutService
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eventSystem } from '../src/core/EventSystem';
import { AutomationEngine } from '../src/core/AutomationEngine';
import { DatabaseService } from '../src/services/DatabaseService';
import { LayoutService } from '../src/services/LayoutService';

// Actions are dispatched via fire-and-forget bus emits; let microtasks flush.
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('AutomationEngine v2', () => {
  test('threshold trigger executes a notify action', async () => {
    const engine = new AutomationEngine();
    let pushed: any = null;
    const unsub = eventSystem.on('notification:push', (e) => (pushed = e.payload));
    engine.addRule({
      id: 't1',
      name: 'CPU hot',
      trigger: { type: 'threshold', field: 'cpu', operator: 'gt', value: 80 },
      actions: [{ type: 'notify', title: 'CPU', message: 'heiß', level: 'warn' }],
      enabled: true,
      cooldownMs: 0,
    });
    await eventSystem.emit('device:x:data', { cpu: 95 }, 'test');
    await tick();
    expect(pushed?.title).toBe('CPU');
    expect(pushed?.level).toBe('warn');
    unsub();
    engine.removeRule('t1');
    engine.stop();
  });

  test('threshold not met -> no action', async () => {
    const engine = new AutomationEngine();
    let count = 0;
    const unsub = eventSystem.on('notification:push', () => (count += 1));
    engine.addRule({
      id: 't2',
      name: 'CPU',
      trigger: { type: 'threshold', field: 'cpu', operator: 'gt', value: 80 },
      actions: [{ type: 'notify', title: 'x', message: 'y' }],
      enabled: true,
      cooldownMs: 0,
    });
    await eventSystem.emit('device:x:data', { cpu: 10 }, 'test');
    await tick();
    expect(count).toBe(0);
    unsub();
    engine.removeRule('t2');
    engine.stop();
  });

  test('event trigger executes a WLED action', async () => {
    const engine = new AutomationEngine();
    let cmd: any = null;
    const unsub = eventSystem.on('wled:command', (e) => (cmd = e.payload));
    engine.addRule({
      id: 'e1',
      name: 'Panik-Licht',
      trigger: { type: 'event', eventType: 'alert:panic' },
      actions: [{ type: 'wled', target: 'all', on: true, color: [255, 0, 0], brightness: 100 }],
      enabled: true,
      cooldownMs: 0,
    });
    await eventSystem.emit('alert:panic', {}, 'test', 'high');
    await tick();
    expect(cmd?.target).toBe('all');
    expect(cmd?.color).toEqual([255, 0, 0]);
    unsub();
    engine.removeRule('e1');
    engine.stop();
  });

  test('cooldown prevents immediate re-fire', async () => {
    const engine = new AutomationEngine();
    let count = 0;
    const unsub = eventSystem.on('wled:command', () => (count += 1));
    engine.addRule({
      id: 'c1',
      name: 'tickrule',
      trigger: { type: 'event', eventType: 'tick' },
      actions: [{ type: 'wled', target: 'all', on: true }],
      enabled: true,
      cooldownMs: 60_000,
    });
    await eventSystem.emit('tick', {}, 'test');
    await tick();
    await eventSystem.emit('tick', {}, 'test');
    await tick();
    expect(count).toBe(1);
    unsub();
    engine.removeRule('c1');
    engine.stop();
  });

  test('device_status trigger matches the status', async () => {
    const engine = new AutomationEngine();
    let pushed: any = null;
    const unsub = eventSystem.on('notification:push', (e) => (pushed = e.payload));
    engine.addRule({
      id: 'd1',
      name: 'offline-alert',
      trigger: { type: 'device_status', status: 'offline' },
      actions: [{ type: 'notify', title: 'Weg', message: 'offline' }],
      enabled: true,
      cooldownMs: 0,
    });
    await eventSystem.emit('device:status-changed', { deviceId: 'z', newStatus: 'offline' }, 'test');
    await tick();
    expect(pushed?.title).toBe('Weg');
    unsub();
    engine.removeRule('d1');
    engine.stop();
  });
});

describe('LayoutService', () => {
  test('seeds profiles, activates a scene and broadcasts layout:set', async () => {
    const dbFile = path.join(os.tmpdir(), `descos-layout-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const db = new DatabaseService(dbFile);
    const layout = new LayoutService(db);
    await layout.restore();
    await layout.seedDefaults();
    expect(layout.list().length).toBe(5);

    let cmd: any = null;
    let set: any = null;
    const u1 = eventSystem.on('wled:command', (e) => (cmd = e.payload));
    const u2 = eventSystem.on('layout:set', (e) => (set = e.payload));

    const profile = await layout.activate('profile-gaming');
    await tick();

    expect(profile?.name).toBe('Gaming');
    expect(layout.getActiveId()).toBe('profile-gaming');
    expect(cmd?.target).toBe('all'); // scene executed
    expect(set?.profileId).toBe('profile-gaming');

    u1();
    u2();
    await db.close();
    try {
      fs.unlinkSync(dbFile);
    } catch {
      /* ignore */
    }
  });
});
