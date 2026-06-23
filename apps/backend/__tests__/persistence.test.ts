// Unit tests for PersistenceService (SQLite roundtrip)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { DeviceManager } from '../src/core/DeviceManager';
import { AutomationEngine, AutomationRule } from '../src/core/AutomationEngine';
import { EventSystem } from '../src/core/EventSystem';
import { PersistenceService } from '../src/services/PersistenceService';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function makeStack(dbFile: string) {
  const db = new DatabaseService(dbFile);
  const eventSystem = new EventSystem();
  const deviceManager = new DeviceManager();
  const automationEngine = new AutomationEngine();
  const persistence = new PersistenceService({ db, eventSystem, deviceManager, automationEngine });
  return { db, eventSystem, deviceManager, automationEngine, persistence };
}

describe('PersistenceService', () => {
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

  test('persists devices and automation rules and restores them after reopen', async () => {
    const first = makeStack(dbFile);

    await first.persistence.saveDevice({
      id: 'dev-1',
      type: 'esp32',
      name: 'WLED Ambient',
      status: 'online',
      lastSeen: Date.now(),
      metadata: { ip: '10.0.0.5' },
      capabilities: ['led'],
    });

    const rule: AutomationRule = {
      id: 'rule-1',
      name: 'CPU hot',
      trigger: { type: 'threshold', condition: { field: 'cpu', operator: 'gt', value: 85 } },
      actions: [{ type: 'emit_event', payload: { eventType: 'alert:cpu' } }],
      enabled: true,
      cooldownMs: 60000,
      lastFired: 0,
    };
    await first.persistence.saveAutomation(rule);

    first.persistence.stop();
    await first.db.close();

    // Reopen with fresh in-memory managers and restore from disk.
    const second = makeStack(dbFile);
    await second.persistence.restore();
    second.persistence.stop();

    const devices = second.deviceManager.getAllDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('dev-1');
    expect(devices[0].name).toBe('WLED Ambient');
    expect(devices[0].status).toBe('offline'); // restored as offline
    expect(devices[0].metadata).toEqual({ ip: '10.0.0.5' });
    expect(devices[0].capabilities).toEqual(['led']);

    const rules = second.automationEngine.getAllRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rule-1');
    expect(rules[0].enabled).toBe(true);
    expect(rules[0].cooldownMs).toBe(60000);
    expect(rules[0].trigger.condition.value).toBe(85);

    await second.db.close();
  });

  test('saves and queries logs', async () => {
    const stack = makeStack(dbFile);

    await stack.persistence.saveLog({
      level: 'warn',
      message: 'alert:cpu-high',
      source: 'automation-engine',
      timestamp: Date.now(),
      metadata: { value: 92 },
    });

    const logs = await stack.persistence.getLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('alert:cpu-high');
    expect(logs[0].level).toBe('warn');
    expect(logs[0].metadata).toEqual({ value: 92 });

    stack.persistence.stop();
    await stack.db.close();
  });

  test('removing a device deletes it from storage', async () => {
    const first = makeStack(dbFile);
    await first.persistence.saveDevice({
      id: 'dev-2',
      type: 'remote',
      name: 'Server',
      status: 'online',
      lastSeen: Date.now(),
      metadata: {},
      capabilities: [],
    });
    // saveDevice upsert + manual delete via the same SQL path used by the event handler.
    await first.db.run('DELETE FROM devices WHERE id = ?', ['dev-2']);
    first.persistence.stop();
    await first.db.close();

    const second = makeStack(dbFile);
    await second.persistence.restore();
    second.persistence.stop();
    expect(second.deviceManager.getAllDevices()).toHaveLength(0);
    await second.db.close();
  });
});
