/**
 * Модуль логирования для Electron Main процесса и отладки в Astra Linux
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { LogEntry, LogLevel } from '../src/types';

class MainLogger {
  private logFilePath: string;
  private inMemoryLogs: LogEntry[] = [];
  private maxLogs = 300;

  constructor() {
    const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd();
    const logsDir = path.join(userDataPath, 'logs');
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
      } catch (err) {
        console.error('Ошибка создания папки логов:', err);
      }
    }
    this.logFilePath = path.join(logsDir, `app_${new Date().toISOString().slice(0, 10)}.log`);
  }

  public log(level: LogLevel, source: LogEntry['source'], message: string, details?: any): LogEntry {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details,
    };

    this.inMemoryLogs.unshift(entry);
    if (this.inMemoryLogs.length > this.maxLogs) {
      this.inMemoryLogs = this.inMemoryLogs.slice(0, this.maxLogs);
    }

    const line = `[${entry.timestamp}] [${level.toUpperCase()}] [${source}]: ${message} ${details ? JSON.stringify(details) : ''}\n`;
    try {
      fs.appendFileSync(this.logFilePath, line, 'utf-8');
    } catch (e) {
      console.error('Не удалось записать лог в файл:', e);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${level.toUpperCase()}] [${source}] ${message}`);
    }

    return entry;
  }

  public getLogs(): LogEntry[] {
    return [...this.inMemoryLogs];
  }

  public clearLogs(): void {
    this.inMemoryLogs = [];
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }
}

export const logger = new MainLogger();
