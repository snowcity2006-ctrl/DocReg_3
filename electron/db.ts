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

// Динамический импорт better-sqlite3 для безопасного запуска в разных средах
let DatabaseConstructor: any = null;

try {
  DatabaseConstructor = require('better-sqlite3');
} catch (e) {
  // При сборке или в dev-окружении
}

class SQLiteDatabaseManager {
  private db: any = null;
  private currentDbPath: string = '';

  /**
   * Проверяет доступность сетевого пути / файла
   */
  public async checkPathAccessibility(targetPath: string): Promise<{ accessible: boolean; error?: string }> {
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
      return { accessible: true };
    } catch (err: any) {
      return { accessible: false, error: err.message };
    }
  }

  /**
   * Выполняет синхронную операцию SQLite с механизмом повторных попыток
   * при обнаружении временных блокировок (SQLITE_BUSY / database is locked)
   */
  private runWithRetry<T>(operation: () => T, maxRetries = 5, baseDelayMs = 60): T {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return operation();
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        const isLocked = msg.includes('database is locked') || msg.includes('SQLITE_BUSY') || msg.includes('busy');
        if (!isLocked || attempt === maxRetries - 1) {
          throw err;
        }
        // Задержка с небольшим случайным джиттером для предотвращения повторной коллизии
        const delay = Math.round(baseDelayMs * Math.pow(1.5, attempt) + Math.random() * 30);
        const start = Date.now();
        while (Date.now() - start < delay) {
          // busy wait для синхронного вызова better-sqlite3
        }
      }
    }
    throw lastError;
  }

  /**
   * Создает резервную копию открытой базы данных через Online Backup API
   */
  public async backupToFile(destinationPath: string): Promise<boolean> {
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
  public async connect(dbPath: string, busyTimeout = 5000): Promise<{ success: boolean; message: string }> {
    try {
      const accessCheck = await this.checkPathAccessibility(dbPath);
      if (!accessCheck.accessible) {
        logger.log('error', 'db', `Сетевой путь недоступен: ${dbPath}`, accessCheck.error);
        return { success: false, message: `Сетевой путь недоступен: ${accessCheck.error}` };
      }

      const effectiveTimeout = Math.max(Number(busyTimeout) || 5000, 5000);

      // Если соединение уже открыто к этому же пути, не переоткрываем его заново
      if (this.currentDbPath === dbPath && this.db && this.db.open) {
        try {
          this.db.pragma(`busy_timeout = ${effectiveTimeout}`);
        } catch {}
        this.ensureSchema();
        logger.log('info', 'db', `База данных уже открыта (${dbPath}), параметры таймаута обновлены (${effectiveTimeout}мс)`);
        return { success: true, message: 'База данных успешно подключена и инициализирована' };
      }

      // Если было открыто другое соединение, аккуратно закрываем его
      if (this.db) {
        try {
          if (this.db.open) {
            this.db.close();
          }
        } catch (closeErr: any) {
          logger.log('warn', 'db', `Предупреждение при закрытии предыдущего соединения: ${closeErr.message}`);
        } finally {
          this.db = null;
        }
        // Небольшая пауза для освобождения файлового дескриптора ядром Linux / CIFS
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      if (!DatabaseConstructor) {
        try {
          DatabaseConstructor = require('better-sqlite3');
        } catch (e) {
          logger.log('warn', 'db', 'better-sqlite3 не загружен в dev-режиме, используется mock-режим');
          this.currentDbPath = dbPath;
          return { success: true, message: 'БД подключена (mock)' };
        }
      }

      // Проверяем, существует ли файл и не является ли он нулевого размера
      const fileExists = fs.existsSync(dbPath);
      let isZeroByte = false;
      if (fileExists) {
        try {
          const st = fs.statSync(dbPath);
          isZeroByte = st.size === 0;
        } catch {}
      }

      /**
       * ВАЖНО ДЛЯ ASTRA LINUX 1.7 И СЕТЕВЫХ РЕСУРСОВ CIFS/SMB:
       * Если файл отсутствует или имеет нулевой размер, инициализация схемы прямо через
       * сетевое подключение CIFS вызывает ошибку "database is locked" из-за несовместимости
       * POSIX lock promotion (апгрейда блокировки SHARED -> EXCLUSIVE) в сетевой файловой системе.
       * 
       * РЕШЕНИЕ: Мы атомарно создаем и наполняем базу данных на локальном диске (в os.tmpdir()),
       * закрываем соединение и копируем готовый полноценный файл .sqlite на сетевой диск.
       */
      if (!fileExists || isZeroByte) {
        logger.log('info', 'db', `Файл БД ${dbPath} ${!fileExists ? 'отсутствует' : 'имеет нулевой размер'}. Выполняем атомарную локальную инициализацию схемы...`);

        const tempFile = path.join(
          os.tmpdir(),
          `init_docflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sqlite`
        );

        try {
          const tempDb = new DatabaseConstructor(tempFile, { timeout: 10000 });
          try {
            tempDb.pragma('journal_mode = DELETE');
            tempDb.pragma('synchronous = NORMAL');
            tempDb.pragma('foreign_keys = ON');
          } catch {}

          // Заполняем схему и базовые справочники локально без сетевых задержек
          this.populateFullSchemaAndDefaults(tempDb);
          tempDb.close();

          // Если на сетевом пути уже был файл нулевого размера, удаляем его
          if (isZeroByte && fs.existsSync(dbPath)) {
            try {
              fs.unlinkSync(dbPath);
            } catch (unlinkErr: any) {
              logger.log('warn', 'db', `Предупреждение при удалении 0-байтового файла: ${unlinkErr.message}`);
            }
          }

          // Копируем готовый файл базы данных на сетевой диск
          fs.copyFileSync(tempFile, dbPath);
          logger.log('info', 'db', `Инициализированный файл БД успешно скопирован на сетевой ресурс: ${dbPath}`);
        } finally {
          try {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch {}
        }
      }

      // Открываем сетевую базу данных с настроенным timeout ожидания блокировок
      this.db = new DatabaseConstructor(dbPath, {
        timeout: effectiveTimeout,
        verbose: (msg: string) => {
          if (process.env.DEBUG_SQL) console.log(`[SQL]: ${msg}`);
        },
      });

      // 1. Устанавливаем busy_timeout для 6-10 одновременных сетевых пользователей
      try {
        this.db.pragma(`busy_timeout = ${effectiveTimeout}`);
      } catch {}

      // 2. synchronous = NORMAL для стабильного сетевого I/O
      try {
        this.db.pragma('synchronous = NORMAL');
      } catch {}

      // 3. foreign_keys = ON
      try {
        this.db.pragma('foreign_keys = ON');
      } catch {}

      // 4. Проверяем режим журнала (не вызываем PRAGMA journal_mode = DELETE, если он уже DELETE)
      try {
        const currentJournal = String(this.db.pragma('journal_mode', { simple: true })).toLowerCase();
        if (currentJournal !== 'delete' && currentJournal !== 'truncate') {
          this.db.pragma('journal_mode = DELETE');
        }
      } catch (journalErr: any) {
        logger.log('warn', 'db', `Предупреждение journal_mode: ${journalErr.message}`);
      }

      this.currentDbPath = dbPath;

      // Проверяем схему и наличие колонок (без конфликтов блокировок)
      this.ensureSchema();

      logger.log('info', 'db', `Подключение к БД успешно установлено (busy_timeout=${effectiveTimeout}ms, journal_mode=DELETE, sync=NORMAL)`);
      return { success: true, message: 'База данных успешно подключена и инициализирована' };
    } catch (err: any) {
      logger.log('error', 'db', `Ошибка подключения к SQLite: ${err.message}`, err);
      return { success: false, message: `Ошибка подключения: ${err.message}` };
    }
  }

  /**
   * Гарантированная проверка схемы базы данных при подключении
   */
  public ensureSchema() {
    if (!this.db || !this.db.open) return;
    try {
      const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'").get();
      if (!table) {
        this.populateFullSchemaAndDefaults(this.db);
      } else {
        this.ensureColumnsExist();
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
  private ensureColumnsExist() {
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
            this.runWithRetry(() => {
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

  public saveOrganization(org: Omit<Organization, 'id'> & { id?: number }): Organization {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      if (org.id) {
        this.db.prepare('UPDATE organizations SET name = ?, director = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(org.name, org.director || '', org.email || '', org.id);
        return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(org.id);
      } else {
        const info = this.db.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)')
          .run(org.name, org.director || '', org.email || '');
        return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(info.lastInsertRowid);
      }
    });
  }

  public deleteOrganization(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
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

  public saveDepartment(dept: Omit<Department, 'id'> & { id?: number }): Department {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      if (dept.id) {
        this.db.prepare('UPDATE departments SET name = ?, short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(dept.name, dept.shortName, dept.organizationId, dept.id);
        return this.getDepartments().find((d) => d.id === dept.id)!;
      } else {
        const info = this.db.prepare('INSERT INTO departments (name, short_name, organization_id) VALUES (?, ?, ?)')
          .run(dept.name, dept.shortName, dept.organizationId);
        return this.getDepartments().find((d) => d.id === info.lastInsertRowid)!;
      }
    });
  }

  public deleteDepartment(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
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

  public saveEmployee(emp: Omit<Employee, 'id'> & { id?: number }): Employee {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      if (emp.id) {
        this.db.prepare('UPDATE employees SET full_name = ?, position = ?, department_short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId, emp.id);
        return this.getEmployees().find((e) => e.id === emp.id)!;
      } else {
        const info = this.db.prepare('INSERT INTO employees (full_name, position, department_short_name, organization_id) VALUES (?, ?, ?, ?)')
          .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId);
        return this.getEmployees().find((e) => e.id === info.lastInsertRowid)!;
      }
    });
  }

  public deleteEmployee(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      this.db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Тип документа ---
  public getDocumentTypes(): DocumentType[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types ORDER BY name ASC').all();
  }

  public saveDocumentType(type: Omit<DocumentType, 'id'> & { id?: number }): DocumentType {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      if (type.id) {
        this.db.prepare('UPDATE doc_types SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(type.name, type.id);
        return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types WHERE id = ?').get(type.id);
      } else {
        const info = this.db.prepare('INSERT INTO doc_types (name) VALUES (?)').run(type.name);
        return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types WHERE id = ?').get(info.lastInsertRowid);
      }
    });
  }

  public deleteDocumentType(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      this.db.prepare('DELETE FROM doc_types WHERE id = ?').run(id);
      return { success: true };
    });
  }

  // --- CRUD Направления ---
  public getDirections(): Direction[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions ORDER BY name ASC').all();
  }

  public saveDirection(dir: Omit<Direction, 'id'> & { id?: number }): Direction {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      if (dir.id) {
        this.db.prepare('UPDATE directions SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dir.name, dir.id);
        return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions WHERE id = ?').get(dir.id);
      } else {
        const info = this.db.prepare('INSERT INTO directions (name) VALUES (?)').run(dir.name);
        return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions WHERE id = ?').get(info.lastInsertRowid);
      }
    });
  }

  public deleteDirection(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      this.db.prepare('DELETE FROM directions WHERE id = ?').run(id);
      return { success: true };
    });
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

  public saveDocument(doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): DocumentRecord {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      const recipientIds = doc.recipientIds || (doc.recipientId ? [doc.recipientId] : []);
      const primaryRecipientId = doc.recipientId || (recipientIds.length > 0 ? recipientIds[0] : null);
      const recipientIdsJson = recipientIds.length > 0 ? JSON.stringify(recipientIds) : null;
      const recipientDeptIdsJson = doc.recipientDepartmentIds && doc.recipientDepartmentIds.length > 0
        ? JSON.stringify(doc.recipientDepartmentIds)
        : null;
      const recipientDeptNames = doc.recipientDepartmentNames || null;

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
        return this.getDocuments().find((d) => d.id === doc.id)!;
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
        return this.getDocuments().find((d) => d.id === info.lastInsertRowid)!;
      }
    });
  }

  public deleteDocument(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    return this.runWithRetry(() => {
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      return { success: true };
    });
  }

  public getCurrentDbPath(): string {
    return this.currentDbPath;
  }
}

export const dbManager = new SQLiteDatabaseManager();
