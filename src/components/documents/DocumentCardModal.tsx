import React from 'react';
import {
  FileText,
  Calendar,
  Building2,
  FolderOpen,
  Globe,
  Tag,
  Compass,
  X,
  Edit2,
  Printer,
  ExternalLink,
  Clock,
  MessageSquare,
} from 'lucide-react';
import { DocumentRecord } from '../../types';
import { formatDateRussian, formatDateTimeRussian } from '../../utils/date';
import { electronBridge } from '../../services/electronBridge';

interface DocumentCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: DocumentRecord | null;
  onEdit: (doc: DocumentRecord) => void;
}

export const DocumentCardModal: React.FC<DocumentCardModalProps> = ({
  isOpen,
  onClose,
  document: doc,
  onEdit,
}) => {
  if (!isOpen || !doc) return null;

  const handleOpenFile = async () => {
    if (doc.filePath) {
      await electronBridge.openPath(doc.filePath);
    }
  };

  const handleOpenSed = async () => {
    if (doc.sedUrl) {
      await electronBridge.openExternal(doc.sedUrl);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#E0E0E0]">
        
        {/* Заголовок карточки */}
        <div className="px-6 py-4 border-b border-[#2D3139] flex items-center justify-between bg-[#1F222B] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#E0E0E0] flex items-center gap-2">
                <span>Карточка документа №{doc.id}</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                  {doc.docTypeName}
                </span>
              </h3>
              <p className="text-xs text-gray-400 font-mono">
                Зарегистрирован: {formatDateTimeRussian(doc.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handlePrint}
              title="Печать карточки документа"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2D3139] rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                onClose();
                onEdit(doc);
              }}
              title="Редактировать документ"
              className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#2D3139] rounded-lg transition-colors cursor-pointer"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#2D3139] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Содержимое карточки */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          
          {/* Тема документа */}
          <div className="p-4 bg-[#0F1115] rounded-xl border border-[#2D3139]">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">
              Тема / Краткое содержание
            </span>
            <p className="text-sm font-semibold text-[#E0E0E0] leading-relaxed">
              {doc.subject}
            </p>
          </div>

          {/* Классификация */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#0F1115] rounded-xl border border-[#2D3139]">
              <span className="text-gray-400 text-[11px] flex items-center gap-1 mb-1">
                <Tag className="w-3.5 h-3.5 text-blue-400" />
                Тип документа
              </span>
              <p className="font-semibold text-[#E0E0E0]">
                {doc.docTypeName || '—'}
              </p>
            </div>

            <div className="p-3 bg-[#0F1115] rounded-xl border border-[#2D3139]">
              <span className="text-gray-400 text-[11px] flex items-center gap-1 mb-1">
                <Compass className="w-3.5 h-3.5 text-blue-400" />
                Направление
              </span>
              <p className="font-semibold text-[#E0E0E0]">
                {doc.directionName || '—'}
              </p>
            </div>
          </div>

          {/* Исходящие и Входящие реквизиты */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 bg-[#0F1115] rounded-xl border border-[#2D3139] space-y-1.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                Исходящие реквизиты
              </span>
              <div className="flex justify-between">
                <span className="text-gray-400">Исх. №:</span>
                <span className="font-mono font-semibold text-[#E0E0E0]">
                  {doc.outgoingNumber || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Исх. дата:</span>
                <span className="font-mono text-[#E0E0E0]">
                  {formatDateRussian(doc.outgoingDate)}
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-[#0F1115] rounded-xl border border-[#2D3139] space-y-1.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                Входящие реквизиты
              </span>
              <div className="flex justify-between">
                <span className="text-gray-400">Вх. №:</span>
                <span className="font-mono font-semibold text-[#E0E0E0]">
                  {doc.incomingNumber || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Вх. дата:</span>
                <span className="font-mono text-[#E0E0E0]">
                  {formatDateRussian(doc.incomingDate)}
                </span>
              </div>
            </div>
          </div>

          {/* Стороны: Отправитель и Получатель */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-[#0F1115] rounded-xl border border-[#2D3139]">
              <span className="text-gray-400 text-[11px] flex items-center gap-1 mb-1">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                Отправитель
              </span>
              <p className="font-semibold text-[#E0E0E0]">
                {doc.senderName || '—'}
              </p>
              {(doc.senderDepartmentName || doc.signatoryEmployeeName || doc.senderEmployeeName) && (
                <div className="mt-2 pt-2 border-t border-[#2D3139]/60 space-y-1">
                  {doc.senderDepartmentName && (
                    <div className="text-xs">
                      <span className="text-gray-400 text-[10px] block mb-0.5">Структурное подразделение:</span>
                      <span className="text-blue-400 font-medium">{doc.senderDepartmentName}</span>
                    </div>
                  )}
                  {doc.signatoryEmployeeName && (
                    <div className="text-xs">
                      <span className="text-gray-400 text-[10px] block mb-0.5">Подписал:</span>
                      <span className="text-emerald-400 font-medium">{doc.signatoryEmployeeName}</span>
                    </div>
                  )}
                  {doc.senderEmployeeName && (
                    <div className="text-xs">
                      <span className="text-gray-400 text-[10px] block mb-0.5">Исполнитель:</span>
                      <span className="text-gray-200 font-medium">{doc.senderEmployeeName}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-3 bg-[#0F1115] rounded-xl border border-[#2D3139]">
              <span className="text-gray-400 text-[11px] flex items-center gap-1 mb-1">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                Получатель
              </span>
              <p className="font-semibold text-[#E0E0E0]">
                {doc.recipientName || '—'}
              </p>
              {doc.recipientDepartmentNames && (
                <div className="mt-2 pt-2 border-t border-[#2D3139]/60">
                  <span className="text-gray-400 text-[10px] block mb-0.5">Структурные подразделения:</span>
                  <span className="text-indigo-600 dark:text-indigo-300 font-medium text-xs">
                    {doc.recipientDepartmentNames}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Ссылки на файлы и СЭД */}
          <div className="space-y-2">
            {doc.filePath ? (
              (() => {
                const isFolder = doc.filePath.endsWith('/') || doc.filePath.endsWith('\\') || !/\.[a-zA-Z0-9]{1,8}$/.test(doc.filePath.trim());
                return (
                  <div className={`p-3 bg-[#0F1115] rounded-xl border ${isFolder ? 'border-emerald-500/30' : 'border-blue-500/30'} flex items-center justify-between`}>
                    <div className="flex items-center gap-2 overflow-hidden pr-2">
                      {isFolder ? (
                        <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                      )}
                      <div className="truncate">
                        <span className="text-[10px] text-gray-400 block">
                          {isFolder ? 'Сетевая папка документа' : 'Файл документа на сетевом диске'}
                        </span>
                        <span className={`font-mono ${isFolder ? 'text-emerald-400' : 'text-blue-400'} font-medium truncate block`}>
                          {doc.filePath}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleOpenFile}
                      className={`px-3 py-1.5 ${isFolder ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-lg font-medium text-[11px] flex items-center gap-1 shrink-0 transition-colors cursor-pointer`}
                      title={isFolder ? 'Открыть папку в ОС' : 'Открыть файл в ОС'}
                    >
                      <span>{isFolder ? 'Открыть папку' : 'Открыть'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                );
              })()
            ) : (
              <div className="p-3 bg-[#0F1115] rounded-xl border border-[#2D3139] text-gray-400 flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                <span>Файл или папка документа не прикреплены</span>
              </div>
            )}

            {doc.sedUrl ? (
              <div className="p-3 bg-[#0F1115] rounded-xl border border-blue-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden pr-2">
                  <Globe className="w-4 h-4 text-blue-400 shrink-0" />
                  <div className="truncate">
                    <span className="text-[10px] text-gray-400 block">Электронная карточка в СЭД</span>
                    <span className="font-mono text-blue-400 font-medium truncate block">
                      {doc.sedUrl}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleOpenSed}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-[11px] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                >
                  <span>Перейти</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            ) : null}
          </div>

          {/* Примечания */}
          {doc.comments && (
            <div className="p-3.5 bg-[#0F1115] rounded-xl border border-[#2D3139]">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" />
                Примечания
              </span>
              <p className="text-[#E0E0E0] leading-relaxed">
                {doc.comments}
              </p>
            </div>
          )}

        </div>

        {/* Футер */}
        <div className="px-6 py-3.5 border-t border-[#2D3139] bg-[#1F222B] flex items-center justify-between text-xs text-gray-400 shrink-0">
          <div className="flex items-center gap-1 text-[11px]">
            <Clock className="w-3.5 h-3.5" />
            <span>Обновлено: {formatDateTimeRussian(doc.updatedAt)}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0F1115] border border-[#2D3139] hover:bg-[#2D3139] text-[#E0E0E0] rounded-xl font-semibold transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>

      </div>
    </div>
  );
};
