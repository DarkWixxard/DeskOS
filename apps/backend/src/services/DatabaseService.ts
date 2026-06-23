// Database Service - SQLite Integration
import sqlite3 from 'sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  lastSeen INTEGER,
  metadata TEXT,
  capabilities TEXT,
  registeredAt INTEGER
);

CREATE TABLE IF NOT EXISTS device_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT,
  message TEXT,
  source TEXT,
  timestamp INTEGER,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  actions TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldownMs INTEGER NOT NULL DEFAULT 60000,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  level TEXT,
  title TEXT,
  message TEXT,
  source TEXT,
  eventType TEXT,
  deviceId TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  timestamp INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_data_device_ts ON device_data(deviceId, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_notifications_ts ON notifications(timestamp);
`;

export class DatabaseService {
  private db: sqlite3.Database;
  private ready: Promise<void>;

  constructor(databasePath: string) {
    this.db = new sqlite3.Database(databasePath);
    this.ready = this.initialize();
  }

  // --- raw helpers (do not await `ready`, used during initialization) ---

  private execRaw(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
  }

  private runRaw(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private allRaw<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve((rows as T[]) || [])));
    });
  }

  private async initialize(): Promise<void> {
    await this.execRaw(SCHEMA);
    // Defensive migration: databases created by the original schema lack the
    // cooldownMs column on `automations`.
    await this.ensureColumn('automations', 'cooldownMs', 'INTEGER NOT NULL DEFAULT 60000');
  }

  private async ensureColumn(table: string, column: string, definition: string): Promise<void> {
    const cols = await this.allRaw<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) {
      await this.runRaw(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // --- public API (await `ready` so the schema exists) ---

  /**
   * Run a query
   */
  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.ready;
    return this.runRaw(sql, params);
  }

  /**
   * Get one row
   */
  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve((row as T) || null);
      });
    });
  }

  /**
   * Get all rows
   */
  async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ready;
    return this.allRaw<T>(sql, params);
  }

  /**
   * Close database
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const createDatabaseService = (databasePath: string): DatabaseService => {
  return new DatabaseService(databasePath);
};
