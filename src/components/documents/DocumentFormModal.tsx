import React, { useState, useEffect } from 'react';
import {
  FileText,
  Calendar,
  FolderOpen,
  Globe,
  Building2,
  Tag,
  Compass,
  X,
  Check,
  AlertCircle,
  Plus,
  Paperclip,
} from 'lucide-react';
import {
  DocumentRecord,
  DocumentType,
  Direction,
  Organization,
} from '../../types';
import { electronBridge } from '../../services/electronBridge';

interface DocumentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }) => Promise<void>;
  documentTypes: DocumentType[];
  directions: Direction[];
  organizations: Organization[];
  onOpenNewOrgModal: () => void;
  initialData?: DocumentRecord | null;
}

export const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  documentTypes,
  directions,
  organizations,
  onOpenNewOrgModal,
  initialData,
}) => {
  const [docTypeId, setDocTypeId] = useState<number | ''>('');
  const [directionId, setDirectionId] = useState<number | ''>('');
  const [outgoingNumber, setOutgoingNumber] = useState('');
  const [outgoingDate, setOutgoingDate] = useState('');
  const [incomingNumber, setIncomingNumber] = useState('');
  const [incomingDate, setIncomingDate] = useState('');
  const [subject, setSubject] = useState('');
  const [senderId, setSenderId] = useState<number | ''>('');
  const [recipientId, setRecipientId] = useState<number | ''>('');
  const [filePath, setFilePath] = useState('');
  const [sedUrl, setSedUrl] = useState('');
  const [comments, setComments] = useState('');
  
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialData) {
      setDocTypeId(initialData.docTypeId || '');
      setDirectionId(initialData.directionId || '');
      setOutgoingNumber(initialData.outgoingNumber || '');
      setOutgoingDate(initialData.outgoingDate || '');
      setIncomingNumber(initialData.incomingNumber || '');
      setIncomingDate(initialData.incomingDate || '');
      setSubject(initialData.subject || '');
      setSenderId(initialData.senderId || '');
      setRecipientId(initialData.recipientId || '');
      setFilePath(initialData.filePath || '');
      setSedUrl(initialData.sedUrl || '');
      setComments(initialData.comments || '');
    } else {
      setDocTypeId(documentTypes.length > 0 ? documentTypes[0].id : '');
      setDirectionId(directions.length > 0 ? directions[0].id : '');
      setOutgoingNumber('');
      setOutgoingDate('');
      setIncomingNumber('');
      setIncomingDate(new Date().toISOString().slice(0, 10)); // Текущая дата по умолчанию
      setSubject('');
      setSenderId('');
      setRecipientId('');
      setFilePath('');
      setSedUrl('');
      setComments('');
    }
    setError(null);
  }, [initialData, isOpen, documentTypes, directions]);

  const handleBrowseFile = async () => {
    try {
      const selected = await electronBridge.selectDocumentFileOrFolder();
      if (selected) {
        setFilePath(selected);
      }
    } catch (e: any) {
      setError(`Ошибка выбора файла: ${e.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Валидация обязательных полей по ТЗ
    if (!docTypeId) {
      setError('Поле «Тип документа» обязательно для заполнения');
      return;
    }
    if (!directionId) {
      setError('Поле «Направление» обязательно для заполнения');
      return;
    }
    if (!subject.trim()) {
      setError('Поле «Тема» обязательно для заполнения');
      return;
    }

    if (sedUrl.trim() && !/^https?:\/\//i.test(sedUrl.trim()) && !sedUrl.trim().startsWith('http')) {
      // Автодобавление https:// если протокол не указан
      setSedUrl(`https://${sedUrl.trim()}`);
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: initialData ? initialData.id : undefined,
        docTypeId: Number(docTypeId),
        directionId: Number(directionId),
        outgoingNumber: outgoingNumber.trim() || undefined,
        outgoingDate: outgoingDate.trim() || undefined,
        incomingNumber: incomingNumber.trim() || undefined,
        incomingDate: incomingDate.trim() || undefined,
        subject: subject.trim(),
        senderId: senderId ? Number(senderId) : undefined,
        recipientId: recipientId ? Number(recipientId) : undefined,
        filePath: filePath.trim() || undefined,
        sedUrl: sedUrl.trim() || undefined,
        comments: comments.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения документа');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] text-[#E0E0E0]">
        
        {/* Заголовок формы */}
        <div className="px-6 py-4 border-b border-[#2D3139] flex items-center justify-between bg-[#1F222B] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {initialData ? `Редактирование карточки документа №${initialData.id}` : 'Регистрация нового документа'}
              </h3>
              <p className="text-xs text-gray-400">
                Символом <span className="text-rose-400 font-bold">*</span> обозначены обязательные для заполнения поля
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#2D3139] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Тело формы с полосой прокрутки */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
          
          {error && (
            <div className="p-3.5 bg-rose-950/50 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Блок классификации: Тип документа и Направление */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-blue-400" />
                <span>Тип документа <span className="text-rose-400 font-bold">*</span></span>
              </label>
              <select
                required
                value={docTypeId}
                onChange={(e) => setDocTypeId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="">-- Выберите тип документа --</option>
                {documentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-blue-400" />
                <span>Направление <span className="text-rose-400 font-bold">*</span></span>
              </label>
              <select
                required
                value={directionId}
                onChange={(e) => setDirectionId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="">-- Выберите направление --</option>
                {directions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Блок номеров и дат: Исходящие и Входящие с календарем */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-[#0F1115] rounded-xl border border-[#2D3139]">
            <div>
              <label className="block font-semibold text-gray-300 mb-1">
                Исх. №
              </label>
              <input
                type="text"
                value={outgoingNumber}
                onChange={(e) => setOutgoingNumber(e.target.value)}
                placeholder="Например: ИСХ-102/26"
                className="w-full px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <span>Исх. дата</span>
              </label>
              <input
                type="date"
                value={outgoingDate}
                onChange={(e) => setOutgoingDate(e.target.value)}
                className="w-full px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1">
                Вх. №
              </label>
              <input
                type="text"
                value={incomingNumber}
                onChange={(e) => setIncomingNumber(e.target.value)}
                placeholder="Например: ВХ-00452"
                className="w-full px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <span>Вх. дата</span>
              </label>
              <input
                type="date"
                value={incomingDate}
                onChange={(e) => setIncomingDate(e.target.value)}
                className="w-full px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 3. Тема документа */}
          <div>
            <label className="block font-semibold text-gray-300 mb-1.5">
              Тема (краткое содержание) <span className="text-rose-400 font-bold">*</span>
            </label>
            <textarea
              required
              rows={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Опишите краткое содержание или предмет документа..."
              className="w-full px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 4. Отправитель и Получатель (с кнопкой быстрого добавления организации '+') */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Отправитель</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Выберите отправителя --</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewOrgModal}
                  title="Добавить новую организацию"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Получатель</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Выберите получателя --</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewOrgModal}
                  title="Добавить новую организацию"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 5. Путь к файлу/папке и ссылка на СЭД */}
          <div className="space-y-3">
            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                <span>Путь к документу (гиперссылка на сетевую папку или файл)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/mnt/network_share/documents/2026/09/doc.pdf или \\server\share\file.docx"
                  className="flex-1 px-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleBrowseFile}
                  title="Выбрать файл или папку через проводник ОС"
                  className="px-3.5 py-2 bg-[#0F1115] hover:bg-[#1F222B] text-gray-300 hover:text-white rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors border border-[#2D3139] cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5 text-blue-400" />
                  <span>Обзор</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                <span>Путь к документу в СЭД (гиперссылка в формате интернет браузера)</span>
              </label>
              <input
                type="url"
                value={sedUrl}
                onChange={(e) => setSedUrl(e.target.value)}
                placeholder="https://sed.company.local/documents/card/12345"
                className="w-full px-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 6. Дополнительные примечания */}
          <div>
            <label className="block font-semibold text-gray-300 mb-1">
              Примечания и комментарии
            </label>
            <input
              type="text"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Дополнительные сведения, резолюция, ответственный исполнитель..."
              className="w-full px-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Футер формы с кнопкой Сохранить */}
          <div className="pt-4 border-t border-[#2D3139] flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-[#1F222B] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              id="btn-save-document"
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
