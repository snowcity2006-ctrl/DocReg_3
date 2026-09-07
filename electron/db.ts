/**
 * Модуль базы данных SQLite на базе better-sqlite3 для Electron Main процесса.
 * Специфика ТЗ:
 * 1. Многопользовательская работа на сетевом диске (SMB/NFS).
 * 2. WAL-режим ЗАПРЕЩЕН (так как база на сетевом диске, WAL приводит к рассинхронизации и блокировкам shm/wal файлов).
 * 3. Используется journal_mode = DELETE или TRUNCATE.
 * 4. busy_timeout настроен на 5000 мс для бесконфликтной обработки одновременных запросов 6-10 пользователей.
 * 5. Проверка доступности сетевого пути перед выполнением транзакций.
 */

import fs from 'fs';
import path from 'path';
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
   * Инициализирует подключение к файлу .sqlite
   */
  public async connect(dbPath: string, busyTimeout = 5000): Promise<{ success: boolean; message: string }> {
    try {
      const accessCheck = await this.checkPathAccessibility(dbPath);
      if (!accessCheck.accessible) {
        logger.log('error', 'db', `Сетевой путь недоступен: ${dbPath}`, accessCheck.error);
        return { success: false, message: `Сетевой путь недоступен: ${accessCheck.error}` };
      }

      const effectiveTimeout = Math.max(Number(busyTimeout) || 5000, 5000);

      // Если соединение уже открыто к этому же пути, не разрываем его,
      // чтобы избежать состояния гонки/блокировок файла в сетевой ОС (Astra Linux / SMB)
      if (this.currentDbPath === dbPath && this.db && this.db.open) {
        try {
          this.db.pragma(`busy_timeout = ${effectiveTimeout}`);
        } catch {}
        this.ensureSchema();
        logger.log('info', 'db', `База данных уже открыта (${dbPath}), параметры таймаута обновлены (${effectiveTimeout}мс)`);
        return { success: true, message: 'База данных успешно подключена и инициализирована' };
      }

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

      const fileExists = fs.existsSync(dbPath);
      logger.log('info', 'db', `Подключение к SQLite: ${dbPath} (файл ${fileExists ? 'существует' : 'будет создан'})`);

      this.db = new DatabaseConstructor(dbPath, {
        timeout: effectiveTimeout, // 5000+ мс timeout для 6-10 сетевых пользователей
        verbose: (msg: string) => {
          if (process.env.DEBUG_SQL) console.log(`[SQL]: ${msg}`);
        },
      });

      // 1. СНАЧАЛА устанавливаем busy_timeout, чтобы все последующие прагмы ждали освобождения файла!
      try {
        this.db.pragma(`busy_timeout = ${effectiveTimeout}`);
      } catch {}

      // 2. ВАЖНО ДЛЯ ASTRA LINUX И СЕТЕВЫХ РЕСУРСОВ SMB/NFS:
      // journal_mode = DELETE требует эксклюзивной блокировки. Если база уже в DELETE или TRUNCATE,
      // не вызываем повторный pragma journal_mode, чтобы не провоцировать ошибку "database is locked".
      try {
        const currentJournal = String(this.db.pragma('journal_mode', { simple: true })).toLowerCase();
        if (currentJournal !== 'delete' && currentJournal !== 'truncate') {
          this.db.pragma('journal_mode = DELETE');
        }
      } catch (journalErr: any) {
        logger.log('warn', 'db', `Предупреждение journal_mode: ${journalErr.message}`);
        try {
          this.db.pragma('journal_mode = TRUNCATE');
        } catch {}
      }

      // 3. foreign_keys
      try {
        this.db.pragma('foreign_keys = ON');
      } catch {}

      // 4. synchronous = NORMAL для сетевых файловых систем SMB/NFS исключает зависания сетевого I/O
      try {
        this.db.pragma('synchronous = NORMAL');
      } catch {}

      this.currentDbPath = dbPath;

      // Создаем/проверяем таблицы
      this.ensureSchema();

      logger.log('info', 'db', `Подключение к БД успешно установлено (busy_timeout=${effectiveTimeout}ms, journal_mode=DELETE, sync=NORMAL)`);
      return { success: true, message: 'База данных успешно подключена и инициализирована' };
    } catch (err: any) {
      logger.log('error', 'db', `Ошибка подключения к SQLite: ${err.message}`, err);
      return { success: false, message: `Ошибка подключения: ${err.message}` };
    }
  }

  /**
   * Гарантированная проверка и инициализация схемы базы данных
   */
  public ensureSchema() {
    if (!this.db || !this.db.open) return;
    try {
      const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'").get();
      if (!table) {
        this.initSchema();
      }
    } catch (e: any) {
      logger.log('warn', 'db', `Проверка схемы organizations: ${e.message}, запуск initSchema`);
      this.initSchema();
    }
  }

  /**
   * Инициализация схемы базы данных
   */
  private initSchema() {
    if (!this.db || !this.db.open) return;

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

      -- Таблица: Документы
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

      -- Индексы для быстрой фильтрации и поиска по всем полям
      CREATE INDEX IF NOT EXISTS idx_docs_dates ON documents (incoming_date, outgoing_date);
      CREATE INDEX IF NOT EXISTS idx_docs_type_dir ON documents (doc_type_id, direction_id);
      CREATE INDEX IF NOT EXISTS idx_docs_parties ON documents (sender_id, recipient_id);
    `;

    this.db.exec(schema);

    // Безопасное добавление новых колонок для существующих БД
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN recipient_ids TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN recipient_dept_ids TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN recipient_dept_names TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN sender_dept_id INTEGER;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN sender_dept_name TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN sender_emp_id INTEGER;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN sender_emp_name TEXT;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE employees ADD COLUMN position TEXT;");
    } catch {}

    // Первоначальное наполнение базовыми справочниками, если таблица doc_types пуста
    try {
      const countRow = this.db.prepare('SELECT count(*) as c FROM doc_types').get() as { c: number } | undefined;
      const count = countRow ? countRow.c : 0;
      if (count === 0) {
        const insertOrg = this.db.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)');
        insertOrg.run('АО «НПО РусБИТех» (Astra Linux)', 'Буравой С. М.', 'info@rusbitech.ru');
        insertOrg.run('ПАО «Ростелеком»', 'Осеевский М. Э.', 'corp@rostelecom.ru');
        insertOrg.run('Министерство цифрового развития РФ', 'Шадаев М. И.', 'press@digital.gov.ru');

        const insertDept = this.db.prepare('INSERT INTO departments (name, short_name, organization_id) VALUES (?, ?, ?)');
        insertDept.run('Управление делами и документооборота', 'УДО', 1);
        insertDept.run('Отдел информационной безопасности', 'ОИБ', 1);

        const insertEmp = this.db.prepare('INSERT INTO employees (full_name, position, department_short_name, organization_id) VALUES (?, ?, ?, ?)');
        insertEmp.run('Иванов Иван Иванович', 'Главный специалист', 'УДО', 1);
        insertEmp.run('Смирнова Елена Александровна', 'Начальник отдела', 'ОИБ', 1);

        const insertType = this.db.prepare('INSERT INTO doc_types (name) VALUES (?)');
        ['Входящее письмо', 'Исходящий запрос', 'Приказ', 'Распоряжение', 'Договор', 'Акт приема-передачи'].forEach((t) => insertType.run(t));

        const insertDir = this.db.prepare('INSERT INTO directions (name) VALUES (?)');
        ['Входящие', 'Исходящие', 'Внутренние', 'Нормативно-распорядительные'].forEach((d) => insertDir.run(d));
      }
    } catch (seedErr: any) {
      logger.log('warn', 'db', `Предупреждение первичного заполнения справочников: ${seedErr.message}`);
    }
  }

  // --- CRUD Организации ---
  public getOrganizations(): Organization[] {
    if (!this.db) return [];
    this.ensureSchema();
    return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations ORDER BY name ASC').all();
  }

  public saveOrganization(org: Omit<Organization, 'id'> & { id?: number }): Organization {
    if (!this.db) throw new Error('БД не подключена');
    this.ensureSchema();
    try {
      if (org.id) {
        this.db.prepare('UPDATE organizations SET name = ?, director = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(org.name, org.director || '', org.email || '', org.id);
        return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(org.id);
      } else {
        const info = this.db.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)')
          .run(org.name, org.director || '', org.email || '');
        return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(info.lastInsertRowid);
      }
    } catch (err: any) {
      if (String(err.message).includes('no such table')) {
        this.initSchema();
        if (org.id) {
          this.db.prepare('UPDATE organizations SET name = ?, director = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(org.name, org.director || '', org.email || '', org.id);
          return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(org.id);
        } else {
          const info = this.db.prepare('INSERT INTO organizations (name, director, email) VALUES (?, ?, ?)')
            .run(org.name, org.director || '', org.email || '');
          return this.db.prepare('SELECT id, name, director, email, created_at as createdAt, updated_at as updatedAt FROM organizations WHERE id = ?').get(info.lastInsertRowid);
        }
      }
      throw err;
    }
  }

  public deleteOrganization(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.ensureSchema();
    this.db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
    return { success: true };
  }

  // --- CRUD Структурные подразделения ---
  public getDepartments(): Department[] {
    if (!this.db) return [];
    this.ensureSchema();
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
    this.ensureSchema();
    if (dept.id) {
      this.db.prepare('UPDATE departments SET name = ?, short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(dept.name, dept.shortName, dept.organizationId, dept.id);
      return this.getDepartments().find((d) => d.id === dept.id)!;
    } else {
      const info = this.db.prepare('INSERT INTO departments (name, short_name, organization_id) VALUES (?, ?, ?)')
        .run(dept.name, dept.shortName, dept.organizationId);
      return this.getDepartments().find((d) => d.id === info.lastInsertRowid)!;
    }
  }

  public deleteDepartment(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    return { success: true };
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
    if (emp.id) {
      this.db.prepare('UPDATE employees SET full_name = ?, position = ?, department_short_name = ?, organization_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId, emp.id);
      return this.getEmployees().find((e) => e.id === emp.id)!;
    } else {
      const info = this.db.prepare('INSERT INTO employees (full_name, position, department_short_name, organization_id) VALUES (?, ?, ?, ?)')
        .run(emp.fullName, emp.position || '', emp.departmentShortName, emp.organizationId);
      return this.getEmployees().find((e) => e.id === info.lastInsertRowid)!;
    }
  }

  public deleteEmployee(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    return { success: true };
  }

  // --- CRUD Тип документа ---
  public getDocumentTypes(): DocumentType[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types ORDER BY name ASC').all();
  }

  public saveDocumentType(type: Omit<DocumentType, 'id'> & { id?: number }): DocumentType {
    if (!this.db) throw new Error('БД не подключена');
    if (type.id) {
      this.db.prepare('UPDATE doc_types SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(type.name, type.id);
      return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types WHERE id = ?').get(type.id);
    } else {
      const info = this.db.prepare('INSERT INTO doc_types (name) VALUES (?)').run(type.name);
      return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM doc_types WHERE id = ?').get(info.lastInsertRowid);
    }
  }

  public deleteDocumentType(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.db.prepare('DELETE FROM doc_types WHERE id = ?').run(id);
    return { success: true };
  }

  // --- CRUD Направление ---
  public getDirections(): Direction[] {
    if (!this.db) return [];
    return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions ORDER BY name ASC').all();
  }

  public saveDirection(dir: Omit<Direction, 'id'> & { id?: number }): Direction {
    if (!this.db) throw new Error('БД не подключена');
    if (dir.id) {
      this.db.prepare('UPDATE directions SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dir.name, dir.id);
      return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions WHERE id = ?').get(dir.id);
    } else {
      const info = this.db.prepare('INSERT INTO directions (name) VALUES (?)').run(dir.name);
      return this.db.prepare('SELECT id, name, created_at as createdAt, updated_at as updatedAt FROM directions WHERE id = ?').get(info.lastInsertRowid);
    }
  }

  public deleteDirection(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.db.prepare('DELETE FROM directions WHERE id = ?').run(id);
    return { success: true };
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
        recipientName,
        recipientIds,
        recipientDepartmentIds,
        recipientDepartmentNames: row.recipientDepartmentNames || undefined,
      };
    });
  }

  public saveDocument(doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): DocumentRecord {
    if (!this.db) throw new Error('БД не подключена');
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
          recipient_id = ?, recipient_ids = ?, recipient_dept_ids = ?, recipient_dept_names = ?,
          file_path = ?, sed_url = ?, comments = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        doc.docTypeId, doc.directionId, doc.outgoingNumber || null, doc.outgoingDate || null,
        doc.incomingNumber || null, doc.incomingDate || null, doc.subject, doc.senderId || null,
        doc.senderDepartmentId || null, doc.senderDepartmentName || null,
        doc.senderEmployeeId || null, doc.senderEmployeeName || null,
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
          recipient_id, recipient_ids, recipient_dept_ids, recipient_dept_names,
          file_path, sed_url, comments
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.docTypeId, doc.directionId, doc.outgoingNumber || null, doc.outgoingDate || null,
        doc.incomingNumber || null, doc.incomingDate || null, doc.subject, doc.senderId || null,
        doc.senderDepartmentId || null, doc.senderDepartmentName || null,
        doc.senderEmployeeId || null, doc.senderEmployeeName || null,
        primaryRecipientId, recipientIdsJson, recipientDeptIdsJson, recipientDeptNames,
        doc.filePath || null, doc.sedUrl || null, doc.comments || null
      );
      return this.getDocuments().find((d) => d.id === info.lastInsertRowid)!;
    }
  }

  public deleteDocument(id: number): { success: boolean } {
    if (!this.db) throw new Error('БД не подключена');
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { success: true };
  }

  public getCurrentDbPath(): string {
    return this.currentDbPath;
  }
}

export const dbManager = new SQLiteDatabaseManager();
