// Persistence Service
//
// Bridges the in-memory core (DeviceManager, EventSystem, AutomationEngine) to
// SQLite. It is intentionally decoupled: it listens on the event bus and writes
// through the generic DatabaseService, so the core services keep working purely
// in-memory (and remain unit-testable) when no persistence is attached.
//
// Responsibilities:
//   - restore() : load persisted devices + automation rules on startup
//   - attach()  : subscribe to events and persist devices, device data
//                 (downsampled), automation rules and a meaningful event log
//   - retention : periodically prune old device data and excess log rows

import type { DatabaseService } from './DatabaseService';
import type { EventSystem, DeskOSEvent } from '../core/EventSystem';
import type { DeviceManager } from '../core/DeviceManager';
import type { AutomationEngine, AutomationRule } from '../core/AutomationEngine';
import type { Device, DeviceData, EventPriority, LogEntry, LogLevel } from '@shared/types';

export interface PersistenceDeps {
  db: DatabaseService;
  eventSystem: EventSystem;
  deviceManager: DeviceManager;
  automationEngine: AutomationEngine;
}

interface DeviceRow {
  id: string;
  type: Device['type'];
  name: string;
  status: Device['status'];
  lastSeen: number | null;
  metadata: string | null;
  capabilities: string | null;
}

interface AutomationRow {
  id: string;
  name: string;
  trigger: string;
  actions: string;
  enabled: number;
  cooldownMs: number | null;
}

interface LogRow {
  id: number;
  level: LogLevel;
  message: string;
  source: string;
  timestamp: number;
  metadata: string | null;
}

const PRIORITY_TO_LEVEL: Record<EventPriority, LogLevel> = {
  low: 'debug',
  normal: 'info',
  high: 'warn',
  critical: 'error',
};

const DEVICE_DATA_RE = /^device:(.+):data$/;

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

export class PersistenceService {
  private readonly db: DatabaseService;
  private readonly eventSystem: EventSystem;
  private readonly deviceManager: DeviceManager;
  private readonly automationEngine: AutomationEngine;

  private readonly lastDataPersist = new Map<string, number>();
  private readonly dataPersistIntervalMs: number;
  private readonly dataRetentionMs: number;
  private readonly logRetentionRows: number;
  private readonly retentionSweepMs: number;
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(deps: PersistenceDeps) {
    this.db = deps.db;
    this.eventSystem = deps.eventSystem;
    this.deviceManager = deps.deviceManager;
    this.automationEngine = deps.automationEngine;

    this.dataPersistIntervalMs = Number(process.env.DATA_PERSIST_INTERVAL_MS) || 10_000;
    this.dataRetentionMs = Number(process.env.DATA_RETENTION_MS) || 7 * 24 * 60 * 60 * 1000;
    this.logRetentionRows = Number(process.env.LOG_RETENTION_ROWS) || 5_000;
    this.retentionSweepMs = Number(process.env.RETENTION_SWEEP_MS) || 5 * 60 * 1000;
  }

  // ---------------------------------------------------------------- restore

  /** Load persisted devices and automation rules back into memory. */
  async restore(): Promise<void> {
    await this.restoreDevices();
    await this.restoreAutomations();
  }

  private async restoreDevices(): Promise<void> {
    const rows = await this.db.all<DeviceRow>('SELECT * FROM devices');
    for (const row of rows) {
      this.deviceManager.loadDevice({
        id: row.id,
        type: row.type,
        name: row.name,
        // Nothing is connected at boot -> restore everything as offline.
        status: 'offline',
        lastSeen: row.lastSeen ?? Date.now(),
        metadata: safeParse<Record<string, unknown>>(row.metadata, {}),
        capabilities: safeParse<string[]>(row.capabilities, []),
      });
    }
  }

  private async restoreAutomations(): Promise<void> {
    const rows = await this.db.all<AutomationRow>('SELECT * FROM automations');
    for (const row of rows) {
      this.automationEngine.loadRule({
        id: row.id,
        name: row.name,
        trigger: safeParse<AutomationRule['trigger']>(row.trigger, {
          type: 'threshold',
          field: 'cpu',
          operator: 'gt',
          value: 100,
        }),
        actions: safeParse<AutomationRule['actions']>(row.actions, []),
        enabled: !!row.enabled,
        cooldownMs: row.cooldownMs ?? 60_000,
        lastFired: 0,
      });
    }
  }

  // ------------------------------------------------------------------ attach

  /** Subscribe to the event bus and begin persisting + retention sweeps. */
  attach(): void {
    const es = this.eventSystem;

    es.on('device:registered', (e) => this.fireAndForget('saveDevice', this.saveDevice(e.payload as Device)));
    es.on('device:updated', (e) => this.fireAndForget('saveDevice', this.saveDevice(e.payload as Device)));
    es.on('device:status-changed', (e) => {
      const { deviceId, newStatus } = e.payload as { deviceId: string; newStatus: Device['status'] };
      this.fireAndForget(
        'updateStatus',
        this.db.run('UPDATE devices SET status = ?, lastSeen = ? WHERE id = ?', [newStatus, Date.now(), deviceId])
      );
    });
    es.on('device:removed', (e) => {
      const { deviceId } = e.payload as { deviceId: string };
      this.lastDataPersist.delete(deviceId);
      this.fireAndForget('removeDevice', this.removeDevice(deviceId));
    });

    es.on('automation:added', (e) => this.fireAndForget('saveAutomation', this.saveAutomation(e.payload as AutomationRule)));
    es.on('automation:updated', (e) => this.fireAndForget('saveAutomation', this.saveAutomation(e.payload as AutomationRule)));
    es.on('automation:removed', (e) => {
      const { id } = e.payload as { id: string };
      this.fireAndForget('removeAutomation', this.db.run('DELETE FROM automations WHERE id = ?', [id]));
    });

    // Catch-all: device data (downsampled) and a meaningful event log.
    es.on('*', (e) => this.onAnyEvent(e));

    this.startRetention();
  }

  private onAnyEvent(event: DeskOSEvent): void {
    const match = DEVICE_DATA_RE.exec(event.type);
    if (match) {
      this.maybePersistDeviceData(match[1], event.payload, event.timestamp);
      return;
    }
    // Skip the internal "device:loaded" startup chatter; persist everything else.
    if (event.type === 'device:loaded') return;
    this.fireAndForget(
      'saveLog',
      this.saveLog({
        level: PRIORITY_TO_LEVEL[event.priority] ?? 'info',
        message: event.type,
        source: event.source,
        timestamp: event.timestamp,
        metadata: event.payload,
      })
    );
  }

  private maybePersistDeviceData(deviceId: string, payload: unknown, timestamp: number): void {
    const last = this.lastDataPersist.get(deviceId) ?? 0;
    if (timestamp - last < this.dataPersistIntervalMs) return;
    this.lastDataPersist.set(deviceId, timestamp);
    this.fireAndForget(
      'saveDeviceData',
      this.db.run('INSERT INTO device_data (deviceId, data, timestamp) VALUES (?, ?, ?)', [
        deviceId,
        safeStringify(payload),
        timestamp,
      ])
    );
  }

  // ------------------------------------------------------------ write methods

  async saveDevice(device: Device): Promise<void> {
    await this.db.run(
      `INSERT INTO devices (id, type, name, status, lastSeen, metadata, capabilities, registeredAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         name = excluded.name,
         status = excluded.status,
         lastSeen = excluded.lastSeen,
         metadata = excluded.metadata,
         capabilities = excluded.capabilities`,
      [
        device.id,
        device.type,
        device.name,
        device.status,
        device.lastSeen,
        safeStringify(device.metadata),
        safeStringify(device.capabilities),
        Date.now(),
      ]
    );
  }

  private async removeDevice(deviceId: string): Promise<void> {
    await this.db.run('DELETE FROM devices WHERE id = ?', [deviceId]);
    await this.db.run('DELETE FROM device_data WHERE deviceId = ?', [deviceId]);
  }

  async saveAutomation(rule: AutomationRule): Promise<void> {
    await this.db.run(
      `INSERT INTO automations (id, name, trigger, actions, enabled, cooldownMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         trigger = excluded.trigger,
         actions = excluded.actions,
         enabled = excluded.enabled,
         cooldownMs = excluded.cooldownMs`,
      [
        rule.id,
        rule.name,
        safeStringify(rule.trigger),
        safeStringify(rule.actions),
        rule.enabled ? 1 : 0,
        rule.cooldownMs,
        Date.now(),
      ]
    );
  }

  async saveLog(entry: LogEntry): Promise<void> {
    await this.db.run('INSERT INTO logs (level, message, source, timestamp, metadata) VALUES (?, ?, ?, ?, ?)', [
      entry.level,
      entry.message,
      entry.source,
      entry.timestamp,
      safeStringify(entry.metadata),
    ]);
  }

  // ------------------------------------------------------------- read methods

  async getLogs(limit = 100, level?: LogLevel): Promise<LogEntry[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const rows = level
      ? await this.db.all<LogRow>('SELECT * FROM logs WHERE level = ? ORDER BY timestamp DESC LIMIT ?', [level, safeLimit])
      : await this.db.all<LogRow>('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?', [safeLimit]);
    return rows.map((r) => ({
      id: r.id,
      level: r.level,
      message: r.message,
      source: r.source,
      timestamp: r.timestamp,
      metadata: safeParse<unknown>(r.metadata, undefined),
    }));
  }

  async getDeviceHistory(deviceId: string, limit = 100): Promise<DeviceData[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const rows = await this.db.all<{ deviceId: string; data: string; timestamp: number }>(
      'SELECT deviceId, data, timestamp FROM device_data WHERE deviceId = ? ORDER BY timestamp DESC LIMIT ?',
      [deviceId, safeLimit]
    );
    // Return chronologically ascending to match the in-memory history shape.
    return rows
      .reverse()
      .map((r) => ({ deviceId: r.deviceId, timestamp: r.timestamp, data: safeParse<Record<string, unknown>>(r.data, {}) }));
  }

  // --------------------------------------------------------------- retention

  private startRetention(): void {
    const sweep = () => {
      const cutoff = Date.now() - this.dataRetentionMs;
      this.fireAndForget('pruneData', this.db.run('DELETE FROM device_data WHERE timestamp < ?', [cutoff]));
      this.fireAndForget(
        'pruneLogs',
        this.db.run('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY timestamp DESC LIMIT ?)', [
          this.logRetentionRows,
        ])
      );
    };
    sweep();
    this.retentionTimer = setInterval(sweep, this.retentionSweepMs);
    // Don't keep the process (or a test runner) alive for the sweep timer.
    this.retentionTimer.unref?.();
  }

  /** Stop the retention sweep (call on shutdown). */
  stop(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  private fireAndForget(label: string, promise: Promise<unknown>): void {
    promise.catch((err) => console.error(`[persistence] ${label} failed:`, err));
  }
}

export const createPersistenceService = (deps: PersistenceDeps): PersistenceService => {
  return new PersistenceService(deps);
};
