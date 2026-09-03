/**
 * Main Process для Electron приложения учета документооборота.
 * Поддержка Astra Linux 1.7 / 1.8 и кроссплатформенный запуск.
 */

import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { dbManager } from './db';
import { backupManager } from './backup';
import { logger } from './logger';
import { store } from './store';
import { DatabaseConfig } from '../src/types';

// Оптимизация и совместимость для Astra Linux (Parsec / X11 / Wayland / Fly)
if (process.platform === 'linux') {
  // В Astra Linux (включая замкнутую программную среду и мандатный контроль доступа)
  // песочница Chromium требует специальных прав suid либо должна быть отключена:
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  // Отключение аппаратного ускорения при отсутствии драйверов в сертифицированных сборках
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

// Обработка критических ошибок до падения процесса
process.on('uncaughtException', (error) => {
  console.error('[DocFlow Critical Error]:', error);
  try {
    logger.log('error', 'main', `Критическая ошибка процесса: ${error.message}`, error.stack);
  } catch {}
});

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Система учета документооборота',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // В разработке загружаем локальный dev-сервер Vite, в production - собранный index.html
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexPath)) {
      await mainWindow.loadFile(indexPath);
    } else {
      await mainWindow.loadURL('http://localhost:3000');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Регистрация IPC обработчиков
function setupIpcHandlers() {
  // --- База данных ---
  ipcMain.handle('db:getConfig', async () => {
    return store.getDbConfig();
  });

  ipcMain.handle('db:setPath', async (_event, newPath: string) => {
    const res = await dbManager.connect(newPath);
    if (res.success) {
      const isNet = newPath.startsWith('//') || newPath.startsWith('\\\\') || newPath.includes('/mnt/') || newPath.includes('smb') || newPath.includes('nfs');
      const updated = store.setDbConfig({
        dbPath: newPath,
        isNetworkPath: isNet,
        isAccessible: true,
        lastConnected: new Date().toISOString(),
      });
      return { success: true, message: res.message, config: updated };
    }
    return { success: false, message: res.message };
  });

  ipcMain.handle('db:testConnection', async (_event, targetPath?: string) => {
    const cfg = store.getDbConfig();
    const p = targetPath || cfg.dbPath;
    const access = await dbManager.checkPathAccessibility(p);
    return {
      success: access.accessible,
      message: access.accessible ? 'Сетевой путь доступен' : `Ошибка доступа: ${access.error}`,
      isNetwork: p.includes('/mnt/') || p.includes('smb') || p.includes('nfs') || p.startsWith('\\\\'),
    };
  });

  ipcMain.handle('db:refresh', async () => {
    return { success: true, timestamp: new Date().toISOString() };
  });

  // --- Справочники ---
  ipcMain.handle('org:getAll', async () => dbManager.getOrganizations());
  ipcMain.handle('org:save', async (_e, org) => dbManager.saveOrganization(org));
  ipcMain.handle('org:delete', async (_e, id) => dbManager.deleteOrganization(id));

  ipcMain.handle('dept:getAll', async () => dbManager.getDepartments());
  ipcMain.handle('dept:save', async (_e, dept) => dbManager.saveDepartment(dept));
  ipcMain.handle('dept:delete', async (_e, id) => dbManager.deleteDepartment(id));

  ipcMain.handle('emp:getAll', async () => dbManager.getEmployees());
  ipcMain.handle('emp:save', async (_e, emp) => dbManager.saveEmployee(emp));
  ipcMain.handle('emp:delete', async (_e, id) => dbManager.deleteEmployee(id));

  ipcMain.handle('docType:getAll', async () => dbManager.getDocumentTypes());
  ipcMain.handle('docType:save', async (_e, type) => dbManager.saveDocumentType(type));
  ipcMain.handle('docType:delete', async (_e, id) => dbManager.deleteDocumentType(id));

  ipcMain.handle('direction:getAll', async () => dbManager.getDirections());
  ipcMain.handle('direction:save', async (_e, dir) => dbManager.saveDirection(dir));
  ipcMain.handle('direction:delete', async (_e, id) => dbManager.deleteDirection(id));

  // --- Документы ---
  ipcMain.handle('doc:getAll', async () => dbManager.getDocuments());
  ipcMain.handle('doc:getById', async (_e, id) => dbManager.getDocuments().find((d) => d.id === id) || null);
  ipcMain.handle('doc:save', async (_e, doc) => dbManager.saveDocument(doc));
  ipcMain.handle('doc:delete', async (_e, id) => dbManager.deleteDocument(id));

  // --- Резервное копирование ---
  ipcMain.handle('backup:create', async (_e, isAuto = false) => backupManager.createBackup(isAuto));
  ipcMain.handle('backup:getList', async () => backupManager.getBackupsList());
  ipcMain.handle('backup:restore', async (_e, backupPath: string) => backupManager.restoreBackup(backupPath));

  // --- Диалоги ОС и открытие файлов ---
  ipcMain.handle('dialog:selectDbFile', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите файл базы данных SQLite на сетевом или локальном диске',
      properties: ['openFile', 'createDirectory'],
      filters: [
        { name: 'База данных SQLite (*.sqlite, *.db)', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:selectDocFileOrFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите файл документа или папку хранения на сетевом диске',
      properties: ['openFile', 'openDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('shell:openPath', async (_e, filePath: string) => {
    try {
      if (!filePath) return { success: false, message: 'Путь не указан' };
      const res = await shell.openPath(filePath);
      if (res) {
        return { success: false, message: res };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    try {
      if (!url) return { success: false, message: 'URL не указан' };
      await shell.openExternal(url);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });

  // --- Логирование ---
  ipcMain.handle('logs:getAll', async () => logger.getLogs());
  ipcMain.handle('logs:add', async (_e, level, source, message, details) => {
    logger.log(level, source, message, details);
  });
  ipcMain.handle('logs:export', async () => {
    const logPath = logger.getLogFilePath();
    return { success: true, path: logPath };
  });
  ipcMain.handle('logs:clear', async () => {
    logger.clearLogs();
  });

  // --- Системная информация ---
  ipcMain.handle('system:getInfo', async () => {
    const isAstra = process.platform === 'linux' && (fs.existsSync('/etc/astra_version') || fs.existsSync('/etc/os-release'));
    return {
      platform: process.platform,
      isAstraLinux: isAstra,
      version: app.getVersion(),
      isElectron: true,
    };
  });
}

// Запуск приложения
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    logger.log('info', 'main', `Запуск приложения v${app.getVersion()} на платформе ${process.platform}`);
    setupIpcHandlers();

    // Автоматическая инициализация БД из сохраненного конфига
    const config = store.getDbConfig();
    if (config.dbPath) {
      await dbManager.connect(config.dbPath, config.busyTimeout);
      if (config.autoBackupOnStart) {
        await backupManager.createBackup(true);
      }
    }

    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
