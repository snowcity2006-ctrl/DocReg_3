import React, { useState } from 'react';
import {
  Building2,
  Network,
  UserCheck,
  Tag,
  Compass,
  Plus,
  Edit2,
  Trash2,
  Search,
  AlertTriangle,
  Mail,
  User,
  Info,
} from 'lucide-react';
import {
  Organization,
  Department,
  Employee,
  DocumentType,
  Direction,
} from '../../types';
import { OrganizationModal } from './OrganizationModal';
import { DepartmentModal } from './DepartmentModal';
import { EmployeeModal } from './EmployeeModal';
import { DocTypeModal } from './DocTypeModal';
import { DirectionModal } from './DirectionModal';

interface DirectoriesViewProps {
  organizations: Organization[];
  departments: Department[];
  employees: Employee[];
  documentTypes: DocumentType[];
  directions: Direction[];
  onSaveOrg: (org: Omit<Organization, 'id'> & { id?: number }) => Promise<void>;
  onDeleteOrg: (id: number) => Promise<void>;
  onSaveDept: (dept: Omit<Department, 'id'> & { id?: number }) => Promise<void>;
  onDeleteDept: (id: number) => Promise<void>;
  onSaveEmp: (emp: Omit<Employee, 'id'> & { id?: number }) => Promise<void>;
  onDeleteEmp: (id: number) => Promise<void>;
  onSaveDocType: (type: Omit<DocumentType, 'id'> & { id?: number }) => Promise<void>;
  onDeleteDocType: (id: number) => Promise<void>;
  onSaveDir: (dir: Omit<Direction, 'id'> & { id?: number }) => Promise<void>;
  onDeleteDir: (id: number) => Promise<void>;
}

type DirectoryTab = 'orgs' | 'depts' | 'emps' | 'docTypes' | 'directions';

export const DirectoriesView: React.FC<DirectoriesViewProps> = ({
  organizations,
  departments,
  employees,
  documentTypes,
  directions,
  onSaveOrg,
  onDeleteOrg,
  onSaveDept,
  onDeleteDept,
  onSaveEmp,
  onDeleteEmp,
  onSaveDocType,
  onDeleteDocType,
  onSaveDir,
  onDeleteDir,
}) => {
  const [activeTab, setActiveTab] = useState<DirectoryTab>('orgs');
  const [searchQuery, setSearchQuery] = useState('');

  // Состояния модалок
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);

  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);

  const [docTypeModalOpen, setDocTypeModalOpen] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<DocumentType | null>(null);

  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [selectedDir, setSelectedDir] = useState<Direction | null>(null);

  // Состояние модалки подтверждения удаления
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: async () => {},
  });

  const [deleting, setDeleting] = useState(false);

  // Фильтрованные списки
  const q = searchQuery.toLowerCase().trim();

  const filteredOrgs = organizations.filter(
    (o) =>
      o.name.toLowerCase().includes(q) ||
      (o.director && o.director.toLowerCase().includes(q)) ||
      (o.email && o.email.toLowerCase().includes(q)) ||
      String(o.id).includes(q)
  );

  const filteredDepts = departments.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.shortName.toLowerCase().includes(q) ||
      (d.organizationName && d.organizationName.toLowerCase().includes(q)) ||
      String(d.id).includes(q)
  );

  const filteredEmps = employees.filter(
    (e) =>
      e.fullName.toLowerCase().includes(q) ||
      e.departmentShortName.toLowerCase().includes(q) ||
      (e.organizationName && e.organizationName.toLowerCase().includes(q)) ||
      String(e.id).includes(q)
  );

  const filteredDocTypes = documentTypes.filter(
    (t) => t.name.toLowerCase().includes(q) || String(t.id).includes(q)
  );

  const filteredDirs = directions.filter(
    (d) => d.name.toLowerCase().includes(q) || String(d.id).includes(q)
  );

  // Подтверждение удаления
  const confirmDelete = (title: string, description: string, onConfirm: () => Promise<void>) => {
    setDeleteDialog({
      isOpen: true,
      title,
      description,
      onConfirm,
    });
  };

  const handleExecuteDelete = async () => {
    setDeleting(true);
    try {
      await deleteDialog.onConfirm();
      setDeleteDialog((prev) => ({ ...prev, isOpen: false }));
    } catch (e: any) {
      alert(e.message || 'Ошибка удаления');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Шапка справочников и выбор вкладок */}
      <div className="bg-[#171A21] rounded-2xl p-4 sm:p-5 border border-[#2D3139] shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#E0E0E0] flex items-center gap-2">
              <span>Справочники системы</span>
            </h2>
            <p className="text-xs text-gray-400">
              Управление нормативно-справочной информацией документооборота
            </p>
          </div>

          {/* Строка поиска */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по справочнику..."
              className="w-full pl-9 pr-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Табы справочников */}
        <div className="flex flex-wrap gap-2 border-t border-[#2D3139] pt-3">
          
          <button
            onClick={() => setActiveTab('orgs')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'orgs'
                ? 'bg-blue-600 text-white shadow-xs shadow-blue-500/20'
                : 'bg-[#0F1115] text-gray-300 hover:bg-[#1F222B] border border-[#2D3139]'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Организации</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'orgs' ? 'bg-blue-700 text-white' : 'bg-[#1F222B] text-gray-400'
            }`}>
              {organizations.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('depts')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'depts'
                ? 'bg-blue-600 text-white shadow-xs shadow-blue-500/20'
                : 'bg-[#0F1115] text-gray-300 hover:bg-[#1F222B] border border-[#2D3139]'
            }`}
          >
            <Network className="w-4 h-4" />
            <span>Структурные подразделения</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'depts' ? 'bg-blue-700 text-white' : 'bg-[#1F222B] text-gray-400'
            }`}>
              {departments.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('emps')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'emps'
                ? 'bg-blue-600 text-white shadow-xs shadow-blue-500/20'
                : 'bg-[#0F1115] text-gray-300 hover:bg-[#1F222B] border border-[#2D3139]'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Сотрудники</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'emps' ? 'bg-blue-700 text-white' : 'bg-[#1F222B] text-gray-400'
            }`}>
              {employees.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('docTypes')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'docTypes'
                ? 'bg-blue-600 text-white shadow-xs shadow-blue-500/20'
                : 'bg-[#0F1115] text-gray-300 hover:bg-[#1F222B] border border-[#2D3139]'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>Типы документов</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'docTypes' ? 'bg-blue-700 text-white' : 'bg-[#1F222B] text-gray-400'
            }`}>
              {documentTypes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('directions')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'directions'
                ? 'bg-blue-600 text-white shadow-xs shadow-blue-500/20'
                : 'bg-[#0F1115] text-gray-300 hover:bg-[#1F222B] border border-[#2D3139]'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>Направления</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === 'directions' ? 'bg-blue-700 text-white' : 'bg-[#1F222B] text-gray-400'
            }`}>
              {directions.length}
            </span>
          </button>

        </div>
      </div>

      {/* 1. Справочник: Организации */}
      {activeTab === 'orgs' && (
        <div className="bg-[#171A21] rounded-2xl border border-[#2D3139] shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#2D3139] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-[#E0E0E0]">
                Справочник «Организации» ({filteredOrgs.length})
              </h3>
            </div>
            <button
              id="btn-add-organization"
              onClick={() => {
                setSelectedOrg(null);
                setOrgModalOpen(true);
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить организацию</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2D3139] bg-[#0F1115]/60 text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-16">ID</th>
                  <th className="py-3 px-4">Организация *</th>
                  <th className="py-3 px-4">Руководитель</th>
                  <th className="py-3 px-4">e-mail</th>
                  <th className="py-3 px-4 w-28 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
                {filteredOrgs.map((org) => (
                  <tr key={org.id} className="hover:bg-[#1F222B]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-gray-500">{org.id}</td>
                    <td className="py-3 px-4 font-semibold text-[#E0E0E0]">{org.name}</td>
                    <td className="py-3 px-4 text-gray-300">
                      {org.director ? (
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          {org.director}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-300 font-mono">
                      {org.email ? (
                        <span className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-blue-400" />
                          <a href={`mailto:${org.email}`} className="text-blue-400 hover:underline">
                            {org.email}
                          </a>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setSelectedOrg(org);
                            setOrgModalOpen(true);
                          }}
                          title="Редактировать запись"
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            confirmDelete(
                              'Удаление организации',
                              `Вы действительно хотите удалить организацию «${org.name}»? Действие нельзя отменить.`,
                              () => onDeleteOrg(org.id)
                            )
                          }
                          title="Удалить запись"
                          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredOrgs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      Организации не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Справочник: Структурное подразделение */}
      {activeTab === 'depts' && (
        <div className="bg-[#171A21] rounded-2xl border border-[#2D3139] shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#2D3139] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-[#E0E0E0]">
                Справочник «Структурное подразделение» ({filteredDepts.length})
              </h3>
            </div>
            <button
              id="btn-add-department"
              onClick={() => {
                setSelectedDept(null);
                setDeptModalOpen(true);
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить подразделение</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2D3139] bg-[#0F1115]/60 text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-16">ID</th>
                  <th className="py-3 px-4">Структурное подразделение *</th>
                  <th className="py-3 px-4 w-40">Сокращенное название СП *</th>
                  <th className="py-3 px-4">Организация *</th>
                  <th className="py-3 px-4 w-28 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
                {filteredDepts.map((dept) => (
                  <tr key={dept.id} className="hover:bg-[#1F222B]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-gray-500">{dept.id}</td>
                    <td className="py-3 px-4 font-semibold text-[#E0E0E0]">{dept.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-blue-600/10 text-blue-400 font-mono font-bold border border-blue-500/20">
                        {dept.shortName}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-300">
                      {dept.organizationName || '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setSelectedDept(dept);
                            setDeptModalOpen(true);
                          }}
                          title="Редактировать запись"
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            confirmDelete(
                              'Удаление подразделения',
                              `Вы действительно хотите удалить подразделение «${dept.name}» (${dept.shortName})?`,
                              () => onDeleteDept(dept.id)
                            )
                          }
                          title="Удалить запись"
                          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDepts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      Подразделения не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Справочник: Сотрудники */}
      {activeTab === 'emps' && (
        <div className="bg-[#171A21] rounded-2xl border border-[#2D3139] shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#2D3139] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-[#E0E0E0]">
                Справочник «Сотрудники» ({filteredEmps.length})
              </h3>
            </div>
            <button
              id="btn-add-employee"
              onClick={() => {
                setSelectedEmp(null);
                setEmpModalOpen(true);
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить сотрудника</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2D3139] bg-[#0F1115]/60 text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-16">ID</th>
                  <th className="py-3 px-4">Сотрудник (ФИО) *</th>
                  <th className="py-3 px-4">Структурное подразделение (СП) *</th>
                  <th className="py-3 px-4">Организация *</th>
                  <th className="py-3 px-4 w-28 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
                {filteredEmps.map((emp) => (
                  <tr key={emp.id} className="hover:bg-[#1F222B]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-gray-500">{emp.id}</td>
                    <td className="py-3 px-4 font-semibold text-[#E0E0E0]">{emp.fullName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-[#0F1115] text-[#E0E0E0] font-mono font-medium border border-[#2D3139]">
                        {emp.departmentShortName}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-300">
                      {emp.organizationName || '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setSelectedEmp(emp);
                            setEmpModalOpen(true);
                          }}
                          title="Редактировать запись"
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            confirmDelete(
                              'Удаление сотрудника',
                              `Вы действительно хотите удалить сотрудника «${emp.fullName}»?`,
                              () => onDeleteEmp(emp.id)
                            )
                          }
                          title="Удалить запись"
                          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredEmps.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      Сотрудники не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Справочник: Тип документа */}
      {activeTab === 'docTypes' && (
        <div className="bg-[#171A21] rounded-2xl border border-[#2D3139] shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#2D3139] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-[#E0E0E0]">
                Справочник «Тип документа» ({filteredDocTypes.length})
              </h3>
            </div>
            <button
              id="btn-add-doc-type"
              onClick={() => {
                setSelectedDocType(null);
                setDocTypeModalOpen(true);
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить тип</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2D3139] bg-[#0F1115]/60 text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-16">ID</th>
                  <th className="py-3 px-4">Тип документа *</th>
                  <th className="py-3 px-4 w-28 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
                {filteredDocTypes.map((type) => (
                  <tr key={type.id} className="hover:bg-[#1F222B]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-gray-500">{type.id}</td>
                    <td className="py-3 px-4 font-semibold text-[#E0E0E0]">{type.name}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setSelectedDocType(type);
                            setDocTypeModalOpen(true);
                          }}
                          title="Редактировать запись"
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            confirmDelete(
                              'Удаление типа документа',
                              `Вы действительно хотите удалить тип «${type.name}»?`,
                              () => onDeleteDocType(type.id)
                            )
                          }
                          title="Удалить запись"
                          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDocTypes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-gray-500">
                      Типы документов не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Справочник: Направление */}
      {activeTab === 'directions' && (
        <div className="bg-[#171A21] rounded-2xl border border-[#2D3139] shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#2D3139] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-[#E0E0E0]">
                Справочник «Направление» ({filteredDirs.length})
              </h3>
            </div>
            <button
              id="btn-add-direction"
              onClick={() => {
                setSelectedDir(null);
                setDirModalOpen(true);
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-blue-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить направление</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2D3139] bg-[#0F1115]/60 text-gray-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-16">ID</th>
                  <th className="py-3 px-4">Направление *</th>
                  <th className="py-3 px-4 w-28 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
                {filteredDirs.map((dir) => (
                  <tr key={dir.id} className="hover:bg-[#1F222B]/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-gray-500">{dir.id}</td>
                    <td className="py-3 px-4 font-semibold text-[#E0E0E0]">{dir.name}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setSelectedDir(dir);
                            setDirModalOpen(true);
                          }}
                          title="Редактировать запись"
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            confirmDelete(
                              'Удаление направления',
                              `Вы действительно хотите удалить направление «${dir.name}»?`,
                              () => onDeleteDir(dir.id)
                            )
                          }
                          title="Удалить запись"
                          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDirs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-gray-500">
                      Направления не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Модалки создания/редактирования */}
      <OrganizationModal
        isOpen={orgModalOpen}
        onClose={() => setOrgModalOpen(false)}
        onSave={onSaveOrg}
        initialData={selectedOrg}
      />

      <DepartmentModal
        isOpen={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        onSave={onSaveDept}
        organizations={organizations}
        onOpenNewOrgModal={() => {
          setSelectedOrg(null);
          setOrgModalOpen(true);
        }}
        initialData={selectedDept}
      />

      <EmployeeModal
        isOpen={empModalOpen}
        onClose={() => setEmpModalOpen(false)}
        onSave={onSaveEmp}
        departments={departments}
        organizations={organizations}
        onOpenNewOrgModal={() => {
          setSelectedOrg(null);
          setOrgModalOpen(true);
        }}
        initialData={selectedEmp}
      />

      <DocTypeModal
        isOpen={docTypeModalOpen}
        onClose={() => setDocTypeModalOpen(false)}
        onSave={onSaveDocType}
        initialData={selectedDocType}
        existingTypes={documentTypes}
      />

      <DirectionModal
        isOpen={dirModalOpen}
        onClose={() => setDirModalOpen(false)}
        onSave={onSaveDir}
        initialData={selectedDir}
        existingDirections={directions}
      />

      {/* Диалог подтверждения удаления */}
      {deleteDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-md overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 text-rose-400 flex items-center justify-center border border-rose-900">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#E0E0E0]">
                  {deleteDialog.title}
                </h4>
                <p className="text-xs text-gray-400">
                  Подтверждение удаления
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              {deleteDialog.description}
            </p>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-[#1F222B] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                disabled={deleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs shadow-rose-500/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
