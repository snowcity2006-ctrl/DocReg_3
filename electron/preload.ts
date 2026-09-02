/**
 * Preload скрипт для безопасного IPC обмена между Main и Renderer процессами Electron
 */
import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI, LogLevel } from '../src/types';

const api: ElectronAPI = {
  // База данных
  getDbConfig: () => ipcRenderer.invoke('db:getConfig'),
  setDbPath: (path: string) => ipcRenderer.invoke('db:setPath', path),
  testDbConnection: (path?: string) => ipcRenderer.invoke('db:testConnection', path),
  refreshDb: () => ipcRenderer.invoke('db:refresh'),

  // Справочники
  getOrganizations: () => ipcRenderer.invoke('org:getAll'),
  saveOrganization: (org) => ipcRenderer.invoke('org:save', org),
  deleteOrganization: (id) => ipcRenderer.invoke('org:delete', id),

  getDepartments: () => ipcRenderer.invoke('dept:getAll'),
  saveDepartment: (dept) => ipcRenderer.invoke('dept:save', dept),
  deleteDepartment: (id) => ipcRenderer.invoke('dept:delete', id),

  getEmployees: () => ipcRenderer.invoke('emp:getAll'),
  saveEmployee: (emp) => ipcRenderer.invoke('emp:save', emp),
  deleteEmployee: (id) => ipcRenderer.invoke('emp:delete', id),

  getDocumentTypes: () => ipcRenderer.invoke('docType:getAll'),
  saveDocumentType: (type) => ipcRenderer.invoke('docType:save', type),
  deleteDocumentType: (id) => ipcRenderer.invoke('docType:delete', id),

  getDirections: () => ipcRenderer.invoke('direction:getAll'),
  saveDirection: (dir) => ipcRenderer.invoke('direction:save', dir),
  deleteDirection: (id) => ipcRenderer.invoke('direction:delete', id),

  // Документы
  getDocuments: () => ipcRenderer.invoke('doc:getAll'),
  getDocumentById: (id) => ipcRenderer.invoke('doc:getById', id),
  saveDocument: (doc) => ipcRenderer.invoke('doc:save', doc),
  deleteDocument: (id) => ipcRenderer.invoke('doc:delete', id),

  // Бэкап
  createBackup: (isAuto) => ipcRenderer.invoke('backup:create', isAuto),
  getBackupsList: () => ipcRenderer.invoke('backup:getList'),
  restoreBackup: (backupPath) => ipcRenderer.invoke('backup:restore', backupPath),

  // Диалоги ОС и открытие файлов
  selectDatabaseFile: () => ipcRenderer.invoke('dialog:selectDbFile'),
  selectDocumentFileOrFolder: () => ipcRenderer.invoke('dialog:selectDocFileOrFolder'),
  openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Логирование
  getLogs: () => ipcRenderer.invoke('logs:getAll'),
  addLog: (level: LogLevel, source, message, details) => ipcRenderer.invoke('logs:add', level, source, message, details),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  // Системная информация
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
