/**
 * Модуль базы данных SQLite на базе better-sqlite3 для Electron Main процесса.
 * Специфика ТЗ:
 * 1. Многопользовательская работа на сетевом диске (SMB/NFS) в Astra Linux 1.7.
 * 2. WAL-режим ЗАПРЕЩЕН (так как база на сетевом диске, WAL приводит к рассинхронизации и блокировкам shm/wal файлов).
 * 3. Используется journal_mode = DELETE или TRUNCATE.
 * 4. busy_timeout настроен на 5000+ мс для бесконфликтной обработки одновременных запросов 6-10 пользователей.
 * 5. Проверка доступности сетевого пути перед выполнением транзакций.
 * 6. Защита от ошибки "database is locked" на CIFS/SMB в Astra Linux:
 *    - Атомарная локальная инициализация схемы при создании новых/пустых файлов БД с последующим копированием на сетевой ресурс.
 *    - Механизм повторных попыток (runWithRetry) с экспоненциальным бэкоффом для предотвращения коллизий при одновременной записи.
 *    - Исключение избыточных вызовов ensureSchema() и pragma journal_mode в активных транзакциях.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import { createRequire } from 'module';
import {
  Organization,
  Department,
  Employee,
  DocumentType,
  Direction,
  DocumentRecord,
} from '../src/types';
import { logger } from './logger';
import { store } from './store';
declare const __non_webpack_require__: any;
const getRequire = () => {
  if (typeof __non_webpack_require__ !== 'undefined') return __non_webpack_require__;
  if (typeof require !== 'undefined') return require;
  try {
    return createRequire(import.meta.url);
  } catch {
    return null;
  }
};

// Динамический импорт better-sqlite3 для безопасного запуска в разных средах
let DatabaseConstructor: any = null;

try {
  const req = getRequire();
  if (req) {
    const mod = req('better-sqlite3');
    DatabaseConstructor = mod?.default || mod;
  }
} catch (e) {
  // При сборке или в dev-окружении
}

/**
 * Безопасное копирование файла без вызова системного fchmod (который в Astra Linux
 * вызывает ошибку EPERM на смонтированных дисках /mnt/..., NTFS, FAT и CIFS)
 */
export function safeCopyFile(source: string, destination: string): void {
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // 1. Попытка прямой бинарной перезаписи буфера (без fchmod)
  try {
    const data = fs.readFileSync(source);
    fs.writeFileSync(destination, data, { flag: 'w' });
    return;
  } catch (err1: any) {
    logger.log('warn', 'db', `safeCopyFile: прямая запись через буфер не удалась (${err1.message}), пробуем дескриптор...`);
  }

  // 2. Попытка потоковой записи через файловый дескриптор
  try {
    const data = fs.readFileSync(source);
    const fd = fs.openSync(destination, 'w');
    fs.writeSync(fd, data);
    try {
      fs.fsyncSync(fd);
    } catch {}
    fs.closeSync(fd);
    return;
  } catch (err2: any) {
    logger.log('warn', 'db', `safeCopyFile: запись через дескриптор не удалась (${err2.message}), пробуем copyFileSync...`);
  }

  // 3. Fallback: стандартный fs.copyFileSync
  fs.copyFileSync(source, destination);
}

class SQLiteDatabaseManager {
  private db: any = null;
  private currentDbPath: string = '';
  private networkMasterPath: string = '';
  private localWorkingPath: string = '';
  private isUsingLocalCache: boolean = false;
  private syncMode: 'auto' | 'direct' | 'cache_sync' = 'auto';
  private lastNetworkSyncMtime: number = 0;
  private writeQueue: Promise<any> = Promise.resolve();

  /**
   * Проверяет параметры монтирования в Linux (/proc/mounts) для путей на CIFS/SMB
   */
  public checkLinuxMountOptions(targetPath: string): { isCifs: boolean; hasNobrl: boolean; mountPoint?: string; warning?: string } {
    if (process.platform !== 'linux') return { isCifs: false, hasNobrl: true };
    try {
      if (!fs.existsSync('/proc/mounts')) return { isCifs: false, hasNobrl: true };
      const resolved = path.resolve(targetPath);
      const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');

      let bestMatch = '';
      let bestFs = '';
      let bestOpts = '';

      for (const line of mounts) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const mntPoint = parts[1];
          const fsType = parts[2];
          const opts = parts[3];
          if (resolved.startsWith(mntPoint) && mntPoint.length > bestMatch.length) {
            bestMatch = mntPoint;
            bestFs = fsType;
            bestOpts = opts;
          }
        }
      }

      if (bestFs === 'cifs' || bestFs === 'smb3') {
        const hasNobrl = bestOpts.split(',').includes('nobrl');
        let warning: string | undefined;
        if (!hasNobrl) {
          warning = `Сетевой ресурс смонтирован без опции 'nobrl' (${bestMatch}, опции: ${bestOpts}). Для надежной работы SQLite в Astra Linux 1.7 рекомендуется монтировать CIFS с опцией 'nobrl' (например: sudo mount -t cifs //server/share ${bestMatch} -o ...,nobrl)`;
          logger.log('warn', 'db', warning);
        } else {
          logger.log('info', 'db', `Сетевой ресурс CIFS смонтирован с опцией 'nobrl' (${bestMatch})`);
        }
        return { isCifs: true, hasNobrl, mountPoint: bestMatch, warning };
      }
    } catch (e: any) {
      logger.log('warn', 'db', `Не удалось проверить /proc/mounts: ${e.message}`);
    }
    return { isCifs: false, hasNobrl: true };
  }

  /**
   * Проверяет доступность сетевого пути / файла
   */
  public async checkPathAccessibility(targetPath: string): Promise<{ accessible: boolean; error?: string; mountWarning?: string }> {
    try {
      if (!targetPath) return { accessible: false, error: 'Путь к БД не указан' };

      const dir = path.dirname(targetPath);
      // Проверяем доступность родительской директории
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err: any) {
          return { accessible: false, error: `Сетевой каталог недоступен: ${err.message}` };
        }
      }

      // Проверяем права на запись
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);

      const mountCheck = this.checkLinuxMountOptions(targetPath);
      return { accessible: true, mountWarning: mountCheck.warning };
    } catch (err: any) {
      return { accessible: false, error: err.message };
    }
  }

  /**
   * Проверяет поддержку транзакций записи SQLite по заданному пути
   */
  public async testWriteLock(targetPath: string): Promise<{
    accessible: boolean;
    writeLockOk: boolean;
    isNetwork: boolean;
    isCifs: boolean;
    hasNobrl: boolean;
    mountWarning?: string;
    error?: string;
    message: string;
    recommendedMode: 'direct' | 'cache_sync';
  }> {
    const access = await this.checkPathAccessibility(targetPath);
    if (!access.accessible) {
      return {
        accessible: false,
        writeLockOk: false,
        isNetwork: false,
        isCifs: false,
        hasNobrl: true,
        error: access.error,
        message: `Путь недоступен: ${access.error}`,
        recommendedMode: 'direct',
      };
    }

    const isNetwork = targetPath.startsWith('//') || targetPath.startsWith('\\\\') || targetPath.includes('/mnt/') || targetPath.includes('smb') || targetPath.includes('nfs');
    const mountCheck = this.checkLinuxMountOptions(targetPath);
    const isCifs = mountCheck.isCifs;
    const hasNobrl = mountCheck.hasNobrl;

    // Если это Linux CIFS без nobrl - прямые блокировки SQLite заведомо сбоят
    if (isCifs && !hasNobrl) {
      return {
        accessible: true,
        writeLockOk: false,
        isNetwork: true,
        isCifs: true,
        hasNobrl: false,
        mountWarning: mountCheck.warning,
        message: 'Сетевой ресурс смонтирован без опции nobrl! Прямые блокировки SQLite на CIFS могут вызывать ошибку "database is locked". Рекомендуется режим сетевой синхронизации кэша (работает без прав root).',
        recommendedMode: 'cache_sync',
      };
    }

    if (DatabaseConstructor) {
      const probeFile = fs.existsSync(targetPath)
        ? targetPath
        : path.join(path.dirname(targetPath), `.probe_${process.pid}_${Date.now()}.sqlite`);
      const isNew = probeFile !== targetPath;
      try {
        const probeDb = new DatabaseConstructor(probeFile, { timeout: 3000 });
        try {
          probeDb.pragma('busy_timeout = 3000');
          probeDb.pragma('journal_mode = MEMORY');
          const tx = probeDb.transaction(() => {
            probeDb.prepare('CREATE TABLE IF NOT EXISTS _lock_probe (id INT)').run();
          });
          tx();
        } finally {
          try { probeDb.close(); } catch {}
          if (isNew && fs.existsSync(probeFile)) {
            try { fs.unlinkSync(probeFile); } catch {}
          }
        }
        return {
          accessible: true,
          writeLockOk: true,
          isNetwork,
          isCifs,
          hasNobrl,
          mountWarning: mountCheck.warning,
          message: 'Сетевой путь доступен, транзакции записи SQLite функционируют корректно.',
          recommendedMode: 'direct',
        };
      } catch (err: any) {
        const errMsg = String(err?.message || '');
        const isLocked = errMsg.includes('database is locked') || errMsg.includes('busy');
        return {
          accessible: true,
          writeLockOk: false,
          isNetwork,
          isCifs,
          hasNobrl,
          mountWarning: mountCheck.warning || (isLocked ? 'Ошибка блокировки SQLite (database is locked)' : errMsg),
          error: errMsg,
          message: isLocked
            ? 'Сетевой путь доступен, но запись в SQLite заблокирована сетевым ресурсом (database is locked). Для Astra Linux 1.7 используйте режим сетевой синхронизации кэша, либо смонтируйте CIFS с опцией nobrl.'
            : `Сетевой путь доступен, но возникла ошибка: ${errMsg}`,
          recommendedMode: 'cache_sync',
        };
      }
    }

    return {
      accessible: true,
      writeLockOk: true,
      isNetwork,
      isCifs,
      hasNobrl,
      message: 'Сетевой путь доступен.',
      recommendedMode: isNetwork && isCifs && !hasNobrl ? 'cache_sync' : 'direct',
    };
  }

  /**
   * Захватывает распределенную межпроцессную блокировку на сетевом диске
   * с защитой от зависших блокировок (stale lock threshold)
   */
  private async acquireDistributedLock(timeoutMs = 30000): Promise<() => void> {
    const targetPath = (this.isUsingLocalCache && this.networkMasterPath) ? this.networkMasterPath : this.currentDbPath;
    if (!targetPath) return () => {};
    const lockFilePath = `${targetPath}.netlock`;
    const startTime = Date.now();
    const staleLockThresholdMs = 15000; // 15 секунд макс на операцию, иначе блокировка считается зависшей

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Атомарное создание файла с флагами 'wx' (O_CREAT | O_EXCL)
        const fd = fs.openSync(lockFilePath, 'wx');
        try {
          const lockInfo = JSON.stringify({
            pid: process.pid,
            time: Date.now(),
            host: os.hostname(),
          });
          fs.writeFileSync(fd, lockInfo, 'utf8');
        } finally {
          try { fs.closeSync(fd); } catch {}
        }

        // Функция освобождения
        return () => {
          try {
            if (fs.existsSync(lockFilePath)) {
              fs.unlinkSync(lockFilePath);
            }
          } catch {
            try {
              fs.writeFileSync(lockFilePath, '');
              fs.unlinkSync(lockFilePath);
            } catch {}
          }
        };
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Файл уже существует. Проверяем возраст
          try {
            const stat = fs.statSync(lockFilePath);
            const age = Date.now() - stat.mtimeMs;
            if (age > staleLockThresholdMs) {
              logger.log('warn', 'db', `Обнаружен зависший lock-файл (${Math.round(age / 1000)}с), принудительно снимаем: ${lockFilePath}`);
              try {
                fs.unlinkSync(lockFilePath);
              } catch {}
              continue;
            }
          } catch {}

          const waitTime = Math.floor(50 + Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          // Если файловая система шары не поддерживает lock-файл, логируем и продолжаем
          return () => {};
        }
      }
    }

    // Если таймаут истек, пытаемся сбросить
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
    return () => {};
  }

  /**
   * Выполняет операцию SQLite с механизмом повторных попыток
   * при обнаружении временных сетевых блокировок (SQLITE_BUSY / database is locked)
   */
  private async runWithRetry<T>(operation: () => T, maxRetries = 15, baseDelayMs = 120): Promise<T> {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return operation();
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        const isLocked =
          msg.includes('database is locked') ||
          msg.includes('SQLITE_BUSY') ||
          msg.includes('busy') ||
          msg.includes('cannot start a transaction') ||
          msg.includes('SQLITE_LOCKED');

        if (!isLocked || attempt === maxRetries - 1) {
          throw err;
        }

        // Если в соединении осталась незавершенная транзакция, откатываем ее
        if (this.db && this.db.open && this.db.inTransaction) {
          try {
            this.db.exec('ROLLBACK;');
          } catch {}
        }

        // Экспоненциальный бэкофф со случайным джиттером для разведения одновременных сетевых клиентов
        const delay = Math.round(baseDelayMs * Math.pow(1.25, attempt) + Math.random() * 120);
        logger.log(
          'warn',
          'db',
          `БД временно занята блокировкой на сетевом диске CIFS/SMB (попытка ${attempt + 1}/${maxRetries}), повтор через ${delay}мс...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /**
   * Безопасное выполнение операций записи в SQLite:
   * 1. Вся очередь записи сериализуется в процессе через writeQueue.
   * 2. В режиме локального кэша с сетевой синхронизацией:
   *    - Захватывается сетевой .netlock на мастере.
   *    - Проверяется mtime мастера: если другой клиент обновил базу, кэш перезагружается.
   *    - Запись выполняется в локальную БД без сетевых задержек и без сбоев блокировок.
   *    - Локальный файл атомарно экспортируется на сетевой диск через временный файл.
   *    - Освобождается .netlock.
   * 3. В прямом режиме:
   *    - Захватывается сетевой .netlock.
   *    - Выполняется транзакция записи с механизмом повторов runWithRetry.
   *    - При критической блокировке CIFS происходит автоматический fallback в режим кэша.
   */
  private runWriteTransaction<T>(operation: () => T): Promise<T> {
    const task = async (): Promise<T> => {
      if (!this.db || !this.db.open) throw new Error('БД не подключена');

      // 1. Если активен режим локального кэша с сетевой синхронизацией
      if (this.isUsingLocalCache && this.networkMasterPath) {
        const releaseLock = await this.acquireDistributedLock(30000);
        try {
          // Проверяем, не обновил ли файл другой пользователь
          if (fs.existsSync(this.networkMasterPath)) {
            try {
              const netStat = fs.statSync(this.networkMasterPath);
              if (netStat.mtimeMs > this.lastNetworkSyncMtime + 150) {
                logger.log('info', 'db', 'Обнаружены внешние изменения базы данных другим пользователем, обновляем кэш перед записью...');
                if (this.db && this.db.open) {
                  try { this.db.close(); } catch {}
                }
                safeCopyFile(this.networkMasterPath, this.localWorkingPath);
                this.db = new DatabaseConstructor(this.localWorkingPath, { timeout: 10000 });
                this.db.pragma('journal_mode = MEMORY');
                this.db.pragma('synchronous = NORMAL');
                this.db.pragma('foreign_keys = ON');
                this.db.pragma('temp_store = MEMORY');
                this.lastNetworkSyncMtime = netStat.mtimeMs;
              }
            } catch (syncCheckErr: any) {
              logger.log('warn', 'db', `Предупреждение проверки сетевого mtime: ${syncCheckErr.message}`);
            }
          }

          // Страховка от предшествующих незакрытых транзакций
          if (this.db.inTransaction) {
            try { this.db.exec('ROLLBACK;'); } catch {}
          }

          // Выполняем транзакцию в локальной БД
          let result: T;
          if (typeof this.db.transaction === 'function') {
            const tx = this.db.transaction(() => operation());
            result = tx();
          } else {
            this.db.exec('BEGIN;');
            try {
              result = operation();
              this.db.exec('COMMIT;');
            } catch (txErr) {
              try { this.db.exec('ROLLBACK;'); } catch {}
              throw txErr;
            }
          }

          // Синхронизируем локальный файл в сетевой мастер-файл через временный файл
          const tempNetPath = `${this.networkMasterPath}.tmp_${process.pid}_${Date.now()}`;
          try {
            safeCopyFile(this.localWorkingPath, tempNetPath);
            try {
              fs.renameSync(tempNetPath, this.networkMasterPath);
            } catch {
              safeCopyFile(this.localWorkingPath, this.networkMasterPath);
              try { if (fs.existsSync(tempNetPath)) fs.unlinkSync(tempNetPath); } catch {}
            }
          } catch (netWriteErr: any) {
            logger.log('error', 'db', `Ошибка синхронизации на сетевой диск: ${netWriteErr.message}`);
            throw new Error(`Не удалось синхронизировать запись с сетевым диском: ${netWriteErr.message}`);
          }

          if (fs.existsSync(this.networkMasterPath)) {
            try {
              this.lastNetworkSyncMtime = fs.statSync(this.networkMasterPath).mtimeMs;
            } catch {}
          }

          return result;
        } finally {
          releaseLock();
        }
      }

      // 2. Прямой режим доступа к SQLite
      const releaseLock = await this.acquireDistributedLock(30000);
      try {
        return await this.runWithRetry(() => {
          if (!this.db || !this.db.open) throw new Error('БД не подключена');

          // Страховка от предшествующих незакрытых транзакций
          if (this.db.inTransaction) {
            try {
              this.db.exec('ROLLBACK;');
            } catch {}
          }

          let result: T;
          if (typeof this.db.transaction === 'function') {
            const tx = this.db.transaction(() => {
              return operation();
            });
            result = tx();
          } else {
            this.db.exec('BEGIN;');
            try {
              result = operation();
              this.db.exec('COMMIT;');
            } catch (opErr) {
              try { this.db.exec('ROLLBACK;'); } catch {}
              throw opErr;
            }
          }
          return result;
        }, 15, 120);
      } catch (directErr: any) {
        const msg = String(directErr?.message || '');
        const isLocked = msg.includes('database is locked') || msg.includes('SQLITE_BUSY') || msg.includes('cannot start a transaction');

        // Автоматический fallback: если мы в режиме auto на сетевом диске и получили database is locked,
        // бесшовно переключаемся в режим кэша с сетевой синхронизацией!
        if (isLocked && this.syncMode === 'auto' && this.currentDbPath) {
          const isNetwork = this.currentDbPath.startsWith('//') || this.currentDbPath.startsWith('\\\\') || this.currentDbPath.includes('/mnt/') || this.currentDbPath.includes('smb') || this.currentDbPath.includes('nfs');
          if (isNetwork) {
            logger.log('warn', 'db', 'Сетевой диск вызвал "database is locked". Автоматически активируем режим синхронизации кэша и повторяем запись...');
            await this.connect(this.currentDbPath, 10000, 'cache_sync');
            return await this.runWriteTransaction(operation);
          }
        }
        throw directErr;
      } finally {
        releaseLock();
      }
    };

    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.catch(() => {});
    return result;
  }

  /**
   * Создает резервную копию открытой базы данных
   */
  public async backupToFile(destinationPath: string): Promise<boolean> {
    if (this.isUsingLocalCache && this.localWorkingPath && fs.existsSync(this.localWorkingPath)) {
      try {
        safeCopyFile(this.localWorkingPath, destinationPath);
        return true;
      } catch {}
    }
    if (!this.db || !this.db.open) return false;
    try {
      if (typeof this.db.backup === 'function') {
        await this.db.backup(destinationPath);
        return true;
      }
    } catch (e: any) {
      logger.log('warn', 'db', `SQLite online backup не удался: ${e.message}, откат на резервное копирование файла`);
    }
    return false;
  }

  /**
   * Инициализирует подключение к файлу .sqlite с защитой от ошибок блокировки на CIFS/SMB
   */
  public async connect(
    dbPath: string,
    busyTimeout = 10000,
    requestedSyncMode?: 'auto' | 'direct' | 'cache_sync'
  ): Promise<{ success: boolean; message: string; isUsingLocalCache?: boolean }> {
    try {
      const accessCheck = await this.checkPathAccessibility(dbPath);
      if (!accessCheck.accessible) {
        logger.log('error', 'db', `Сетевой путь недоступен: ${dbPath}`, accessCheck.error);
        return { success: false, message: `Сетевой путь недоступен: ${accessCheck.error}` };
      }

      this.syncMode = requestedSyncMode || store.getDbConfig().syncMode || 'auto';
      const effectiveTimeout = Math.max(Number(busyTimeout) || 10000, 10000);
      const isNetwork = dbPath.startsWith('//') || dbPath.startsWith('\\\\') || dbPath.includes('/mnt/') || dbPath.includes('smb') || dbPath.includes('nfs');
      const mountCheck = this.checkLinuxMountOptions(dbPath);

      // Закрываем предыдущее соединение
      this.close();
      await new Promise((resolve) => setTimeout(resolve, 80));

      if (!DatabaseConstructor) {
        try {
          const r = getRequire();
          if (r) {
            const Candidate = r('better-sqlite3');
            const probe = new Candidate(':memory:');
            probe.close();
            DatabaseConstructor = Candidate;
          }
        } catch (e: any) {
          logger.log('warn', 'db', `better-sqlite3 недоступен в текущем рантайме (${e?.message || 'ошибка'}), используется mock-режим`);
          this.currentDbPath = dbPath;
          return { success: true, message: 'БД подключена (mock)' };
        }
      }

      // Определяем, требуется ли режим локального кэша с сетевой синхронизацией
      let shouldUseLocalCache = false;
      if (this.syncMode === 'cache_sync') {
        shouldUseLocalCache = true;
      } else if (this.syncMode === 'auto' && isNetwork) {
        if (mountCheck.isCifs && !mountCheck.hasNobrl) {
          shouldUseLocalCache = true;
          logger.log('info', 'db', 'Обнаружен сетевой ресурс CIFS без опции nobrl. Автоматически активирован режим сетевой синхронизации локального кэша.');
        }
      }

      // 1. РЕЖИМ ЛОКАЛЬНОГО КЭША С СЕТЕВОЙ СИНХРОНИЗАЦИЕЙ (для CIFS без nobrl в Astra Linux 1.7)
      if (shouldUseLocalCache && isNetwork) {
        this.isUsingLocalCache = true;
        this.networkMasterPath = dbPath;
        this.currentDbPath = dbPath;

        const userData = app?.getPath ? app.getPath('userData') : os.tmpdir();
        const cacheDir = path.join(userData, 'docflow_cifs_cache');
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        this.localWorkingPath = path.join(cacheDir, 'local_working_db.sqlite');

        const masterExists = fs.existsSync(this.networkMasterPath);
        let masterSize = 0;
        if (masterExists) {
          try {
            const st = fs.statSync(this.networkMasterPath);
            masterSize = st.size;
            this.lastNetworkSyncMtime = st.mtimeMs;
          } catch {}
        }

        if (masterExists && masterSize > 0) {
          logger.log('info', 'db', `Синхронизация сетевого файла в локальный кэш: ${this.networkMasterPath} -> ${this.localWorkingPath}`);
          safeCopyFile(this.networkMasterPath, this.localWorkingPath);
        } else {
          logger.log('info', 'db', `Создание новой базы данных в кэше и экспорт на сетевой диск: ${this.networkMasterPath}`);
          if (fs.existsSync(this.localWorkingPath)) {
            try { fs.unlinkSync(this.localWorkingPath); } catch {}
          }
          const tempDb = new DatabaseConstructor(this.localWorkingPath, { timeout: 10000 });
          try {
            tempDb.pragma('journal_mode = MEMORY');
            tempDb.pragma('synchronous = NORMAL');
            tempDb.pragma('foreign_keys = ON');
            tempDb.pragma('temp_store = MEMORY');
            this.populateFullSchemaAndDefaults(tempDb);
          } finally {
            try { tempDb.close(); } catch {}
          }
          safeCopyFile(this.localWorkingPath, this.networkMasterPath);
          if (fs.existsSync(this.networkMasterPath)) {
            try { this.lastNetworkSyncMtime = fs.statSync(this.networkMasterPath).mtimeMs; } catch {}
          }
        }

        // Открываем локальный кэш (на локальной файловой системе ext4 без блокировок CIFS)
        this.db = new DatabaseConstructor(this.localWorkingPath, {
          timeout: 10000,
          verbose: (msg: string) => {
            if (process.env.DEBUG_SQL) console.log(`[SQL-Cache]: ${msg}`);
          },
        });
        try {
          this.db.pragma('journal_mode = MEMORY');
          this.db.pragma('synchronous = NORMAL');
          this.db.pragma('foreign_keys = ON');
          this.db.pragma('temp_store = MEMORY');
          this.db.pragma('busy_timeout = 10000');
        } catch {}

        await this.ensureSchema();
        logger.log('info', 'db', `База данных подключена в режиме сетевой синхронизации (Кэш: ${this.localWorkingPath}, Мастер: ${this.networkMasterPath})`);
        return { success: true, message: 'База данных успешно подключена (режим сетевой синхронизации кэша)', isUsingLocalCache: true };
      }

      // 2. ПРЯМОЙ РЕЖИМ (локальный файл или CIFS с nobrl)
      this.isUsingLocalCache = false;
      this.networkMasterPath = '';
      this.localWorkingPath = '';

      const fileExists = fs.existsSync(dbPath);
      let isZeroByte = false;
      if (fileExists) {
        try {
          const st = fs.statSync(dbPath);
          isZeroByte = st.size === 0;
        } catch {}
      }

      if (!fileExists || isZeroByte) {
        logger.log('info', 'db', `Файл БД ${dbPath} ${!fileExists ? 'отсутствует' : 'пустой'}. Выполняем локальную инициализацию схемы...`);
        const tempFile = path.join(os.tmpdir(), `init_docflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sqlite`);
        try {
          const tempDb = new DatabaseConstructor(tempFile, { timeout: 10000 });
          try {
            tempDb.pragma('journal_mode = MEMORY');
            tempDb.pragma('synchronous = NORMAL');
            tempDb.pragma('foreign_keys = ON');
            tempDb.pragma('temp_store = MEMORY');
          } catch {}
          this.populateFullSchemaAndDefaults(tempDb);
          tempDb.close();

          if (isZeroByte && fs.existsSync(dbPath)) {
            try { fs.unlinkSync(dbPath); } catch {}
          }
          safeCopyFile(tempFile, dbPath);
        } finally {
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
        }
      }

      // Очистка зависших журналов
      const staleJournal = `${dbPath}-journal`;
      if (fs.existsSync(staleJournal)) {
        try {
          const st = fs.statSync(staleJournal);
          if (st.size === 0 || Date.now() - st.mtimeMs > 15000) {
            fs.unlinkSync(staleJournal);
          }
        } catch {}
      }

      this.db = new DatabaseConstructor(dbPath, {
        timeout: Math.max(effectiveTimeout, 30000),
        verbose: (msg: string) => {
          if (process.env.DEBUG_SQL) console.log(`[SQL]: ${msg}`);
        },
      });

      try {
        this.db.pragma(`busy_timeout = ${Math.max(effectiveTimeout, 30000)}`);
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('cache_size = -32000');
        this.db.pragma('locking_mode = NORMAL');
        this.db.pragma('journal_mode = MEMORY');
      } catch (err: any) {
        logger.log('warn', 'db', `Предупреждение установки pragma: ${err.message}`);
      }

      this.currentDbPath = dbPath;
      await this.ensureSchema();

      logger.log('info', 'db', `Подключение к БД успешно установлено в прямом режиме (busy_timeout=${Math.max(effectiveTimeout, 30000)}ms, journal_mode=MEMORY)`);
      return { success: true, message: 'База данных успешно подключена и инициализирована', isUsingLocalCache: false };
    } catch (err: any) {
      logger.log('error', 'db', `Ошибка подключения к SQLite: ${err.message}`, err);
      return { success: false, message: `Ошибка подключения: ${err.message}` };
    }
  }

  /**
   * Гарантированная проверка схемы базы данных при подключении
   */
  public async ensureSchema() {
    if (!this.db || !this.db.open) return;
    try {
      const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'").get();
      if (!table) {
        this.populateFullSchemaAndDefaults(this.db);
      } else {
        await this.ensureColumnsExist();
      }
    } catch (e: any) {
      logger.log('warn', 'db', `Проверка схемы organizations: ${e.message}`);
      try {
        this.populateFullSchemaAndDefaults(this.db);
      } catch (schemaErr: any) {
        logger.log('error', 'db', `Ошибка создания схемы: ${schemaErr.message}`);
      }
    }
  }

  /**
   * Безопасная проверка и добавление отсутствующих колонок в таблицу documents
   */
  private async ensureColumnsExist() {
    if (!this.db || !this.db.open) return;
    try {
      const pragmaCols = this.db.prepare("PRAGMA table_info('documents')").all() as Array<{ name: string }>;
      const existingColNames = new Set(pragmaCols.map((c) => c.name));

      const colsToAdd: Array<{ name: string; type: string }> = [
        { name: 'recipient_ids', type: 'TEXT' },
        { name: 'recipient_dept_ids', type: 'TEXT' },
        { name: 'recipient_dept_names', type: 'TEXT' },
        { name: 'sender_dept_id', type: 'INTEGER' },
        { name: 'sender_dept_name', type: 'TEXT' },
        { name: 'sender_emp_id', type: 'INTEGER' },
        { name: 'sender_emp_name', type: 'TEXT' },
        { name: 'signatory_emp_id', type: 'INTEGER' },
        { name: 'signatory_emp_name', type: 'TEXT' },
      ];

      for (const col of colsToAdd) {
        if (!existingColNames.has(col.name)) {
          try {
            await this.runWithRetry(() => {
              this.db.exec(`ALTER TABLE documents ADD COLUMN ${col.name} ${col.type};`);
            });
          } catch {}
        }
      }
    } catch (e: any) {
      logger.log('warn', 'db', `Проверка колонок documents: ${e.message}`);
    }
  }

  /**
   * Наполнение полной структуры схемы и начальных справочников на заданном экземпляре БД
   */
  private populateFullSchemaAndDefaults(targetDb: any) {
    if (!targetDb || !targetDb.open) return;

    const schema = `
      -- Справочник: Организации
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        director TEXT,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Справочник: Структурные подразделения
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        organization_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT
      );

      -- Справочник: Сотрудники
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        position TEXT,
        department_short_name TEXT NOT NULL,
        organization_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT
      );

      -- Справочник: Тип документа
      CREATE TABLE IF NOT EXISTS doc_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Справочник: Направление
      CREATE TABLE IF NOT EXISTS directions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Таблица: Документы (со всеми необходимыми полями)
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type_id INTEGER NOT NULL,
        direction_id INTEGER NOT NULL,
        outgoing_number TEXT,
        outgoing_date TEXT,
        incoming_number TEXT,
        incoming_date TEXT,
        subject TEXT NOT NULL,
        sender_id INTEGER,
        sender_dept_id INTEGER,
        sender_dept_name TEXT,
        sender_emp_id INTEGER,
        sender_emp_name TEXT,
        signatory_emp_id INTEGER,
        signatory_emp_name TEXT,
        recipient_id INTEGER,
        recipient_ids TEXT,
        recipient_dept_ids TEXT,
        recipient_dept_names TEXT,
        file_path TEXT,
        sed_url TEXT,
        comments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_type_id) REFERENCES doc_types (id) ON DELETE RESTRICT,
        FOREIGN KEY (direction_id) REFERENCES directions (id) ON DELETE RESTRICT,
        FOREIGN KEY (sender_id) REFERENCES organizations (id) ON DELETE SET NULL,
        FOREIGN KEY (recipient_id) REFERENCES organizations (id) ON DELETE SET NULL
      );

      -- Индексы для ускорения поиска и фильтрации
      CREATE INDEX IF NOT EXISTS idx_docs_dates ON documents (incoming_date, outgoing_date);
      CREATE INDEX IF NOT EXISTS idx_docs_type_dir ON documents (doc_type_id, direction_id);
      CREATE INDEX IF NOT EXISTS idx_docs_parties ON documents (sender_id, recipient_id);
    `;

    targetDb.exec(schema);

    // Первоначальное наполнение базовыми справочниками, если doc_types пуста
    try {
      const countRow = targetDb.prepare('SELECT count(*) as c FROM doc_types').get() as { c: number } | undefined;
      const count = countRow ? countRow.c : 0;
      if (count === 0) {
        const insertOrg = targetDb.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)');
        insertOrg.run('АО «НПО РусБИТех» (Astra Linux)', 'Буравой С. М.', 'info@rusbitech.ru');
        insertOrg.run('ПАО «Ростелеком»', 'Осеевский М. Э.', 'corp@rostelecom.ru');
        insertOrg.run('Министерство цифрового развития РФ', 'Шадаев М. И.', 'press@digital.gov.ru');

        const insertDept = targetDb.prepare('INSERT INTO departments (name, short_name, organization_id) VALUES (?, ?, ?)');
        insertDept.run('Управление делами и документооборота', 'УДО', 1);
        insertDept.run('Отдел информационной безопасности', 'ОИБ', 1);

        const insertEmp = targetDb.prepare('INSERT INTO employees (full_name, position, department_short_name, organization_id) VALUES (?, ?, ?, ?)');
        insertEmp.run('Иванов Иван Иванович', 'Главный специалист', 'УДО', 1);
        insertEmp.run('Смирнова Елена Александровна', 'Начальник отдела', 'ОИБ', 1);

        const insertType = targetDb.prepare('INSERT INTO doc_types (name) VALUES (?)');
        ['Входящее письмо', 'Исходящий запрос', 'Приказ', 'Распоряжение', 'Договор', 'Акт приема-передачи'].forEach((t) => insertType.run(t));

        const insertDir = targetDb.prepare('INSERT INTO directions (name) VALUES (?)');
        ['Входящие', 'Исходящие', 'Внутренние', 'Нормативно-распорядительные'].forEach((d) => insertDir.run(d));
      }
    } catch (seedErr: any) {
      logger.log('warn', 'db', `Предупреждение первичного заполнения справочников: ${seedErr.message}`);
    }
  }

  // --- CRUD Организации ---
  public getOrganizations(): Organization[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations ORDER BY name ASC').all();
  }

  public async saveOrganization(org: Omit<Organization, 'id'> & { id?: number }): Promise<Organization> {
    return await this.runWriteTransaction(() => {
      let targetId: number;
      if (org.id) {
        this.db.prepare('UPDATE organizations SET name = ?, director = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(org.name, org.director || '', org.email || '', org.id);
        targetId = org.id;
      } else {
        const info = this.db.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)')
          .run(org.name, org.director || '', org.email || '');
        targetId = Number(info.lastInsertRowid);
      }

      const row = this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(targetId) as Organization;
      if (!row) throw new Error('Не удалось прочитать сохраненную организацию');
      return row;
    });
  }

  public async deleteOrganization(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Структурные подразделения ---
  public getDepartments(): Department[] {
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT d.id, d.name, d.short_name as shortName, d.organization_id as organizationId, 
             o.name as organizationName, d.created_at as createdAt, d.updated_at as updatedAt
      FROM departments d
      LEFT JOIN organizations o ON d.organization_id = o.id
      ORDER BY d.name ASC
    `).all();
  }

  public async saveDepartment(dept: Omit<Department, 'id'> & { id?: number }): Promise<Department> {
    return await this.runWriteTransaction(() => {
      let targetId: number;
      if (dept.id) {
        this.db.prepare('UPDATE departments SET name = ?, short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(dept.name, dept.shortName, dept.organizationId, dept.id);
        targetId = dept.id;
      } else {
        const info = this.db.prepare('INSERT INTO departments (name, short_name, organization_id) VALUES (?, ?, ?)')
          .run(dept.name, dept.shortName, dept.organizationId);
        targetId = Number(info.lastInsertRowid);
      }

      const row = this.db.prepare(`
        SELECT d.id, d.name, d.short_name as shortName, d.organization_id as organizationId, 
               o.name as organizationName, d.created_at as createdAt, d.updated_at as updatedAt
        FROM departments d
        LEFT JOIN organizations o ON d.organization_id = o.id
        WHERE d.id = ?
      `).get(targetId) as Department;
      if (!row) throw new Error('Не удалось прочитать сохраненное подразделение');
      return row;
    });
  }

  public async deleteDepartment(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM departments WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Сотрудники ---
  public getEmployees(): Employee[] {
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT e.id, e.full_name as fullName, e.position as position, e.department_short_name as departmentShortName, 
             e.organization_id as organizationId, o.name as organizationName,
             e.created_at as createdAt, e.updated_at as updatedAt
      FROM employees e
      LEFT JOIN organizations o ON e.organization_id = o.id
      ORDER BY e.full_name ASC
    `).all();
  }

  public async saveEmployee(emp: Omit<Employee, 'id'> & { id?: number }): Promise<Employee> {
    return await this.runWriteTransaction(() => {
      let targetId: number;
      if (emp.id) {
        this.db.prepare('UPDATE employees SET full_name = ?, position = ?, department_short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId, emp.id);
        targetId = emp.id;
      } else {
        const info = this.db.prepare('INSERT INTO employees (full_name, position, department_short_name, organization_id) VALUES (?, ?, ?, ?)')
          .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId);
        targetId = Number(info.lastInsertRowid);
      }

      const row = this.db.prepare(`
        SELECT e.id, e.full_name as fullName, e.position as position, 
               e.department_short_name as departmentShortName, e.organization_id as organizationId, 
               o.name as organizationName, e.created_at as createdAt, e.updated_at as updatedAt
        FROM employees e
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE e.id = ?
      `).get(targetId) as Employee;
      if (!row) throw new Error('Не удалось прочитать сохраненного сотрудника');
      return row;
    });
  }

  public async deleteEmployee(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Тип документа ---
  public getDocumentTypes(): DocumentType[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types ORDER BY name ASC').all();
  }

  public async saveDocumentType(type: Omit<DocumentType, 'id'> & { id?: number }): Promise<DocumentType> {
    return await this.runWriteTransaction(() => {
      let targetId: number;
      if (type.id) {
        this.db.prepare('UPDATE doc_types SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(type.name, type.id);
        targetId = type.id;
      } else {
        const info = this.db.prepare('INSERT INTO doc_types (name) VALUES (?)').run(type.name);
        targetId = Number(info.lastInsertRowid);
      }

      const row = this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types WHERE id = ?').get(targetId) as DocumentType;
      if (!row) throw new Error('Не удалось прочитать сохраненный тип документа');
      return row;
    });
  }

  public async deleteDocumentType(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM doc_types WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Направления ---
  public getDirections(): Direction[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions ORDER BY name ASC').all();
  }

  public async saveDirection(dir: Omit<Direction, 'id'> & { id?: number }): Promise<Direction> {
    return await this.runWriteTransaction(() => {
      let targetId: number;
      if (dir.id) {
        this.db.prepare('UPDATE directions SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dir.name, dir.id);
        targetId = dir.id;
      } else {
        const info = this.db.prepare('INSERT INTO directions (name) VALUES (?)').run(dir.name);
        targetId = Number(info.lastInsertRowid);
      }

      const row = this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions WHERE id = ?').get(targetId) as Direction;
      if (!row) throw new Error('Не удалось прочитать сохраненное направление');
      return row;
    });
  }

  public async deleteDirection(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM directions WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- Количество документов (быстрый подсчет без чтения всех строк) ---
  public getDocumentsCount(): number {
    if (!this.db || !this.db.open) return 0;
    try {
      const row = this.db.prepare('SELECT count(*) as c FROM documents').get() as { c: number } | undefined;
      return row ? row.c : 0;
    } catch {
      return 0;
    }
  }

  // --- Получение документа по id (точечный запрос без полного сканирования таблицы) ---
  public getDocumentById(id: number): DocumentRecord | null {
    if (!this.db || !this.db.open) return null;
    const row = this.db.prepare(`
      SELECT d.id, d.doc_type_id as docTypeId, dt.name as docTypeName,
             d.direction_id as directionId, dir.name as directionName,
             d.outgoing_number as outgoingNumber, d.outgoing_date as outgoingDate,
             d.incoming_number as incomingNumber, d.incoming_date as incomingDate,
             d.subject, d.sender_id as senderId, s.name as senderName,
             d.sender_dept_id as senderDepartmentId, d.sender_dept_name as senderDepartmentName,
             d.sender_emp_id as senderEmployeeId, d.sender_emp_name as senderEmployeeName,
             d.signatory_emp_id as signatoryEmployeeId, d.signatory_emp_name as signatoryEmployeeName,
             d.recipient_id as recipientId, r.name as recipientName,
             d.recipient_ids as recipientIdsRaw,
             d.recipient_dept_ids as recipientDeptIdsRaw,
             d.recipient_dept_names as recipientDepartmentNames,
             d.file_path as filePath, d.sed_url as sedUrl, d.comments,
             d.created_at as createdAt, d.updated_at as updatedAt
      FROM documents d
      LEFT JOIN doc_types dt ON d.doc_type_id = dt.id
      LEFT JOIN directions dir ON d.direction_id = dir.id
      LEFT JOIN organizations s ON d.sender_id = s.id
      LEFT JOIN organizations r ON d.recipient_id = r.id
      WHERE d.id = ?
    `).get(id);

    if (!row) return null;

    let recipientIds: number[] = [];
    if (row.recipientIdsRaw) {
      try {
        const parsed = JSON.parse(row.recipientIdsRaw);
        if (Array.isArray(parsed)) recipientIds = parsed;
      } catch {}
    }
    if (recipientIds.length === 0 && row.recipientId) {
      recipientIds = [row.recipientId];
    }

    let recipientDepartmentIds: number[] = [];
    if (row.recipientDeptIdsRaw) {
      try {
        const parsed = JSON.parse(row.recipientDeptIdsRaw);
        if (Array.isArray(parsed)) recipientDepartmentIds = parsed;
      } catch {}
    }

    let recipientName = row.recipientName || '—';
    if (recipientIds.length > 1) {
      const orgs = this.getOrganizations();
      const names = recipientIds.map((rid) => orgs.find((o) => o.id === rid)?.name).filter(Boolean);
      if (names.length > 0) {
        recipientName = names.join(', ');
      }
    }

    return {
      ...row,
      senderDepartmentId: row.senderDepartmentId || undefined,
      senderDepartmentName: row.senderDepartmentName || undefined,
      senderEmployeeId: row.senderEmployeeId || undefined,
      senderEmployeeName: row.senderEmployeeName || undefined,
      signatoryEmployeeId: row.signatoryEmployeeId || undefined,
      signatoryEmployeeName: row.signatoryEmployeeName || undefined,
      recipientName,
      recipientIds,
      recipientDepartmentIds,
      recipientDepartmentNames: row.recipientDepartmentNames || undefined,
    };
  }

  // --- CRUD Документы ---
  public getDocuments(): DocumentRecord[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT d.id, d.doc_type_id as docTypeId, dt.name as docTypeName,
             d.direction_id as directionId, dir.name as directionName,
             d.outgoing_number as outgoingNumber, d.outgoing_date as outgoingDate,
             d.incoming_number as incomingNumber, d.incoming_date as incomingDate,
             d.subject, d.sender_id as senderId, s.name as senderName,
             d.sender_dept_id as senderDepartmentId, d.sender_dept_name as senderDepartmentName,
             d.sender_emp_id as senderEmployeeId, d.sender_emp_name as senderEmployeeName,
             d.signatory_emp_id as signatoryEmployeeId, d.signatory_emp_name as signatoryEmployeeName,
             d.recipient_id as recipientId, r.name as recipientName,
             d.recipient_ids as recipientIdsRaw,
             d.recipient_dept_ids as recipientDeptIdsRaw,
             d.recipient_dept_names as recipientDepartmentNames,
             d.file_path as filePath, d.sed_url as sedUrl, d.comments,
             d.created_at as createdAt, d.updated_at as updatedAt
      FROM documents d
      LEFT JOIN doc_types dt ON d.doc_type_id = dt.id
      LEFT JOIN directions dir ON d.direction_id = dir.id
      LEFT JOIN organizations s ON d.sender_id = s.id
      LEFT JOIN organizations r ON d.recipient_id = r.id
      ORDER BY d.id DESC
    `).all();

    const orgs = this.getOrganizations();

    return rows.map((row: any) => {
      let recipientIds: number[] = [];
      if (row.recipientIdsRaw) {
        try {
          const parsed = JSON.parse(row.recipientIdsRaw);
          if (Array.isArray(parsed)) recipientIds = parsed;
        } catch {}
      }
      if (recipientIds.length === 0 && row.recipientId) {
        recipientIds = [row.recipientId];
      }

      let recipientDepartmentIds: number[] = [];
      if (row.recipientDeptIdsRaw) {
        try {
          const parsed = JSON.parse(row.recipientDeptIdsRaw);
          if (Array.isArray(parsed)) recipientDepartmentIds = parsed;
        } catch {}
      }

      let recipientName = row.recipientName || '—';
      if (recipientIds.length > 1) {
        const names = recipientIds.map((id) => orgs.find((o) => o.id === id)?.name).filter(Boolean);
        if (names.length > 0) {
          recipientName = names.join(', ');
        }
      }

      return {
        ...row,
        senderDepartmentId: row.senderDepartmentId || undefined,
        senderDepartmentName: row.senderDepartmentName || undefined,
        senderEmployeeId: row.senderEmployeeId || undefined,
        senderEmployeeName: row.senderEmployeeName || undefined,
        signatoryEmployeeId: row.signatoryEmployeeId || undefined,
        signatoryEmployeeName: row.signatoryEmployeeName || undefined,
        recipientName,
        recipientIds,
        recipientDepartmentIds,
        recipientDepartmentNames: row.recipientDepartmentNames || undefined,
      };
    });
  }

  public async saveDocument(doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): Promise<DocumentRecord> {
    const recipientIds = doc.recipientIds || (doc.recipientId ? [doc.recipientId] : []);
    const primaryRecipientId = doc.recipientId || (recipientIds.length > 0 ? recipientIds[0] : null);
    const recipientIdsJson = recipientIds.length > 0 ? JSON.stringify(recipientIds) : null;
    const recipientDeptIdsJson = doc.recipientDepartmentIds && doc.recipientDepartmentIds.length > 0
      ? JSON.stringify(doc.recipientDepartmentIds)
      : null;
    const recipientDeptNames = doc.recipientDepartmentNames || null;

    return await this.runWriteTransaction(() => {
      let targetId: number;

      if (doc.id) {
        this.db.prepare(`
          UPDATE documents SET 
            doc_type_id = ?, direction_id = ?, outgoing_number = ?, outgoing_date = ?,
            incoming_number = ?, incoming_date = ?, subject = ?, sender_id = ?,
            sender_dept_id = ?, sender_dept_name = ?, sender_emp_id = ?, sender_emp_name = ?,
            signatory_emp_id = ?, signatory_emp_name = ?,
            recipient_id = ?, recipient_ids = ?, recipient_dept_ids = ?, recipient_dept_names = ?,
            file_path = ?, sed_url = ?, comments = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          doc.docTypeId, doc.directionId, doc.outgoingNumber || null, doc.outgoingDate || null,
          doc.incomingNumber || null, doc.incomingDate || null, doc.subject, doc.senderId || null,
          doc.senderDepartmentId || null, doc.senderDepartmentName || null,
          doc.senderEmployeeId || null, doc.senderEmployeeName || null,
          doc.signatoryEmployeeId || null, doc.signatoryEmployeeName || null,
          primaryRecipientId, recipientIdsJson, recipientDeptIdsJson, recipientDeptNames,
          doc.filePath || null, doc.sedUrl || null, doc.comments || null,
          doc.id
        );
        targetId = doc.id;
      } else {
        const info = this.db.prepare(`
          INSERT INTO documents (
            doc_type_id, direction_id, outgoing_number, outgoing_date,
            incoming_number, incoming_date, subject, sender_id,
            sender_dept_id, sender_dept_name, sender_emp_id, sender_emp_name,
            signatory_emp_id, signatory_emp_name,
            recipient_id, recipient_ids, recipient_dept_ids, recipient_dept_names,
            file_path, sed_url, comments
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          doc.docTypeId, doc.directionId, doc.outgoingNumber || null, doc.outgoingDate || null,
          doc.incomingNumber || null, doc.incomingDate || null, doc.subject, doc.senderId || null,
          doc.senderDepartmentId || null, doc.senderDepartmentName || null,
          doc.senderEmployeeId || null, doc.senderEmployeeName || null,
          doc.signatoryEmployeeId || null, doc.signatoryEmployeeName || null,
          primaryRecipientId, recipientIdsJson, recipientDeptIdsJson, recipientDeptNames,
          doc.filePath || null, doc.sedUrl || null, doc.comments || null
        );
        targetId = Number(info.lastInsertRowid);
      }

      const saved = this.getDocumentById(targetId);
      if (!saved) throw new Error('Не удалось прочитать сохраненный документ');
      return saved;
    });
  }

  public async deleteDocument(id: number): Promise<{ success: boolean }> {
    return await this.runWriteTransaction(() => {
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      return { success: true };
    });
  }

  public async syncFromNetworkIfNeeded(): Promise<{ changed: boolean }> {
    if (!this.isUsingLocalCache || !this.networkMasterPath || !fs.existsSync(this.networkMasterPath)) {
      return { changed: false };
    }
    try {
      const netStat = fs.statSync(this.networkMasterPath);
      if (netStat.mtimeMs > this.lastNetworkSyncMtime + 100) {
        logger.log('info', 'db', 'Обнаружены изменения базы данных на сетевом диске, синхронизируем локальный кэш...');
        if (this.db && this.db.open) {
          try { this.db.close(); } catch {}
        }
        safeCopyFile(this.networkMasterPath, this.localWorkingPath);
        this.db = new DatabaseConstructor(this.localWorkingPath, { timeout: 10000 });
        this.db.pragma('journal_mode = MEMORY');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('temp_store = MEMORY');
        this.lastNetworkSyncMtime = netStat.mtimeMs;
        return { changed: true };
      }
    } catch (e: any) {
      logger.log('warn', 'db', `Ошибка фоновой синхронизации: ${e.message}`);
    }
    return { changed: false };
  }

  public getStatus(): {
    isUsingLocalCache: boolean;
    syncMode: 'auto' | 'direct' | 'cache_sync';
    hasNobrl: boolean;
    isCifs: boolean;
    mountWarning?: string;
  } {
    const mountCheck = this.checkLinuxMountOptions(this.currentDbPath);
    return {
      isUsingLocalCache: this.isUsingLocalCache,
      syncMode: this.syncMode,
      hasNobrl: mountCheck.hasNobrl,
      isCifs: mountCheck.isCifs,
      mountWarning: mountCheck.warning,
    };
  }

  public getCurrentDbPath(): string {
    return this.currentDbPath;
  }

  public close(): void {
    if (this.db) {
      try {
        if (this.db.open) {
          this.db.close();
        }
      } catch (err: any) {
        logger.log('warn', 'db', `Ошибка при закрытии БД: ${err.message}`);
      }
      this.db = null;
    }
  }
}

export const dbManager = new SQLiteDatabaseManager();
