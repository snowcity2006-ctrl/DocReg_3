import React, { useState, useEffect } from 'react';
import {
  Database,
  Folder,
  CheckCircle,
  AlertCircle,
  Clock,
  Shield,
  RefreshCw,
  HardDrive,
  X,
  Sliders,
  Check,
} from 'lucide-react';
import { DatabaseConfig } from '../types';
import { electronBridge } from '../services/electronBridge';

interface DbConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: (config: DatabaseConfig) => void;
  onSaved?: () => void;
  isFirstLaunch?: boolean;
}

export const DbConfigModal: React.FC<DbConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
  onSaved,
  isFirstLaunch = false,
}) => {
  const [dbPath, setDbPath] = useState('');
  const [busyTimeout, setBusyTimeout] = useState(5000);
  const [autoBackup, setAutoBackup] = useState(true);
  const [backupFolder, setBackupFolder] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; pingMs?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const cfg = await electronBridge.getDbConfig();
      setDbPath(cfg.dbPath || '');
      setBusyTimeout(cfg.busyTimeout || 5000);
      setAutoBackup(cfg.autoBackupOnStart ?? true);
      setBackupFolder(cfg.backupFolder || '');
      setTestResult(null);
      setError(null);
    } catch (err: any) {
      setError(`Ошибка загрузки конфигурации: ${err.message}`);
    }
  };

  const handleSelectFile = async () => {
    try {
      const selected = await electronBridge.selectDatabaseFile();
      if (selected) {
        setDbPath(selected);
        setTestResult(null);
        setError(null);
      }
    } catch (err: any) {
      setError(`Ошибка диалога выбора файла: ${err.message}`);
    }
  };

  const handleTestConnection = async () => {
    if (!dbPath.trim()) {
      setError('Укажите путь к файлу базы данных .sqlite');
      return;
    }
    setTesting(true);
    setError(null);
    try {
      const res = await electronBridge.testDbConnection(dbPath.trim());
      setTestResult(res);
      if (!res.success) {
        setError(res.message);
      }
    } catch (err: any) {
      setError(`Ошибка тестирования: ${err.message}`);
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!dbPath.trim()) {
      setError('Путь к файлу базы данных обязателен для заполнения');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await electronBridge.setDbPath(dbPath.trim());
      if (res.success) {
        if (res.config && onConfigSaved) {
          onConfigSaved(res.config);
        }
        if (onSaved) {
          onSaved();
        }
        onClose();
      } else {
        setError(res.message || 'Не удалось сохранить путь к базе данных');
      }
    } catch (err: any) {
      setError(`Ошибка сохранения: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Заголовок */}
        <div className="px-6 py-4 border-b border-[#2D3139] flex items-center justify-between bg-[#12151B]/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-950/80 text-blue-400 flex items-center justify-center border border-blue-900/60">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E0E0E0]">
                {isFirstLaunch ? 'Первоначальная настройка сетевой базы данных' : 'Настройка подключения к БД SQLite'}
              </h2>
              <p className="text-xs text-gray-400">
                Сетевой диск SMB / NFS для одновременной работы 6–10 пользователей
              </p>
            </div>
          </div>

          {!isFirstLaunch && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#1F222B] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Тело формы */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {error && (
            <div className="p-3.5 bg-rose-950/50 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Внимание</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Путь к базе данных */}
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Путь к файлу базы данных (.sqlite) на сетевом диске <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={dbPath}
                  onChange={(e) => {
                    setDbPath(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="/mnt/network_share/docflow/company_docs.sqlite или \\server\share\db.sqlite"
                  className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-[#E0E0E0] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleSelectFile}
                className="px-3.5 py-2.5 bg-[#0F1115] hover:bg-[#1F222B] text-gray-300 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors border border-[#2D3139] cursor-pointer"
                title="Выбрать файл через проводник ОС"
              >
                <Folder className="w-4 h-4 text-blue-400" />
                <span>Обзор</span>
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Если указанный файл не существует по заданному пути, программа автоматически создаст его и инициализирует структуру таблиц.
            </p>
          </div>

          {/* Параметры сетевой многопользовательской блокировки */}
          <div className="p-4 bg-[#0F1115]/60 rounded-xl border border-[#2D3139] space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E0E0E0]">
              <Sliders className="w-4 h-4 text-blue-400" />
              <span>Параметры параллельного доступа (SQLite Multi-user)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-gray-400 mb-1">
                  Таймаут блокировки (busy_timeout):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1000}
                    max={10000}
                    step={500}
                    value={busyTimeout}
                    onChange={(e) => setBusyTimeout(Number(e.target.value))}
                    className="w-24 px-2.5 py-1.5 bg-[#0F1115] border border-[#2D3139] rounded-lg font-mono text-xs text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-gray-400">мс (3000–5000 мс)</span>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">
                  Режим журнала (Journal Mode):
                </label>
                <div className="px-2.5 py-1.5 bg-[#0F1115] border border-[#2D3139] rounded-lg text-xs font-mono text-gray-300">
                  DELETE / TRUNCATE (WAL отключен)
                </div>
              </div>
            </div>

            <p className="text-[11px] text-amber-300 bg-amber-950/40 p-2.5 rounded-lg border border-amber-900/60 leading-relaxed">
              <strong>Требование ТЗ:</strong> WAL-режим отключен, так как база расположена на сетевом накопителе (NFS/SMB), где разделяемая память (.shm) не поддерживается. Режим DELETE + busy_timeout={busyTimeout}мс гарантирует целостность данных при одновременной работе 6–10 пользователей.
            </p>
          </div>

          {/* Автобэкап при старте */}
          <div className="flex items-center justify-between p-3.5 bg-[#0F1115]/60 rounded-xl border border-[#2D3139]">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-[#E0E0E0]">
                  Автоматический бэкап при запуске
                </p>
                <p className="text-[11px] text-gray-400">
                  Создает копию .sqlite в подкаталог /backup перед началом работы
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoBackup}
                onChange={(e) => setAutoBackup(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#2D3139] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Результат проверки подключения */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-900/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-900/60 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div className="space-y-0.5">
                <p className="font-semibold">{testResult.success ? 'Сетевой путь доступен' : 'Ошибка соединения'}</p>
                <p>{testResult.message}</p>
                {testResult.pingMs !== undefined && (
                  <p className="font-mono text-[11px] opacity-80">Задержка сети: {testResult.pingMs} мс</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Нижняя панель действий */}
        <div className="px-6 py-4 border-t border-[#2D3139] bg-[#12151B]/60 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !dbPath.trim()}
            className="px-4 py-2 bg-[#0F1115] border border-[#2D3139] hover:bg-[#1F222B] text-gray-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-blue-400' : ''}`} />
            <span>{testing ? 'Проверка...' : 'Проверить доступность'}</span>
          </button>

          <div className="flex items-center gap-2">
            {!isFirstLaunch && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-[#1F222B] transition-colors cursor-pointer"
              >
                Отмена
              </button>
            )}
            <button
              id="btn-save-db-config"
              type="button"
              onClick={handleSave}
              disabled={saving || !dbPath.trim()}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs shadow-blue-500/30 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Сохранение...' : 'Сохранить и подключиться'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
