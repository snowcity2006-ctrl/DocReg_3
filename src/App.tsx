import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  BookOpen,
  Plus,
  RefreshCw,
  Database,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  FolderSync,
  Archive,
  Terminal,
} from 'lucide-react';
import {
  DocumentRecord,
  Organization,
  Department,
  Employee,
  DocumentType,
  Direction,
  DbStatus,
  DocumentFilterState,
} from './types';
import { electronBridge } from './services/electronBridge';
import { useTheme } from './hooks/useTheme';
import { formatDbTimestamp, formatDbUpdateDateTime } from './utils/date';
import { Navbar } from './components/Navbar';
import { DbConfigModal } from './components/DbConfigModal';
import { LogsModal } from './components/LogsModal';
import { DocumentFilters } from './components/documents/DocumentFilters';
import { DocumentTable } from './components/documents/DocumentTable';
import { DocumentFormModal } from './components/documents/DocumentFormModal';
import { DocumentCardModal } from './components/documents/DocumentCardModal';
import { DirectoriesView } from './components/directories/DirectoriesView';
import { OrganizationModal } from './components/directories/OrganizationModal';
import { DepartmentModal } from './components/directories/DepartmentModal';
import { EmployeeModal } from './components/directories/EmployeeModal';
import { DocTypeModal } from './components/directories/DocTypeModal';
import { DirectionModal } from './components/directories/DirectionModal';

export default function App() {
  const { theme, setTheme } = useTheme();

  // Основная навигация: 'documents' или 'directories'
  const [activeTab, setActiveTab] = useState<'documents' | 'directories'>('documents');

  // Данные базы
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);

  // Фильтрация документов
  const [filters, setFilters] = useState<DocumentFilterState>({
    searchQuery: '',
    docTypeId: null,
    directionId: null,
    senderId: null,
    recipientId: null,
    dateType: 'all',
    dateFrom: '',
    dateTo: '',
    hasAttachment: null,
    hasSedLink: null,
  });

  // Модальные окна
  const [dbConfigOpen, setDbConfigOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentRecord | null>(null);
  const [viewingDoc, setViewingDoc] = useState<DocumentRecord | null>(null);

  // Быстрое добавление справочников из модалок
  const [quickOrgModalOpen, setQuickOrgModalOpen] = useState(false);
  const [quickDeptModalOpen, setQuickDeptModalOpen] = useState(false);
  const [quickDeptInitialOrgId, setQuickDeptInitialOrgId] = useState<number | undefined>(undefined);
  const [quickEmpModalOpen, setQuickEmpModalOpen] = useState(false);
  const [quickDocTypeModalOpen, setQuickDocTypeModalOpen] = useState(false);
  const [quickDirectionModalOpen, setQuickDirectionModalOpen] = useState(false);

  // Уведомления (Toasts)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Состояние ручного обновления базы данных и времени синхронизации
  const [isRefreshingDb, setIsRefreshingDb] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');

  // Загрузка всех данных
  const loadAllData = useCallback(async () => {
    try {
      const [status, orgs, depts, emps, types, dirs, docs] = await Promise.all([
        electronBridge.getDbStatus(),
        electronBridge.getOrganizations(),
        electronBridge.getDepartments(),
        electronBridge.getEmployees(),
        electronBridge.getDocumentTypes(),
        electronBridge.getDirections(),
        electronBridge.getDocuments(),
      ]);

      setDbStatus(status);
      setOrganizations(orgs);
      setDepartments(depts);
      setEmployees(emps);
      setDocumentTypes(types);
      setDirections(dirs);
      setDocuments(docs);
      if (status.lastUpdated) {
        setLastUpdateTime(formatDbUpdateDateTime(status.lastUpdated));
      }
    } catch (err: any) {
      console.error('Error loading data:', err);
      showNotification(`Ошибка загрузки данных: ${err.message}`, 'error');
    }
  }, []);

  // Ручное обновление базы данных по нажатию на кнопку в Navbar
  const handleManualRefresh = async () => {
    setIsRefreshingDb(true);
    try {
      // 1. Обновляем метку времени и регистрируем событие в базе данных SQLite
      const refreshRes = await electronBridge.refreshDb();

      // 2. Выполняем полную перезагрузку данных и статуса сетевого диска
      const [status, orgs, depts, emps, types, dirs, docs] = await Promise.all([
        electronBridge.getDbStatus(),
        electronBridge.getOrganizations(),
        electronBridge.getDepartments(),
        electronBridge.getEmployees(),
        electronBridge.getDocumentTypes(),
        electronBridge.getDirections(),
        electronBridge.getDocuments(),
      ]);

      const updatedTime = formatDbUpdateDateTime(refreshRes?.timestamp || status.lastUpdated || new Date());
      setLastUpdateTime(updatedTime);
      setDbStatus(status);
      setOrganizations(orgs);
      setDepartments(depts);
      setEmployees(emps);
      setDocumentTypes(types);
      setDirections(dirs);
      setDocuments(docs);

      // 3. Синхронизируем открытые карточки и формы
      if (viewingDoc) {
        const freshDoc = docs.find((d) => d.id === viewingDoc.id);
        if (freshDoc) setViewingDoc(freshDoc);
      }
      if (editingDoc) {
        const freshDoc = docs.find((d) => d.id === editingDoc.id);
        if (freshDoc) setEditingDoc(freshDoc);
      }

      showNotification(`База данных успешно обновлена (${updatedTime})`, 'success');
    } catch (err: any) {
      console.error('Ошибка обновления базы данных:', err);
      showNotification(`Ошибка обновления БД: ${err.message}`, 'error');
    } finally {
      setIsRefreshingDb(false);
    }
  };

  // Загрузка при старте
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Периодическое обновление статуса БД (каждые 30 секунд для проверки сетевого диска)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await electronBridge.getDbStatus();
        setDbStatus(status);
      } catch (e) {
        console.error(e);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Фильтрация документов на клиенте
  const filteredDocuments = documents.filter((doc) => {
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const matchSubject = doc.subject?.toLowerCase().includes(q);
      const matchOutNum = doc.outgoingNumber?.toLowerCase().includes(q);
      const matchInNum = doc.incomingNumber?.toLowerCase().includes(q);
      const matchComments = doc.comments?.toLowerCase().includes(q);
      const matchSender = doc.senderName?.toLowerCase().includes(q);
      const matchSenderDept = doc.senderDepartmentName?.toLowerCase().includes(q);
      const matchSenderEmp = doc.senderEmployeeName?.toLowerCase().includes(q);
      const matchSignatory = doc.signatoryEmployeeName?.toLowerCase().includes(q);
      const matchRecipient = doc.recipientName?.toLowerCase().includes(q);
      const matchRecipientDept = doc.recipientDepartmentNames?.toLowerCase().includes(q);
      const matchFile = doc.filePath?.toLowerCase().includes(q);
      const matchSed = doc.sedUrl?.toLowerCase().includes(q);
      const matchId = String(doc.id).includes(q);
      if (!(matchSubject || matchOutNum || matchInNum || matchComments || matchSender || matchSenderDept || matchSenderEmp || matchSignatory || matchRecipient || matchRecipientDept || matchFile || matchSed || matchId)) {
        return false;
      }
    }

    if (filters.docTypeId !== null && doc.docTypeId !== filters.docTypeId) {
      return false;
    }

    if (filters.directionId !== null && doc.directionId !== filters.directionId) {
      return false;
    }

    if (filters.senderId !== null && doc.senderId !== filters.senderId) {
      return false;
    }

    if (filters.recipientId !== null) {
      const isPrimary = doc.recipientId === filters.recipientId;
      const isInMulti = Array.isArray(doc.recipientIds) && doc.recipientIds.includes(filters.recipientId);
      if (!isPrimary && !isInMulti) {
        return false;
      }
    }

    if (filters.dateFrom) {
      const docDate = doc.incomingDate || doc.outgoingDate;
      if (!docDate || docDate < filters.dateFrom) return false;
    }

    if (filters.dateTo) {
      const docDate = doc.incomingDate || doc.outgoingDate;
      if (!docDate || docDate > filters.dateTo) return false;
    }

    if (filters.hasAttachment === true && !doc.filePath) {
      return false;
    }

    if (filters.hasSedLink === true && !doc.sedUrl) {
      return false;
    }

    return true;
  });

  // CRUD для документов
  const handleSaveDocument = async (docData: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }) => {
    try {
      const saved = await electronBridge.saveDocument(docData);
      showNotification(docData.id ? `Документ №${saved.id} успешно обновлен` : `Документ №${saved.id} успешно зарегистрирован`);
      setEditingDoc(null);
      await loadAllData();
    } catch (err: any) {
      showNotification(`Ошибка сохранения документа: ${err.message}`, 'error');
      throw err;
    }
  };

  const handleDeleteDocument = async (id: number) => {
    try {
      await electronBridge.deleteDocument(id);
      showNotification(`Документ №${id} удален`);
      await loadAllData();
    } catch (err: any) {
      showNotification(`Ошибка удаления: ${err.message}`, 'error');
      throw err;
    }
  };

  // CRUD для Справочников: Организации
  const handleSaveOrg = async (orgData: Omit<Organization, 'id'> & { id?: number }) => {
    const saved = await electronBridge.saveOrganization(orgData);
    showNotification(orgData.id ? `Организация «${saved.name}» обновлена` : `Организация «${saved.name}» добавлена`);
    await loadAllData();
  };

  const handleDeleteOrg = async (id: number) => {
    await electronBridge.deleteOrganization(id);
    showNotification('Организация удалена');
    await loadAllData();
  };

  // CRUD: Подразделения
  const handleSaveDept = async (deptData: Omit<Department, 'id'> & { id?: number }) => {
    const saved = await electronBridge.saveDepartment(deptData);
    showNotification(deptData.id ? `Подразделение «${saved.shortName}» обновлено` : `Подразделение «${saved.shortName}» добавлено`);
    await loadAllData();
  };

  const handleDeleteDept = async (id: number) => {
    await electronBridge.deleteDepartment(id);
    showNotification('Подразделение удалено');
    await loadAllData();
  };

  // CRUD: Сотрудники
  const handleSaveEmp = async (empData: Omit<Employee, 'id'> & { id?: number }) => {
    const saved = await electronBridge.saveEmployee(empData);
    showNotification(empData.id ? `Сотрудник «${saved.fullName}» обновлен` : `Сотрудник «${saved.fullName}» добавлен`);
    await loadAllData();
  };

  const handleDeleteEmp = async (id: number) => {
    await electronBridge.deleteEmployee(id);
    showNotification('Сотрудник удален');
    await loadAllData();
  };

  // CRUD: Типы документов
  const handleSaveDocType = async (typeData: Omit<DocumentType, 'id'> & { id?: number }) => {
    const saved = await electronBridge.saveDocumentType(typeData);
    showNotification(typeData.id ? `Тип документа «${saved.name}» обновлен` : `Тип документа «${saved.name}» добавлен`);
    await loadAllData();
  };

  const handleDeleteDocType = async (id: number) => {
    await electronBridge.deleteDocumentType(id);
    showNotification('Тип документа удален');
    await loadAllData();
  };

  // CRUD: Направления
  const handleSaveDir = async (dirData: Omit<Direction, 'id'> & { id?: number }) => {
    const saved = await electronBridge.saveDirection(dirData);
    showNotification(dirData.id ? `Направление «${saved.name}» обновлено` : `Направление «${saved.name}» добавлено`);
    await loadAllData();
  };

  const handleDeleteDir = async (id: number) => {
    await electronBridge.deleteDirection(id);
    showNotification('Направление удалено');
    await loadAllData();
  };

  // Резервное копирование
  const handleCreateBackup = async () => {
    try {
      const backupPath = await electronBridge.createBackup();
      showNotification(`Резервная копия успешно создана в: ${backupPath}`);
    } catch (e: any) {
      showNotification(`Ошибка создания бэкапа: ${e.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E0E0E0] flex flex-col font-sans transition-colors duration-200 antialiased">
      
      {/* Главная навигационная панель со статусом сетевой БД */}
      <Navbar
        dbStatus={dbStatus}
        theme={theme}
        onThemeChange={setTheme}
        onOpenDbConfig={() => setDbConfigOpen(true)}
        onOpenLogs={() => setLogsModalOpen(true)}
        onRefreshData={handleManualRefresh}
        onRefreshDb={handleManualRefresh}
        refreshing={isRefreshingDb}
        lastUpdateTime={lastUpdateTime || dbStatus?.lastUpdated}
        onCreateBackup={handleCreateBackup}
      />

      {/* Тост уведомлений */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold animate-in slide-in-from-bottom-5 fade-in duration-200 ${
            notification.type === 'error'
              ? 'bg-rose-950 text-rose-200 border-rose-900 shadow-rose-950/40'
              : notification.type === 'info'
              ? 'bg-[#171A21] text-[#E0E0E0] border-[#2D3139]'
              : 'bg-emerald-950 text-emerald-200 border-emerald-900 shadow-emerald-950/40'
          }`}
        >
          {notification.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Основной контент */}
      <main className="flex-1 max-w-[2000px] w-full mx-auto p-4 sm:p-6 space-y-5">
        
        {/* Панель переключения разделов и быстрая регистрация документа */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#171A21] p-3 rounded-2xl border border-[#2D3139] shadow-xs">
          
          <div className="flex items-center gap-1.5 bg-[#0F1115] p-1 rounded-xl border border-[#2D3139]">
            <button
              id="tab-nav-documents"
              onClick={() => setActiveTab('documents')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'documents'
                  ? 'bg-[#1F222B] text-blue-400 shadow-xs'
                  : 'text-gray-400 hover:text-[#E0E0E0]'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Документооборот</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-600/10 text-blue-400 border border-blue-500/20 font-mono">
                {documents.length}
              </span>
            </button>

            <button
              id="tab-nav-directories"
              onClick={() => setActiveTab('directories')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'directories'
                  ? 'bg-[#1F222B] text-blue-400 shadow-xs'
                  : 'text-gray-400 hover:text-[#E0E0E0]'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Справочники</span>
            </button>
          </div>

          {/* Кнопка регистрации нового документа */}
          <div className="flex items-center gap-2">
            <button
              id="btn-register-document"
              onClick={() => {
                setEditingDoc(null);
                setDocFormOpen(true);
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shadow-blue-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Регистрация документа</span>
            </button>
          </div>
        </div>

        {/* Раздел 1: Реестр документов */}
        {activeTab === 'documents' && (
          <div className="space-y-4">
            
            {/* Панель фильтров и поиска */}
            <DocumentFilters
              filters={filters}
              onChange={setFilters}
              documentTypes={documentTypes}
              directions={directions}
              organizations={organizations}
              totalCount={documents.length}
              filteredCount={filteredDocuments.length}
            />

            {/* Таблица документов */}
            <DocumentTable
              documents={filteredDocuments}
              onView={(doc) => setViewingDoc(doc)}
              onEdit={(doc) => {
                setEditingDoc(doc);
                setDocFormOpen(true);
              }}
              onDelete={handleDeleteDocument}
            />
          </div>
        )}

        {/* Раздел 2: Модуль справочников */}
        {activeTab === 'directories' && (
          <DirectoriesView
            organizations={organizations}
            departments={departments}
            employees={employees}
            documentTypes={documentTypes}
            directions={directions}
            onSaveOrg={handleSaveOrg}
            onDeleteOrg={handleDeleteOrg}
            onSaveDept={handleSaveDept}
            onDeleteDept={handleDeleteDept}
            onSaveEmp={handleSaveEmp}
            onDeleteEmp={handleDeleteEmp}
            onSaveDocType={handleSaveDocType}
            onDeleteDocType={handleDeleteDocType}
            onSaveDir={handleSaveDir}
            onDeleteDir={handleDeleteDir}
          />
        )}

      </main>

      {/* Подвал приложения */}
      <footer className="border-t border-[#2D3139] py-3 px-6 bg-[#171A21]/70 text-gray-400 text-xs">
        <div className="max-w-[2000px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#E0E0E0]">
              СЭД «Документооборот ОПР»
            </span>
            <span>•</span>
            <span className="font-mono text-[11px]">SQLite Network Share Edition</span>
            <span>•</span>
            <span className="text-blue-400 font-medium">
              Astra Linux 1.7 / 1.8 Ready
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span>Блокировка busy_timeout: <strong>5000 мс</strong></span>
            <span>•</span>
            <span>Режим журнала: <strong>DELETE (Network Safe)</strong></span>
          </div>
        </div>
      </footer>

      {/* Модальное окно настройки БД */}
      <DbConfigModal
        isOpen={dbConfigOpen}
        onClose={() => setDbConfigOpen(false)}
        onSaved={handleManualRefresh}
      />

      {/* Модальное окно журнала логов */}
      <LogsModal
        isOpen={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
      />

      {/* Модальное окно формы документа */}
      <DocumentFormModal
        isOpen={docFormOpen}
        onClose={() => {
          setDocFormOpen(false);
          setEditingDoc(null);
        }}
        onSave={handleSaveDocument}
        documentTypes={documentTypes}
        directions={directions}
        organizations={organizations}
        departments={departments}
        employees={employees}
        onOpenNewOrgModal={() => setQuickOrgModalOpen(true)}
        onOpenNewDepartmentModal={() => setQuickDeptModalOpen(true)}
        onOpenNewEmployeeModal={() => setQuickEmpModalOpen(true)}
        onOpenNewDocTypeModal={() => setQuickDocTypeModalOpen(true)}
        onOpenNewDirectionModal={() => setQuickDirectionModalOpen(true)}
        initialData={editingDoc}
      />

      {/* Модальное окно просмотра карточки документа */}
      <DocumentCardModal
        isOpen={!!viewingDoc}
        onClose={() => setViewingDoc(null)}
        document={viewingDoc}
        onEdit={(doc) => {
          setEditingDoc(doc);
          setDocFormOpen(true);
        }}
      />

      {/* Быстрое добавление организации из форм */}
      <OrganizationModal
        isOpen={quickOrgModalOpen}
        onClose={() => setQuickOrgModalOpen(false)}
        existingOrganizations={organizations}
        onSave={async (orgData) => {
          await handleSaveOrg(orgData);
          setQuickOrgModalOpen(false);
        }}
      />

      {/* Быстрое добавление структурного подразделения */}
      <DepartmentModal
        isOpen={quickDeptModalOpen}
        onClose={() => {
          setQuickDeptModalOpen(false);
          setQuickDeptInitialOrgId(undefined);
        }}
        organizations={organizations}
        existingDepartments={departments}
        defaultOrganizationId={quickDeptInitialOrgId}
        onOpenNewOrgModal={() => setQuickOrgModalOpen(true)}
        onSave={async (deptData) => {
          await handleSaveDept(deptData);
          setQuickDeptModalOpen(false);
          setQuickDeptInitialOrgId(undefined);
        }}
      />

      {/* Быстрое добавление сотрудника */}
      <EmployeeModal
        isOpen={quickEmpModalOpen}
        onClose={() => setQuickEmpModalOpen(false)}
        departments={departments}
        organizations={organizations}
        onOpenNewOrgModal={() => setQuickOrgModalOpen(true)}
        onOpenNewDepartmentModal={(orgId) => {
          setQuickDeptInitialOrgId(orgId);
          setQuickDeptModalOpen(true);
        }}
        onSave={async (empData) => {
          await handleSaveEmp(empData);
          setQuickEmpModalOpen(false);
        }}
      />

      {/* Быстрое добавление типа документа */}
      <DocTypeModal
        isOpen={quickDocTypeModalOpen}
        onClose={() => setQuickDocTypeModalOpen(false)}
        existingTypes={documentTypes}
        onSave={async (typeData) => {
          await handleSaveDocType(typeData);
          setQuickDocTypeModalOpen(false);
        }}
      />

      {/* Быстрое добавление направления */}
      <DirectionModal
        isOpen={quickDirectionModalOpen}
        onClose={() => setQuickDirectionModalOpen(false)}
        existingDirections={directions}
        onSave={async (dirData) => {
          await handleSaveDir(dirData);
          setQuickDirectionModalOpen(false);
        }}
      />

    </div>
  );
}
