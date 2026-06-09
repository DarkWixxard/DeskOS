// Logger Service
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  source: string;
  metadata?: unknown;
}

export class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 10000;
  private minLevel: LogLevel = 'info';
  private levelMap = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  private log(level: LogLevel, message: string, source: string, metadata?: unknown): void {
    if (this.levelMap[level] < this.levelMap[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      source,
      metadata
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also log to console
    const prefix = `[${source}] ${message}`;
    switch (level) {
      case 'debug':
        console.debug(prefix, metadata);
        break;
      case 'info':
        console.log(prefix, metadata);
        break;
      case 'warn':
        console.warn(prefix, metadata);
        break;
      case 'error':
        console.error(prefix, metadata);
        break;
    }
  }

  debug(message: string, source: string, metadata?: unknown): void {
    this.log('debug', message, source, metadata);
  }

  info(message: string, source: string, metadata?: unknown): void {
    this.log('info', message, source, metadata);
  }

  warn(message: string, source: string, metadata?: unknown): void {
    this.log('warn', message, source, metadata);
  }

  error(message: string, source: string, metadata?: unknown): void {
    this.log('error', message, source, metadata);
  }

  getLogs(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logs.filter(l => l.level === level);
    }
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info'
);
