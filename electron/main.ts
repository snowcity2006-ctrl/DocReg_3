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
  // Предотвращает падение Chromium GPU-процесса в Astra Linux без проприетарных драйверов
  try {
    app.disableHardwareAcceleration();
  } catch {}
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

function getPreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.cjs'),
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
    path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return path.join(__dirname, 'preload.cjs');
}

function getIndexPath(): string {
  const candidates = [
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
    path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html'),
    path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
    path.join(__dirname, 'dist', 'index.html'),
    path.join(__dirname, 'index.html'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

async function createWindow() {
  const preloadPath = getPreloadPath();
  console.log('[Electron] Using preload script:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Система учета документооборота',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Диагностика загрузки контента
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron did-fail-load] Code: ${errorCode}, Description: ${errorDescription}, URL: ${validatedURL}`);
    try {
      logger.log('error', 'main', `Ошибка загрузки URL: ${validatedURL}`, { errorCode, errorDescription });
    } catch {}
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron render-process-gone]:', details);
    try {
      logger.log('error', 'main', 'Рендер-процесс аварийно завершен', details);
    } catch {}
  });

  // В разработке загружаем локальный dev-сервер Vite, в production - собранный index.html
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = getIndexPath();
    if (fs.existsSync(indexPath)) {
      console.log('[Electron] Loading frontend from file:', indexPath);
      await mainWindow.loadFile(indexPath);
    } else {
      console.warn('[Electron] dist/index.html not found, fallback to localhost:3000');
      try {
        await mainWindow.loadURL('http://localhost:3000');
      } catch (err: any) {
        console.error('[Electron] Failed to connect to localhost:3000:', err.message);
        await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><title>DocFlow - Ошибка</title></head>
          <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
            <h2 style="color: #ef4444;">Интерфейс не найден</h2>
            <p>Не удалось обнаружить файл <code>dist/index.html</code>.</p>
            <p style="color: #94a3b8; font-size: 13px;">AppPath: ${app.getAppPath()}</p>
          </body>
          </html>
        `)}`);
      }
    }
  }

  // Страховочный показ окна через 1 сек, если ready-to-show задержался
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);

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

  ipcMain.handle('db:getStatus', async () => {
    const cfg = store.getDbConfig();
    const access = await dbManager.checkPathAccessibility(cfg.dbPath);
    const docs = dbManager.getDocuments();
    return {
      connected: access.accessible,
      path: cfg.dbPath,
      isNetwork: cfg.isNetworkPath,
      isAccessible: access.accessible,
      lastSync: cfg.lastConnected || new Date().toISOString(),
      recordsCount: Array.isArray(docs) ? docs.length : 0,
    };
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

  ipcMain.handle('db:saveConfig', async (_event, newConfig: Partial<DatabaseConfig>) => {
    let isNet: boolean | undefined = undefined;
    if (newConfig.dbPath) {
      const res = await dbManager.connect(newConfig.dbPath);
      if (!res.success) {
        return { success: false, message: res.message };
      }
      isNet = newConfig.dbPath.startsWith('//') || newConfig.dbPath.startsWith('\\\\') || newConfig.dbPath.includes('/mnt/') || newConfig.dbPath.includes('smb') || newConfig.dbPath.includes('nfs');
    }
    const updated = store.setDbConfig({
      ...newConfig,
      ...(isNet !== undefined ? { isNetworkPath: isNet } : {}),
      isAccessible: true,
      lastConnected: new Date().toISOString(),
    });
    return { success: true, message: 'Настройки базы данных успешно сохранены', config: updated };
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
    const cfg = store.getDbConfig();
    const access = await dbManager.checkPathAccessibility(cfg.dbPath);
    const nowIso = new Date().toISOString();
    store.setDbConfig({
      isAccessible: access.accessible,
      lastConnected: nowIso,
    });
    logger.log('info', 'db', `Принудительное обновление базы данных SQLite выполнено (${nowIso})`);
    return { success: true, timestamp: nowIso, isAccessible: access.accessible };
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

  ipcMain.handle('dialog:selectDbFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку для размещения базы данных SQLite на сетевом или локальном диске',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:selectBackupFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку для сохранения резервных копий базы данных на сетевом или локальном диске',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:selectDocFile', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите конечный файл документа на сетевом или локальном диске',
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('dialog:selectDocFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку с документами на сетевом или локальном диске',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const folderPath = res.filePaths[0];
      return folderPath.endsWith('/') || folderPath.endsWith('\\') ? folderPath : `${folderPath}/`;
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
      const selected = res.filePaths[0];
      try {
        const stat = fs.statSync(selected);
        if (stat.isDirectory()) {
          return selected.endsWith('/') || selected.endsWith('\\') ? selected : `${selected}/`;
        }
      } catch {}
      return selected;
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
    let config = store.getDbConfig();
    if (!config.dbPath) {
      const defaultDbDir = path.join(app.getPath('userData'), 'database');
      try {
        if (!fs.existsSync(defaultDbDir)) {
          fs.mkdirSync(defaultDbDir, { recursive: true });
        }
      } catch {}
      const defaultPath = path.join(defaultDbDir, 'docflow.sqlite');
      config = store.setDbConfig({
        dbPath: defaultPath,
        isNetworkPath: false,
        isAccessible: true,
        lastConnected: new Date().toISOString(),
      });
    }

    if (config.dbPath) {
      try {
        await dbManager.connect(config.dbPath, config.busyTimeout);
        if (config.autoBackupOnStart) {
          await backupManager.createBackup(true);
        }
      } catch (err: any) {
        console.error('[Electron] Failed to connect DB at startup:', err);
        logger.log('warn', 'db', `Не удалось подключиться к БД при запуске: ${err.message}`);
      }
    }

    try {
      await createWindow();
    } catch (winErr: any) {
      console.error('[Electron] Fatal error creating window:', winErr);
    }

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
