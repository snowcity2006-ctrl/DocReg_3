/**
 * Мост взаимодействия с Main-процессом Electron и Web-адаптер для режима предварительного просмотра
 */
import {
  Organization,
  Department,
  Employee,
  DocumentType,
  Direction,
  DocumentRecord,
  DatabaseConfig,
  BackupFileInfo,
  LogEntry,
  LogLevel,
  ElectronAPI
} from '../types';
import { formatDbTimestamp } from '../utils/date';

const STORAGE_KEYS = {
  DB_CONFIG: 'docflow_db_config',
  ORGANIZATIONS: 'docflow_organizations',
  DEPARTMENTS: 'docflow_departments',
  EMPLOYEES: 'docflow_employees',
  DOC_TYPES: 'docflow_doc_types',
  DIRECTIONS: 'docflow_directions',
  DOCUMENTS: 'docflow_documents',
  BACKUPS: 'docflow_backups',
  LOGS: 'docflow_logs',
  LAST_UPDATE: 'docflow_last_update_time',
};

// Начальные данные для инициализации базы данных
const INITIAL_DATA = {
  organizations: [
    { id: 1, name: 'АО «НПО РусБИТех» (Astra Linux)', director: 'Буравой С. М.', email: 'info@rusbitech.ru' },
    { id: 2, name: 'ПАО «Ростелеком»', director: 'Осеевский М. Э.', email: 'corp@rostelecom.ru' },
    { id: 3, name: 'Министерство цифрового развития РФ', director: 'Шадаев М. И.', email: 'press@digital.gov.ru' },
    { id: 4, name: 'ООО «Газпром Автоматизация»', director: 'Попов В. А.', email: 'office@gazprom-auto.ru' },
    { id: 5, name: 'ГК «Астра»', director: 'Сивцев И. И.', email: 'contact@astra.ru' },
  ],
  departments: [
    { id: 1, name: 'Управление делами и документооборота', shortName: 'УДО', organizationId: 1 },
    { id: 2, name: 'Отдел информационной безопасности', shortName: 'ОИБ', organizationId: 1 },
    { id: 3, name: 'Юридический департамент', shortName: 'ЮД', organizationId: 1 },
    { id: 4, name: 'Департамент системной интеграции', shortName: 'ДСИ', organizationId: 2 },
    { id: 5, name: 'Отдел технической поддержки', shortName: 'ОТП', organizationId: 5 },
  ],
  employees: [
    { id: 1, fullName: 'Иванов Иван Иванович', departmentShortName: 'УДО', organizationId: 1 },
    { id: 2, fullName: 'Смирнова Елена Александровна', departmentShortName: 'ОИБ', organizationId: 1 },
    { id: 3, fullName: 'Кузнецов Алексей Владимирович', departmentShortName: 'ЮД', organizationId: 1 },
    { id: 4, fullName: 'Петров Сергей Николаевич', departmentShortName: 'ДСИ', organizationId: 2 },
    { id: 5, fullName: 'Васильева Ольга Дмитриевна', departmentShortName: 'ОТП', organizationId: 5 },
  ],
  docTypes: [
    { id: 1, name: 'Входящее письмо' },
    { id: 2, name: 'Исходящий запрос' },
    { id: 3, name: 'Приказ' },
    { id: 4, name: 'Распоряжение' },
    { id: 5, name: 'Договор' },
    { id: 6, name: 'Акт приема-передачи' },
    { id: 7, name: 'Служебная записка' },
  ],
  directions: [
    { id: 1, name: 'Входящие' },
    { id: 2, name: 'Исходящие' },
    { id: 3, name: 'Внутренние' },
    { id: 4, name: 'Нормативно-распорядительные' },
  ],
  documents: [
    {
      id: 1,
      docTypeId: 1,
      directionId: 1,
      outgoingNumber: 'МЦР-128/2026',
      outgoingDate: '2026-08-20',
      incomingNumber: 'ВХ-00452',
      incomingDate: '2026-08-22',
      subject: 'О согласовании внедрения СЭД на базе Astra Linux 1.7 Special Edition',
      senderId: 3,
      recipientId: 1,
      filePath: '/mnt/network_share/documents/2026/08/MCR-128_Agreement.pdf',
      sedUrl: 'https://sed.company.local/docs/card/45291',
      comments: 'Приложение содержит регламент безопасности и акт совместимости',
      createdAt: '2026-08-22T09:15:00.000Z',
      updatedAt: '2026-08-22T09:15:00.000Z',
    },
    {
      id: 2,
      docTypeId: 2,
      directionId: 2,
      outgoingNumber: 'ИСХ-0089/26',
      outgoingDate: '2026-08-25',
      incomingNumber: '',
      incomingDate: '',
      subject: 'Запрос коммерческого предложения на поставку серверных лицензий Astra Linux 1.8',
      senderId: 1,
      recipientId: 5,
      filePath: '/mnt/network_share/documents/2026/08/Request_Astra_Licenses.docx',
      sedUrl: 'https://sed.company.local/docs/card/45312',
      comments: 'Срок ответа до 10.09.2026',
      createdAt: '2026-08-25T11:30:00.000Z',
      updatedAt: '2026-08-25T11:30:00.000Z',
    },
    {
      id: 3,
      docTypeId: 3,
      directionId: 4,
      outgoingNumber: 'ПР-45/ОД',
      outgoingDate: '2026-09-01',
      incomingNumber: '',
      incomingDate: '',
      subject: 'О вводе в промышленную эксплуатацию автономной системы учета документооборота',
      senderId: 1,
      recipientId: 1,
      filePath: '/mnt/network_share/orders/2026/Order_45_Docflow_Deploy.pdf',
      sedUrl: 'https://sed.company.local/orders/45-od',
      comments: 'Ответственным за сопровождение сетевой БД назначен отдел ОИБ',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z',
    },
    {
      id: 4,
      docTypeId: 5,
      directionId: 3,
      outgoingNumber: 'ДОГ-2026/91-А',
      outgoingDate: '2026-08-15',
      incomingNumber: 'ВХ-00388',
      incomingDate: '2026-08-18',
      subject: 'Договор на техническое обслуживание защищенной инфраструктуры и сетевых дисков',
      senderId: 2,
      recipientId: 1,
      filePath: '/mnt/network_share/contracts/2026/Contract_91A_Rostelecom.pdf',
      sedUrl: 'https://sed.company.local/contracts/view/91-a',
      comments: 'Подписан усиленной ЭЦП обеих сторон',
      createdAt: '2026-08-18T14:20:00.000Z',
      updatedAt: '2026-08-18T14:20:00.000Z',
    },
  ],
};

class WebMockDatabase implements ElectronAPI {
  private config: DatabaseConfig;
  private logs: LogEntry[] = [];
  private lastUpdateTime: string;

  constructor() {
    // Загрузка конфигурации
    const savedConfig = localStorage.getItem(STORAGE_KEYS.DB_CONFIG);
    if (savedConfig) {
      try {
        this.config = JSON.parse(savedConfig);
      } catch {
        this.config = this.getDefaultConfig();
      }
    } else {
      this.config = this.getDefaultConfig();
      this.saveConfig(this.config);
    }

    this.lastUpdateTime = localStorage.getItem(STORAGE_KEYS.LAST_UPDATE) || formatDbTimestamp();

    // Инициализация логов
    const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
    if (savedLogs) {
      try {
        this.logs = JSON.parse(savedLogs);
      } catch {
        this.logs = [];
      }
    }

    // Инициализация таблиц, если пусто
    this.initDatabaseIfEmpty();

    // Автоматический бэкап при запуске
    if (this.config.autoBackupOnStart) {
      setTimeout(() => {
        this.createBackup(true).catch(console.error);
      }, 500);
    }

    this.addLog('info', 'main', 'Инициализация подсистемы документооборота завершена успешно');
  }

  private getDefaultConfig(): DatabaseConfig {
    return {
      dbPath: '/mnt/smb_share/docflow/company_docs.sqlite',
      busyTimeout: 5000,
      autoBackupOnStart: true,
      backupFolder: '/mnt/smb_share/docflow/backup',
      isNetworkPath: true,
      isAccessible: true,
      lastConnected: new Date().toISOString(),
    };
  }

  private saveConfig(config: DatabaseConfig) {
    this.config = config;
    localStorage.setItem(STORAGE_KEYS.DB_CONFIG, JSON.stringify(config));
  }

  private initDatabaseIfEmpty() {
    if (!localStorage.getItem(STORAGE_KEYS.ORGANIZATIONS)) {
      localStorage.setItem(STORAGE_KEYS.ORGANIZATIONS, JSON.stringify(INITIAL_DATA.organizations));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DEPARTMENTS)) {
      localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(INITIAL_DATA.departments));
    }
    if (!localStorage.getItem(STORAGE_KEYS.EMPLOYEES)) {
      localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(INITIAL_DATA.employees));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DOC_TYPES)) {
      localStorage.setItem(STORAGE_KEYS.DOC_TYPES, JSON.stringify(INITIAL_DATA.docTypes));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DIRECTIONS)) {
      localStorage.setItem(STORAGE_KEYS.DIRECTIONS, JSON.stringify(INITIAL_DATA.directions));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DOCUMENTS)) {
      localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(INITIAL_DATA.documents));
    }
    if (!localStorage.getItem(STORAGE_KEYS.BACKUPS)) {
      const initialBackups: BackupFileInfo[] = [
        {
          fileName: 'docflow_backup_auto_2026-09-01_08.00.00.sqlite',
          filePath: '/mnt/smb_share/docflow/backup/docflow_backup_auto_2026-09-01_08.00.00.sqlite',
          fileSize: 147456,
          createdAt: '2026-09-01T08:00:00.000Z',
          isAuto: true,
        },
      ];
      localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(initialBackups));
    }
  }

  private touchUpdateTime(): string {
    const timestamp = formatDbTimestamp();
    this.lastUpdateTime = timestamp;
    localStorage.setItem(STORAGE_KEYS.LAST_UPDATE, timestamp);
    return timestamp;
  }

  // --- Database Config & Maintenance ---
  async getDbConfig(): Promise<DatabaseConfig> {
    return { ...this.config };
  }

  async getDbStatus() {
    return {
      lastUpdated: this.lastUpdateTime || formatDbTimestamp(),
      isNetwork: this.config.isNetworkPath,
      isAccessible: this.config.isAccessible,
      path: this.config.dbPath,
      busyTimeout: this.config.busyTimeout,
    };
  }

  async setDbPath(path: string): Promise<{ success: boolean; message: string; config?: DatabaseConfig }> {
    const trimmed = path.trim();
    if (!trimmed) {
      return { success: false, message: 'Путь к файлу базы данных не может быть пустым' };
    }

    const isNet = trimmed.startsWith('//') || trimmed.startsWith('\\\\') || trimmed.includes('/mnt/') || trimmed.includes('smb') || trimmed.includes('nfs');
    this.config = {
      ...this.config,
      dbPath: trimmed,
      isNetworkPath: isNet,
      isAccessible: true,
      lastConnected: new Date().toISOString(),
    };
    this.saveConfig(this.config);
    this.touchUpdateTime();
    await this.addLog('info', 'db', `Установлен новый путь к БД: ${trimmed} (${isNet ? 'Сетевой диск SMB/NFS' : 'Локальный диск'})`);

    return {
      success: true,
      message: `Подключение к БД успешно настроено: ${trimmed}`,
      config: this.config,
    };
  }

  async testDbConnection(path?: string): Promise<{ success: boolean; message: string; isNetwork?: boolean; pingMs?: number }> {
    const targetPath = path || this.config.dbPath;
    const isNet = targetPath.startsWith('//') || targetPath.startsWith('\\\\') || targetPath.includes('/mnt/') || targetPath.includes('smb') || targetPath.includes('nfs');
    
    // Имитация сетевой задержки и проверки доступности пути
    const ping = isNet ? Math.floor(Math.random() * 15 + 8) : Math.floor(Math.random() * 3 + 1);
    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.addLog('info', 'network', `Проверка доступности пути БД: ${targetPath} (время отклика: ${ping} мс, busy_timeout: ${this.config.busyTimeout} мс)`);

    return {
      success: true,
      message: `Сетевой ресурс доступен. Файл БД готов к работе (Режим блокировки: busy_timeout ${this.config.busyTimeout}мс, Journal Mode: DELETE/TRUNCATE).`,
      isNetwork: isNet,
      pingMs: ping,
    };
  }

  async refreshDb(): Promise<{ success: boolean; timestamp: string }> {
    const timestamp = this.touchUpdateTime();
    await this.addLog('info', 'db', `Принудительное обновление данных из БД (${timestamp})`);
    return { success: true, timestamp };
  }

  // --- Справочник: Организации ---
  async getOrganizations(): Promise<Organization[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.ORGANIZATIONS);
    return raw ? JSON.parse(raw) : [];
  }

  async saveOrganization(org: Omit<Organization, 'id'> & { id?: number }): Promise<Organization> {
    const list = await this.getOrganizations();
    let saved: Organization;
    const now = new Date().toISOString();

    if (org.id) {
      const idx = list.findIndex((i) => i.id === org.id);
      if (idx === -1) throw new Error('Организация не найдена');
      saved = { ...list[idx], ...org, updatedAt: now };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлена организация: "${saved.name}" (ID: ${saved.id})`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        id: newId,
        name: org.name.trim(),
        director: org.director?.trim() || '',
        email: org.email?.trim() || '',
        createdAt: now,
        updatedAt: now,
      };
      list.push(saved);
      await this.addLog('info', 'db', `Добавлена новая организация: "${saved.name}" (ID: ${saved.id})`);
    }

    localStorage.setItem(STORAGE_KEYS.ORGANIZATIONS, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteOrganization(id: number): Promise<{ success: boolean }> {
    const list = await this.getOrganizations();
    // Проверка зависимостей
    const depts = await this.getDepartments();
    const isUsedInDept = depts.some((d) => d.organizationId === id);
    if (isUsedInDept) {
      throw new Error('Нельзя удалить организацию, так как к ней привязаны структурные подразделения');
    }

    const docs = await this.getDocuments();
    const isUsedInDocs = docs.some((d) => d.senderId === id || d.recipientId === id);
    if (isUsedInDocs) {
      throw new Error('Нельзя удалить организацию, так как она указана в зарегистрированных документах');
    }

    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.ORGANIZATIONS, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удалена организация ID: ${id}`);
    return { success: true };
  }

  // --- Справочник: Структурное подразделение ---
  async getDepartments(): Promise<Department[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
    const orgs = await this.getOrganizations();
    const list: Department[] = raw ? JSON.parse(raw) : [];
    
    // Заполняем имя организации
    return list.map((dept) => {
      const org = orgs.find((o) => o.id === dept.organizationId);
      return {
        ...dept,
        organizationName: org ? org.name : '—',
      };
    });
  }

  async saveDepartment(dept: Omit<Department, 'id'> & { id?: number }): Promise<Department> {
    const list = await this.getDepartments();
    const orgs = await this.getOrganizations();
    const org = orgs.find((o) => o.id === dept.organizationId);
    if (!org) throw new Error('Выбранная организация не найдена');

    let saved: Department;
    const now = new Date().toISOString();

    if (dept.id) {
      const idx = list.findIndex((i) => i.id === dept.id);
      if (idx === -1) throw new Error('Подразделение не найдено');
      saved = {
        ...list[idx],
        ...dept,
        organizationName: org.name,
        updatedAt: now,
      };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлено структурное подразделение: "${saved.name}" (ID: ${saved.id})`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        id: newId,
        name: dept.name.trim(),
        shortName: dept.shortName.trim(),
        organizationId: dept.organizationId,
        organizationName: org.name,
        createdAt: now,
        updatedAt: now,
      };
      list.push(saved);
      await this.addLog('info', 'db', `Добавлено структурное подразделение: "${saved.name}" (${saved.shortName})`);
    }

    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteDepartment(id: number): Promise<{ success: boolean }> {
    const list = await this.getDepartments();
    const target = list.find((d) => d.id === id);
    if (!target) return { success: true };

    // Проверка сотрудников
    const emps = await this.getEmployees();
    const isUsed = emps.some((e) => e.departmentShortName === target.shortName && e.organizationId === target.organizationId);
    if (isUsed) {
      throw new Error('Нельзя удалить подразделение, к которому привязаны сотрудники');
    }

    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удалено подразделение ID: ${id}`);
    return { success: true };
  }

  // --- Справочник: Сотрудники ---
  async getEmployees(): Promise<Employee[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    const orgs = await this.getOrganizations();
    const list: Employee[] = raw ? JSON.parse(raw) : [];

    return list.map((emp) => {
      const org = orgs.find((o) => o.id === emp.organizationId);
      return {
        ...emp,
        organizationName: org ? org.name : '—',
      };
    });
  }

  async saveEmployee(emp: Omit<Employee, 'id'> & { id?: number }): Promise<Employee> {
    const list = await this.getEmployees();
    const orgs = await this.getOrganizations();
    const org = orgs.find((o) => o.id === emp.organizationId);
    if (!org) throw new Error('Выбранная организация не найдена');

    let saved: Employee;
    const now = new Date().toISOString();

    if (emp.id) {
      const idx = list.findIndex((i) => i.id === emp.id);
      if (idx === -1) throw new Error('Сотрудник не найден');
      saved = {
        ...list[idx],
        ...emp,
        organizationName: org.name,
        updatedAt: now,
      };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлен сотрудник: "${saved.fullName}" (ID: ${saved.id})`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        id: newId,
        fullName: emp.fullName.trim(),
        departmentShortName: emp.departmentShortName.trim(),
        organizationId: emp.organizationId,
        organizationName: org.name,
        createdAt: now,
        updatedAt: now,
      };
      list.push(saved);
      await this.addLog('info', 'db', `Добавлен сотрудник: "${saved.fullName}" (${saved.departmentShortName})`);
    }

    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteEmployee(id: number): Promise<{ success: boolean }> {
    const list = await this.getEmployees();
    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удален сотрудник ID: ${id}`);
    return { success: true };
  }

  // --- Справочник: Тип документа ---
  async getDocumentTypes(): Promise<DocumentType[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.DOC_TYPES);
    return raw ? JSON.parse(raw) : [];
  }

  async saveDocumentType(type: Omit<DocumentType, 'id'> & { id?: number }): Promise<DocumentType> {
    const list = await this.getDocumentTypes();
    let saved: DocumentType;
    const now = new Date().toISOString();

    if (type.id) {
      const idx = list.findIndex((i) => i.id === type.id);
      if (idx === -1) throw new Error('Тип документа не найден');
      saved = { ...list[idx], ...type, updatedAt: now };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлен тип документа: "${saved.name}" (ID: ${saved.id})`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        id: newId,
        name: type.name.trim(),
        createdAt: now,
        updatedAt: now,
      };
      list.push(saved);
      await this.addLog('info', 'db', `Добавлен тип документа: "${saved.name}"`);
    }

    localStorage.setItem(STORAGE_KEYS.DOC_TYPES, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteDocumentType(id: number): Promise<{ success: boolean }> {
    const list = await this.getDocumentTypes();
    const docs = await this.getDocuments();
    const isUsed = docs.some((d) => d.docTypeId === id);
    if (isUsed) {
      throw new Error('Нельзя удалить тип документа, так как он используется в зарегистрированных документах');
    }

    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.DOC_TYPES, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удален тип документа ID: ${id}`);
    return { success: true };
  }

  // --- Справочник: Направление ---
  async getDirections(): Promise<Direction[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.DIRECTIONS);
    return raw ? JSON.parse(raw) : [];
  }

  async saveDirection(dir: Omit<Direction, 'id'> & { id?: number }): Promise<Direction> {
    const list = await this.getDirections();
    let saved: Direction;
    const now = new Date().toISOString();

    if (dir.id) {
      const idx = list.findIndex((i) => i.id === dir.id);
      if (idx === -1) throw new Error('Направление не найдено');
      saved = { ...list[idx], ...dir, updatedAt: now };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлено направление: "${saved.name}" (ID: ${saved.id})`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        id: newId,
        name: dir.name.trim(),
        createdAt: now,
        updatedAt: now,
      };
      list.push(saved);
      await this.addLog('info', 'db', `Добавлено направление: "${saved.name}"`);
    }

    localStorage.setItem(STORAGE_KEYS.DIRECTIONS, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteDirection(id: number): Promise<{ success: boolean }> {
    const list = await this.getDirections();
    const docs = await this.getDocuments();
    const isUsed = docs.some((d) => d.directionId === id);
    if (isUsed) {
      throw new Error('Нельзя удалить направление, так как оно используется в документах');
    }

    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.DIRECTIONS, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удалено направление ID: ${id}`);
    return { success: true };
  }

  // --- Документы ---
  async getDocuments(): Promise<DocumentRecord[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.DOCUMENTS);
    const docs: DocumentRecord[] = raw ? JSON.parse(raw) : [];
    const docTypes = await this.getDocumentTypes();
    const directions = await this.getDirections();
    const orgs = await this.getOrganizations();
    const depts = await this.getDepartments();
    const emps = await this.getEmployees();

    return docs.map((doc) => {
      const dt = docTypes.find((t) => t.id === doc.docTypeId);
      const dir = directions.find((d) => d.id === doc.directionId);
      const sender = orgs.find((o) => o.id === doc.senderId);

      let senderDepartmentName = doc.senderDepartmentName;
      if (!senderDepartmentName && doc.senderDepartmentId) {
        const sDept = depts.find((item) => item.id === doc.senderDepartmentId);
        if (sDept) senderDepartmentName = sDept.shortName || sDept.name;
      }

      let senderEmployeeName = doc.senderEmployeeName;
      if (!senderEmployeeName && doc.senderEmployeeId) {
        const sEmp = emps.find((item) => item.id === doc.senderEmployeeId);
        if (sEmp) senderEmployeeName = sEmp.fullName;
      }
      
      let recipientName = '—';
      const rIds = doc.recipientIds && doc.recipientIds.length > 0
        ? doc.recipientIds
        : (doc.recipientId ? [doc.recipientId] : []);

      if (rIds.length > 0) {
        const names = rIds.map((id) => orgs.find((o) => o.id === id)?.name).filter(Boolean);
        if (names.length > 0) {
          recipientName = names.join(', ');
        }
      } else if (doc.recipientId) {
        const recipient = orgs.find((o) => o.id === doc.recipientId);
        recipientName = recipient ? recipient.name : '—';
      }

      let recipientDepartmentNames = doc.recipientDepartmentNames;
      if (!recipientDepartmentNames && doc.recipientDepartmentIds && doc.recipientDepartmentIds.length > 0) {
        const dNames = doc.recipientDepartmentIds
          .map((id) => {
            const d = depts.find((item) => item.id === id);
            return d ? (d.shortName || d.name) : null;
          })
          .filter(Boolean);
        if (dNames.length > 0) {
          recipientDepartmentNames = dNames.join(', ');
        }
      }

      return {
        ...doc,
        docTypeName: dt ? dt.name : '—',
        directionName: dir ? dir.name : '—',
        senderName: sender ? sender.name : '—',
        recipientName,
        recipientIds: rIds,
        recipientDepartmentIds: doc.recipientDepartmentIds || [],
        recipientDepartmentNames,
      };
    });
  }

  async getDocumentById(id: number): Promise<DocumentRecord | null> {
    const docs = await this.getDocuments();
    return docs.find((d) => d.id === id) || null;
  }

  async saveDocument(doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): Promise<DocumentRecord> {
    const list = await this.getDocuments();
    const now = new Date().toISOString();
    let saved: DocumentRecord;

    const rIds = doc.recipientIds || (doc.recipientId ? [doc.recipientId] : []);
    const primaryRecipientId = doc.recipientId || (rIds.length > 0 ? rIds[0] : undefined);

    const docToSave = {
      ...doc,
      senderDepartmentId: doc.senderDepartmentId || undefined,
      senderDepartmentName: doc.senderDepartmentName || undefined,
      senderEmployeeId: doc.senderEmployeeId || undefined,
      senderEmployeeName: doc.senderEmployeeName || undefined,
      recipientId: primaryRecipientId,
      recipientIds: rIds,
      recipientDepartmentIds: doc.recipientDepartmentIds || [],
      recipientDepartmentNames: doc.recipientDepartmentNames || undefined,
    };

    if (doc.id) {
      const idx = list.findIndex((i) => i.id === doc.id);
      if (idx === -1) throw new Error('Документ не найден');
      saved = {
        ...list[idx],
        ...docToSave,
        updatedAt: now,
      };
      list[idx] = saved;
      await this.addLog('info', 'db', `Обновлен документ №${saved.id}: "${saved.subject}"`);
    } else {
      const newId = list.length > 0 ? Math.max(...list.map((i) => i.id)) + 1 : 1;
      saved = {
        ...docToSave,
        id: newId,
        createdAt: now,
        updatedAt: now,
      };
      list.unshift(saved);
      await this.addLog('info', 'db', `Зарегистрирован новый документ №${saved.id}: "${saved.subject}"`);
    }

    localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(list));
    this.touchUpdateTime();
    return saved;
  }

  async deleteDocument(id: number): Promise<{ success: boolean }> {
    const list = await this.getDocuments();
    const filtered = list.filter((i) => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(filtered));
    this.touchUpdateTime();
    await this.addLog('warn', 'db', `Удален документ ID: ${id}`);
    return { success: true };
  }

  // --- Резервное копирование ---
  async createBackup(isAuto: boolean = false): Promise<{ success: boolean; backupPath: string; message: string }> {
    const rawBackups = localStorage.getItem(STORAGE_KEYS.BACKUPS);
    const backups: BackupFileInfo[] = rawBackups ? JSON.parse(rawBackups) : [];

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`;
    const prefix = isAuto ? 'docflow_backup_auto' : 'docflow_backup_manual';
    const fileName = `${prefix}_${dateStr}.sqlite`;
    const folder = this.config.backupFolder || '/mnt/smb_share/docflow/backup';
    const filePath = `${folder}/${fileName}`;

    // Примерный размер базы на основе данных
    const approxSize = 145000 + (localStorage.getItem(STORAGE_KEYS.DOCUMENTS)?.length || 0) * 12;

    const newBackup: BackupFileInfo = {
      fileName,
      filePath,
      fileSize: approxSize,
      createdAt: now.toISOString(),
      isAuto,
    };

    backups.unshift(newBackup);
    localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backups.slice(0, 30))); // Храним последние 30 копий

    const logMsg = isAuto
      ? `Автоматическое резервное копирование выполнено: ${fileName}`
      : `Ручное резервное копирование выполнено: ${fileName}`;
    await this.addLog('success', 'backup', logMsg);

    return {
      success: true,
      backupPath: filePath,
      message: `Резервная копия успешно создана в: ${filePath}`,
    };
  }

  async getBackupsList(): Promise<BackupFileInfo[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.BACKUPS);
    return raw ? JSON.parse(raw) : [];
  }

  async restoreBackup(backupPath: string): Promise<{ success: boolean; message: string }> {
    await this.addLog('warn', 'backup', `Восстановление данных из резервной копии: ${backupPath}`);
    this.touchUpdateTime();
    return {
      success: true,
      message: `База данных успешно восстановлена из: ${backupPath}`,
    };
  }

  // --- Файловая система и диалоги ОС ---
  async selectDatabaseFile(): Promise<string | null> {
    // В Electron открывается системный dialog.showOpenDialog. В браузере эмулируем выбор сетевого/локального файла
    const samplePaths = [
      '/mnt/smb_share/docflow/company_docs.sqlite',
      '\\\\server01\\docflow\\shared_database.sqlite',
      '/home/user/docflow_data/local_network.sqlite',
    ];
    return samplePaths[Math.floor(Math.random() * samplePaths.length)];
  }

  async selectDocumentFileOrFolder(): Promise<string | null> {
    const sampleFiles = [
      '/mnt/network_share/documents/2026/Outgoing_Request_0089.pdf',
      '/mnt/network_share/orders/2026/Order_45_Deploy.pdf',
      '/mnt/network_share/contracts/2026/Contract_91A.pdf',
      '/mnt/network_share/scans/Incoming_Scan_00452.jpg',
    ];
    return sampleFiles[Math.floor(Math.random() * sampleFiles.length)];
  }

  async openPath(path: string): Promise<{ success: boolean; message?: string }> {
    await this.addLog('info', 'ui', `Запрос на открытие файла/папки ОС: ${path}`);
    return {
      success: true,
      message: `Открыто в файловом менеджере ОС (Astra Linux Fly / Explorer): ${path}`,
    };
  }

  async openExternal(url: string): Promise<{ success: boolean; message?: string }> {
    await this.addLog('info', 'ui', `Открытие внешней ссылки СЭД: ${url}`);
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
    return {
      success: true,
      message: `Ссылка открыта в веб-браузере: ${url}`,
    };
  }

  // --- Логирование ---
  async getLogs(limit?: number): Promise<LogEntry[]> {
    if (limit && limit > 0) {
      return this.logs.slice(0, limit);
    }
    return [...this.logs];
  }

  async addLog(level: LogLevel, source: LogEntry['source'], message: string, details?: any): Promise<void> {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) {
      this.logs = this.logs.slice(0, 200);
    }
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(this.logs));
  }

  async exportLogs(): Promise<{ success: boolean; path?: string }> {
    const content = this.logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}]: ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`)
      .join('\n');
    
    // Создаем скачиваемый blob
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docflow_log_${formatDbTimestamp()}.log`;
    a.click();
    URL.revokeObjectURL(url);

    await this.addLog('info', 'main', 'Журнал событий выгружен в файл');
    return { success: true, path: a.download };
  }

  async clearLogs(): Promise<void> {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEYS.LOGS);
    await this.addLog('info', 'main', 'Журнал событий очищен');
  }

  // --- Системная информация ---
  async getSystemInfo(): Promise<{ platform: string; isAstraLinux: boolean; version: string; isElectron: boolean }> {
    return {
      platform: 'Linux (Astra Linux Special Edition 1.7.4 / 1.8)',
      isAstraLinux: true,
      version: '1.0.0-portable-appimage',
      isElectron: false,
    };
  }
}

// Единый экземпляр сервиса
const webMock = new WebMockDatabase();

export const electronBridge: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop: keyof ElectronAPI) {
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI[prop] === 'function') {
      return window.electronAPI[prop];
    }
    // Фолбэк на встроенный браузерный адаптер
    if (prop in webMock) {
      return (webMock[prop] as any).bind(webMock);
    }
    return async () => ({ success: false, message: 'Метод не реализован' });
  },
});
