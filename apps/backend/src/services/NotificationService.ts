// Notification Service
//
// Turns a curated subset of bus events (alerts, device status changes, errors)
// into user-facing notifications: persisted to SQLite, pushed live over the
// event bus (`notification:new` -> WebSocketServer) and queryable with a
// read/unread state. Distinct from the log table (which records everything).

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './DatabaseService';
import type { EventSystem, DeskOSEvent } from '../core/EventSystem';
import type { DeviceManager } from '../core/DeviceManager';
import type { DeskNotification, NotificationLevel } from '@shared/types';

export interface NotificationDeps {
  db: DatabaseService;
  eventSystem: EventSystem;
  deviceManager: DeviceManager;
}

interface NotificationRow {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  source: string;
  eventType: string | null;
  deviceId: string | null;
  read: number;
  timestamp: number;
}

const ALERT_TITLES: Record<string, string> = {
  'alert:cpu-high': 'CPU-Auslastung hoch',
  'alert:ram-high': 'RAM-Auslastung hoch',
};

function humanize(eventType: string): string {
  return ALERT_TITLES[eventType] ?? eventType;
}

function asText(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const m = (payload as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return typeof payload === 'string' ? payload : '';
}

export class NotificationService {
  private readonly db: DatabaseService;
  private readonly eventSystem: EventSystem;
  private readonly deviceManager: DeviceManager;

  constructor(deps: NotificationDeps) {
    this.db = deps.db;
    this.eventSystem = deps.eventSystem;
    this.deviceManager = deps.deviceManager;
  }

  attach(): void {
    this.eventSystem.on('*', (event) => this.onEvent(event));
    // Direct notifications pushed by automations / layout actions.
    this.eventSystem.on('notification:push', (event) => this.onPush(event));
  }

  private onPush(event: DeskOSEvent): void {
    const p = (event.payload ?? {}) as { title?: string; message?: string; level?: NotificationLevel; deviceId?: string };
    if (!p.title && !p.message) return;
    const notification: DeskNotification = {
      id: uuidv4(),
      level: p.level ?? 'info',
      title: p.title ?? 'Hinweis',
      message: p.message ?? '',
      source: event.source,
      eventType: 'notification:push',
      deviceId: p.deviceId,
      read: false,
      timestamp: event.timestamp,
    };
    void this.save(notification).catch((err) => console.error('[notifications] push save failed:', err));
    this.eventSystem.emit('notification:new', notification, 'notification-service');
  }

  private onEvent(event: DeskOSEvent): void {
    const built = this.build(event);
    if (!built) return;

    const notification: DeskNotification = {
      id: uuidv4(),
      level: built.level,
      title: built.title,
      message: built.message,
      source: event.source,
      eventType: event.type,
      deviceId: built.deviceId,
      read: false,
      timestamp: event.timestamp,
    };

    void this.save(notification).catch((err) => console.error('[notifications] save failed:', err));
    // Broadcast (WebSocketServer relays `notification:new` to clients).
    this.eventSystem.emit('notification:new', notification, 'notification-service');
  }

  /** Decide whether/how an event becomes a notification. */
  private build(
    event: DeskOSEvent
  ): { level: NotificationLevel; title: string; message: string; deviceId?: string } | null {
    const type = event.type;
    if (type.endsWith(':data')) return null;
    if (type.startsWith('notification:')) return null; // avoid recursion
    const payload = event.payload as Record<string, unknown> | undefined;

    if (event.priority === 'critical' || event.priority === 'high') {
      return {
        level: event.priority === 'critical' ? 'error' : 'warn',
        title: humanize(type),
        message: asText(payload) || type,
      };
    }

    if (type === 'device:status-changed') {
      const deviceId = payload?.deviceId as string | undefined;
      const newStatus = payload?.newStatus as string | undefined;
      const name = (deviceId && this.deviceManager.getDevice(deviceId)?.name) || deviceId || 'Gerät';
      const level: NotificationLevel = newStatus === 'offline' ? 'warn' : newStatus === 'error' ? 'error' : 'success';
      return { level, title: `Gerät ${newStatus ?? ''}`.trim(), message: `${name} ist ${newStatus}`, deviceId };
    }

    if (type === 'device:registered') {
      return {
        level: 'info',
        title: 'Neues Gerät',
        message: (payload?.name as string) || 'Unbekanntes Gerät',
        deviceId: payload?.id as string | undefined,
      };
    }

    if (type === 'system:ready') {
      return { level: 'info', title: 'System bereit', message: `Backend läuft (Port ${payload?.port ?? '?'})` };
    }

    return null;
  }

  async save(n: DeskNotification): Promise<void> {
    await this.db.run(
      `INSERT INTO notifications (id, level, title, message, source, eventType, deviceId, read, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.id, n.level, n.title, n.message, n.source, n.eventType ?? null, n.deviceId ?? null, n.read ? 1 : 0, n.timestamp]
    );
  }

  async list(limit = 50, unreadOnly = false): Promise<DeskNotification[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const rows = unreadOnly
      ? await this.db.all<NotificationRow>('SELECT * FROM notifications WHERE read = 0 ORDER BY timestamp DESC LIMIT ?', [safeLimit])
      : await this.db.all<NotificationRow>('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ?', [safeLimit]);
    return rows.map((r) => ({
      id: r.id,
      level: r.level,
      title: r.title,
      message: r.message,
      source: r.source,
      eventType: r.eventType ?? undefined,
      deviceId: r.deviceId ?? undefined,
      read: !!r.read,
      timestamp: r.timestamp,
    }));
  }

  async unreadCount(): Promise<number> {
    const row = await this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE read = 0');
    return row?.c ?? 0;
  }

  async markRead(id: string): Promise<void> {
    await this.db.run('UPDATE notifications SET read = 1 WHERE id = ?', [id]);
  }

  async markAllRead(): Promise<void> {
    await this.db.run('UPDATE notifications SET read = 1 WHERE read = 0');
  }
}

export const createNotificationService = (deps: NotificationDeps): NotificationService => {
  return new NotificationService(deps);
};
