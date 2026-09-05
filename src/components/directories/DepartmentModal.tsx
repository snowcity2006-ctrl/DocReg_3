import React, { useState, useEffect } from 'react';
import { Network, X, Check, AlertCircle, Plus } from 'lucide-react';
import { Department, Organization } from '../../types';

interface DepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dept: Omit<Department, 'id'> & { id?: number }) => Promise<void>;
  organizations: Organization[];
  onOpenNewOrgModal: () => void;
  initialData?: Department | null;
}

export const DepartmentModal: React.FC<DepartmentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  organizations,
  onOpenNewOrgModal,
  initialData,
}) => {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [organizationId, setOrganizationId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setShortName(initialData.shortName || '');
      setOrganizationId(initialData.organizationId || '');
    } else {
      setName('');
      setShortName('');
      setOrganizationId(organizations.length > 0 ? organizations[0].id : '');
    }
    setError(null);
  }, [initialData, isOpen, organizations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Поле «Структурное подразделение» обязательно для заполнения');
      return;
    }
    if (!shortName.trim()) {
      setError('Поле «Сокращенное название СП» обязательно для заполнения');
      return;
    }
    if (!organizationId) {
      setError('Поле «Организация» обязательно для заполнения');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: initialData ? initialData.id : undefined,
        name: name.trim(),
        shortName: shortName.trim().toUpperCase(),
        organizationId: Number(organizationId),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения структурного подразделения');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-lg overflow-hidden flex flex-col">
        
        {/* Заголовок */}
        <div className="px-6 py-4 border-b border-[#2D3139] flex items-center justify-between bg-[#12151B]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-950/80 text-blue-400 flex items-center justify-center border border-blue-900/60">
              <Network className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-[#E0E0E0]">
              {initialData ? 'Редактирование подразделения' : 'Новое структурное подразделение'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#1F222B] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Форма */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-950/50 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {initialData && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">
                ID записи
              </label>
              <input
                type="text"
                disabled
                value={initialData.id}
                className="w-24 px-3 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-gray-500 cursor-not-allowed"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Структурное подразделение <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Отдел информационной безопасности"
              className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Сокращенное название СП <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="Например: ОИБ"
              className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold uppercase"
            />
          </div>

          {/* Организация с иконкой '+' справа по ТЗ */}
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Организация <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                required
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value ? Number(e.target.value) : '')}
                className="flex-1 px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="" className="bg-[#171A21] text-gray-400">-- Выберите организацию --</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id} className="bg-[#171A21] text-[#E0E0E0]">
                    {org.name}
                  </option>
                ))}
              </select>

              {/* Иконка «+» справа от поля для добавления новой организации по ТЗ */}
              <button
                type="button"
                onClick={onOpenNewOrgModal}
                title="Добавить новую организацию в справочник"
                className="p-2.5 bg-blue-950/80 hover:bg-blue-900 text-blue-400 rounded-xl border border-blue-800 transition-colors cursor-pointer flex items-center justify-center shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#2D3139] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-[#1F222B] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs shadow-blue-500/30 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Сохранение...' : 'Сохранить'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
