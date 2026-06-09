// Database Service - SQLite Integration
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

export class DatabaseService {
  private db: sqlite3.Database;
  private ready: Promise<void>;

  constructor(databasePath: string) {
    this.db = new sqlite3.Database(databasePath);

    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Devices table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            lastSeen INTEGER,
            metadata TEXT,
            capabilities TEXT,
            registeredAt INTEGER
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Device data table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS device_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deviceId TEXT NOT NULL,
            data TEXT NOT NULL,
            timestamp INTEGER,
            FOREIGN KEY (deviceId) REFERENCES devices(id)
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Logs table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT,
            message TEXT,
            source TEXT,
            timestamp INTEGER,
            metadata TEXT
          )
        `, (err) => {
          if (err) reject(err);
        });

        // Automations table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            trigger TEXT NOT NULL,
            actions TEXT NOT NULL,
            enabled BOOLEAN,
            createdAt INTEGER
          )
        `, (err) => {
          if (err) reject(err);
          resolve();
        });
      });
    });
  }

  /**
   * Run a query
   */
  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get one row
   */
  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Get all rows
   */
  async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
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
