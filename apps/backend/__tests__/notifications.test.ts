// Unit tests for NotificationService
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { DeviceManager } from '../src/core/DeviceManager';
import { EventSystem } from '../src/core/EventSystem';
import { NotificationService } from '../src/services/NotificationService';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-notif-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe('NotificationService', () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tempDbPath();
  });

  afterEach(() => {
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        fs.unlinkSync(dbFile + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  test('saves, lists (newest first), counts unread and marks read', async () => {
    const db = new DatabaseService(dbFile);
    const svc = new NotificationService({ db, eventSystem: new EventSystem(), deviceManager: new DeviceManager() });

    await svc.save({ id: 'n1', level: 'warn', title: 'CPU', message: 'hot', source: 'auto', read: false, timestamp: 1000 });
    await svc.save({ id: 'n2', level: 'info', title: 'Sys', message: 'ready', source: 'boot', read: false, timestamp: 2000 });

    expect(await svc.unreadCount()).toBe(2);
    const list = await svc.list(10);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('n2'); // newest first

    await svc.markRead('n1');
    expect(await svc.unreadCount()).toBe(1);
    expect((await svc.list(10, true))).toHaveLength(1);

    await svc.markAllRead();
    expect(await svc.unreadCount()).toBe(0);

    await db.close();
  });

  test('derives a notification from a high-priority event and broadcasts it', async () => {
    const db = new DatabaseService(dbFile);
    const es = new EventSystem();
    const svc = new NotificationService({ db, eventSystem: es, deviceManager: new DeviceManager() });
    svc.attach();

    let pushed: any = null;
    es.on('notification:new', (e) => {
      pushed = e.payload;
    });

    await es.emit('alert:cpu-high', { message: 'CPU über 85%' }, 'automation-engine', 'high');
    // save() is fire-and-forget; let the microtasks settle.
    await new Promise((r) => setTimeout(r, 50));

    const list = await svc.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].level).toBe('warn');
    expect(list[0].title).toBe('CPU-Auslastung hoch');
    expect(list[0].message).toContain('85');
    expect(pushed?.eventType).toBe('alert:cpu-high');

    await db.close();
  });

  test('ignores high-frequency :data events', async () => {
    const db = new DatabaseService(dbFile);
    const es = new EventSystem();
    const svc = new NotificationService({ db, eventSystem: es, deviceManager: new DeviceManager() });
    svc.attach();

    await es.emit('device:abc:data', { cpu: 99 }, 'device-manager');
    await new Promise((r) => setTimeout(r, 30));

    expect(await svc.unreadCount()).toBe(0);
    await db.close();
  });
});
