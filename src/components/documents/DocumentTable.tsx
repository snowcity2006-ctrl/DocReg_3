import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  FolderOpen,
  Globe,
  Eye,
  Edit2,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  Maximize2,
  Minimize2,
  RotateCcw,
  GripHorizontal,
  MoveDiagonal,
} from 'lucide-react';
import { DocumentRecord } from '../../types';
import { formatDateRussian } from '../../utils/date';
import { electronBridge } from '../../services/electronBridge';

interface DocumentTableProps {
  documents: DocumentRecord[];
  onView: (doc: DocumentRecord) => void;
  onEdit: (doc: DocumentRecord) => void;
  onDelete: (id: number) => Promise<void>;
}

type SortField =
  | 'id'
  | 'docTypeName'
  | 'directionName'
  | 'outgoingNumber'
  | 'outgoingDate'
  | 'incomingNumber'
  | 'incomingDate'
  | 'subject'
  | 'senderName'
  | 'recipientName';

export const DocumentTable: React.FC<DocumentTableProps> = ({
  documents,
  onView,
  onEdit,
  onDelete,
}) => {
  // Сортировка
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortAsc, setSortAsc] = useState(false); // Новые сначала по умолчанию

  // Пагинация
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Диалог подтверждения удаления
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    docId: number | null;
    docSubject: string;
  }>({
    isOpen: false,
    docId: null,
    docSubject: '',
  });
  const [deleting, setDeleting] = useState(false);

  // Управление шириной колонок (Column Resizing) по ТЗ
  const defaultColWidths: Record<string, number> = {
    id: 64,
    docType: 140,
    direction: 120,
    outNum: 110,
    outDate: 100,
    inNum: 110,
    inDate: 100,
    subject: 280,
    sender: 170,
    recipient: 170,
    filePath: 140,
    sedUrl: 130,
    actions: 105,
  };

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('sed_table_widths');
      return saved ? JSON.parse(saved) : defaultColWidths;
    } catch {
      return defaultColWidths;
    }
  });

  const resizingCol = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);

  const startResizing = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    resizingCol.current = {
      colKey,
      startX: e.clientX,
      startWidth: colWidths[colKey] || 120,
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const { colKey, startX, startWidth } = resizingCol.current;
    const delta = e.clientX - startX;
    const newWidth = Math.max(60, startWidth + delta);
    setColWidths((prev) => {
      const updated = { ...prev, [colKey]: newWidth };
      try {
        localStorage.setItem('sed_table_widths', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleMouseUp = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Масштабирование границ окна таблицы мышкой (Window Border Resizing)
  const DEFAULT_TABLE_HEIGHT = 540;
  const [tableHeight, setTableHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('docflow_table_height');
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val >= 240 && val <= 2500) return val;
      }
    } catch {}
    return DEFAULT_TABLE_HEIGHT;
  });

  const [tableWidth, setTableWidth] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('docflow_table_width');
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val >= 600 && val <= 3500) return val;
      }
    } catch {}
    return null;
  });

  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizingTable, setIsResizingTable] = useState<'bottom' | 'right' | 'corner' | null>(null);
  const [liveDimensions, setLiveDimensions] = useState<{ width: number; height: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const resizingTable = useRef<{
    edge: 'bottom' | 'right' | 'corner';
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const startResizingTable = (edge: 'bottom' | 'right' | 'corner', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMaximized || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    resizingTable.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    setIsResizingTable(edge);
    setLiveDimensions({ width: Math.round(rect.width), height: Math.round(rect.height) });

    const handleTableMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingTable.current) return;
      const { edge: currentEdge, startX, startY, startWidth, startHeight } = resizingTable.current;

      let newHeight = startHeight;
      let newWidth = startWidth;

      if (currentEdge === 'bottom' || currentEdge === 'corner') {
        const deltaY = moveEvent.clientY - startY;
        newHeight = Math.max(260, Math.min(window.innerHeight - 60, startHeight + deltaY));
        setTableHeight(newHeight);
        try {
          localStorage.setItem('docflow_table_height', String(Math.round(newHeight)));
        } catch {}
      }

      if (currentEdge === 'right' || currentEdge === 'corner') {
        const deltaX = moveEvent.clientX - startX;
        newWidth = Math.max(650, Math.min(window.innerWidth - 32, startWidth + deltaX));
        setTableWidth(newWidth);
        try {
          localStorage.setItem('docflow_table_width', String(Math.round(newWidth)));
        } catch {}
      }

      setLiveDimensions({ width: Math.round(newWidth), height: Math.round(newHeight) });
    };

    const handleTableMouseUp = () => {
      resizingTable.current = null;
      setIsResizingTable(null);
      setLiveDimensions(null);
      document.removeEventListener('mousemove', handleTableMouseMove);
      document.removeEventListener('mouseup', handleTableMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    if (edge === 'bottom') document.body.style.cursor = 'row-resize';
    else if (edge === 'right') document.body.style.cursor = 'col-resize';
    else if (edge === 'corner') document.body.style.cursor = 'se-resize';

    document.addEventListener('mousemove', handleTableMouseMove);
    document.addEventListener('mouseup', handleTableMouseUp);
  };

  const resetTableDimensions = () => {
    setTableHeight(DEFAULT_TABLE_HEIGHT);
    setTableWidth(null);
    setIsMaximized(false);
    try {
      localStorage.removeItem('docflow_table_height');
      localStorage.removeItem('docflow_table_width');
    } catch {}
  };

  const setHeightPreset = (h: number) => {
    setIsMaximized(false);
    setTableHeight(h);
    try {
      localStorage.setItem('docflow_table_height', String(h));
    } catch {}
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMaximized) {
        setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized]);

  // Сортировка данных
  const sortedDocuments = [...documents].sort((a, b) => {
    let aVal = (a as any)[sortField] ?? '';
    let bVal = (b as any)[sortField] ?? '';

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }

    const cmp = String(aVal).localeCompare(String(bVal), 'ru', { numeric: true, sensitivity: 'base' });
    return sortAsc ? cmp : -cmp;
  });

  // Пагинация
  const totalPages = Math.ceil(sortedDocuments.length / pageSize) || 1;
  const paginatedDocuments = sortedDocuments.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [totalPages, currentPage]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-gray-500 opacity-60 group-hover:opacity-100 shrink-0 ml-1" />;
    }
    return sortAsc ? (
      <ArrowUp className="w-3 h-3 text-blue-400 shrink-0 ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-400 shrink-0 ml-1" />
    );
  };

  const handleOpenFile = async (path?: string) => {
    if (path) {
      await electronBridge.openPath(path);
    }
  };

  const handleOpenSed = async (url?: string) => {
    if (url) {
      await electronBridge.openExternal(url);
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteDialog.docId !== null) {
      setDeleting(true);
      try {
        await onDelete(deleteDialog.docId);
        setDeleteDialog({ isOpen: false, docId: null, docSubject: '' });
      } catch (e: any) {
        alert(`Ошибка удаления: ${e.message}`);
      } finally {
        setDeleting(false);
      }
    }
  };

  return (
    <>
      {isMaximized && (
        <div
          className="fixed inset-0 z-45 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsMaximized(false)}
        />
      )}

      <div
        ref={containerRef}
        style={
          isMaximized
            ? undefined
            : {
                height: `${tableHeight}px`,
                width: tableWidth ? `${tableWidth}px` : undefined,
                maxWidth: '100%',
              }
        }
        className={`${
          isMaximized
            ? 'fixed inset-2 sm:inset-4 z-50 rounded-2xl shadow-2xl border border-blue-500/50'
            : 'relative rounded-2xl shadow-xl border border-[#2D3139]'
        } bg-[#171A21] flex flex-col overflow-hidden text-[#E0E0E0] transition-all`}
      >
        {/* Шапка окна таблицы документов: заголовок, статистика и управление масштабированием */}
        <div
          onDoubleClick={() => setIsMaximized((prev) => !prev)}
          title="Двойной клик разворачивает окно таблицы на весь экран или восстанавливает исходный размер"
          className="px-4 py-2.5 bg-[#12151B]/80 border-b border-[#2D3139] flex flex-wrap items-center justify-between gap-2 shrink-0 select-none cursor-default"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-blue-950/70 border border-blue-800/50 text-blue-400 flex items-center justify-center shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-xs font-bold text-[#E0E0E0] tracking-wide uppercase truncate">
                Перечень зарегистрированных документов
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-950/80 text-blue-400 border border-blue-800/40 shrink-0">
                {documents.length}
              </span>
            </div>
          </div>

          {/* Элементы управления масштабированием и размером окна таблицы */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
            {/* Индикатор текущего размера */}
            <span
              className="text-[11px] font-mono text-gray-400 px-2 py-0.5 rounded bg-[#0F1115] border border-[#2D3139]"
              title="Текущая высота окна таблицы (можно изменять мышкой, потянув за нижнюю границу)"
            >
              {isMaximized ? 'Во весь экран' : `${Math.round(tableHeight)} px`}
            </span>

            {/* Быстрые пресеты высоты */}
            {!isMaximized && (
              <div className="hidden sm:flex items-center gap-1 bg-[#0F1115] p-0.5 rounded-lg border border-[#2D3139]">
                <button
                  type="button"
                  onClick={() => setHeightPreset(380)}
                  title="Компактная высота (380px)"
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                    Math.round(tableHeight) === 380 ? 'bg-blue-600 text-white font-medium' : 'hover:text-[#E0E0E0]'
                  }`}
                >
                  380
                </button>
                <button
                  type="button"
                  onClick={() => setHeightPreset(540)}
                  title="Стандартная высота (540px)"
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                    Math.round(tableHeight) === 540 ? 'bg-blue-600 text-white font-medium' : 'hover:text-[#E0E0E0]'
                  }`}
                >
                  540
                </button>
                <button
                  type="button"
                  onClick={() => setHeightPreset(750)}
                  title="Высокая таблица (750px)"
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                    Math.round(tableHeight) === 750 ? 'bg-blue-600 text-white font-medium' : 'hover:text-[#E0E0E0]'
                  }`}
                >
                  750
                </button>
              </div>
            )}

            {/* Сброс размера */}
            <button
              type="button"
              onClick={resetTableDimensions}
              title="Сбросить размеры окна таблицы к стандартным"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Развернуть / Восстановить */}
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              title={isMaximized ? 'Восстановить исходный размер' : 'Развернуть окно таблицы на весь экран'}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1F222B] rounded-lg transition-colors cursor-pointer"
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Правая граница: масштабирование ширины окна таблицы мышкой */}
        {!isMaximized && (
          <div
            onMouseDown={(e) => startResizingTable('right', e)}
            className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 transition-colors z-30 group"
            title="Потяните правую границу для изменения ширины окна таблицы"
          >
            <div className="w-0.5 h-full mx-auto group-hover:bg-blue-500" />
          </div>
        )}

        {/* Контейнер таблицы с горизонтальным и вертикальным скроллом */}
        <div className="overflow-auto flex-1 min-h-[160px]">
          <table className="w-full text-left border-collapse text-xs select-none" style={{ tableLayout: 'fixed' }}>
            <thead className="sticky top-0 z-20 bg-[#1F222B] shadow-xs">
              <tr className="border-b border-[#2D3139] bg-[#1F222B] text-gray-400 font-semibold uppercase tracking-wider">
              
              {/* ID */}
              <th
                style={{ width: colWidths.id, minWidth: colWidths.id }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('id')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="ID">ID</span>
                  {renderSortIcon('id')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('id', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Тип документа */}
              <th
                style={{ width: colWidths.docType, minWidth: colWidths.docType }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('docTypeName')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Тип документа">Тип</span>
                  {renderSortIcon('docTypeName')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('docType', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Направление */}
              <th
                style={{ width: colWidths.direction, minWidth: colWidths.direction }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('directionName')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Направление">Направление</span>
                  {renderSortIcon('directionName')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('direction', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Исх.№ */}
              <th
                style={{ width: colWidths.outNum, minWidth: colWidths.outNum }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('outgoingNumber')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Исходящий номер">Исх.№</span>
                  {renderSortIcon('outgoingNumber')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('outNum', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Исх.дата */}
              <th
                style={{ width: colWidths.outDate, minWidth: colWidths.outDate }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('outgoingDate')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Исходящая дата">Исх.дата</span>
                  {renderSortIcon('outgoingDate')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('outDate', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Вх.№ */}
              <th
                style={{ width: colWidths.inNum, minWidth: colWidths.inNum }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('incomingNumber')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Входящий номер">Вх.№</span>
                  {renderSortIcon('incomingNumber')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('inNum', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Вх.дата */}
              <th
                style={{ width: colWidths.inDate, minWidth: colWidths.inDate }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('incomingDate')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Входящая дата">Вх.дата</span>
                  {renderSortIcon('incomingDate')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('inDate', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Тема */}
              <th
                style={{ width: colWidths.subject, minWidth: colWidths.subject }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('subject')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Тема документа">Тема *</span>
                  {renderSortIcon('subject')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('subject', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Отправитель */}
              <th
                style={{ width: colWidths.sender, minWidth: colWidths.sender }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('senderName')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Отправитель">Отправитель</span>
                  {renderSortIcon('senderName')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('sender', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Получатель */}
              <th
                style={{ width: colWidths.recipient, minWidth: colWidths.recipient }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div
                  onClick={() => handleSort('recipientName')}
                  className="flex items-center justify-between cursor-pointer min-w-0 pr-1.5"
                >
                  <span className="truncate block" title="Получатель">Получатель</span>
                  {renderSortIcon('recipientName')}
                </div>
                <div
                  onMouseDown={(e) => startResizing('recipient', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Путь к документу */}
              <th
                style={{ width: colWidths.filePath, minWidth: colWidths.filePath }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div className="flex items-center justify-between min-w-0 pr-1.5">
                  <span className="truncate block" title="Файл / Папка">Файл / Папка</span>
                </div>
                <div
                  onMouseDown={(e) => startResizing('filePath', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Путь к документу в СЭД */}
              <th
                style={{ width: colWidths.sedUrl, minWidth: colWidths.sedUrl }}
                className="py-3 px-3 relative group overflow-hidden"
              >
                <div className="flex items-center justify-between min-w-0 pr-1.5">
                  <span className="truncate block" title="Ссылка СЭД">СЭД ссылка</span>
                </div>
                <div
                  onMouseDown={(e) => startResizing('sedUrl', e)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500"
                />
              </th>

              {/* Действия */}
              <th
                style={{ width: colWidths.actions, minWidth: colWidths.actions }}
                className="py-3 px-3 text-right sticky right-0 bg-[#1F222B] overflow-hidden"
              >
                <span className="truncate block" title="Действия">Действия</span>
              </th>

            </tr>
          </thead>

          <tbody className="divide-y divide-[#2D3139] text-[#E0E0E0] font-medium">
            {paginatedDocuments.map((doc) => (
              <tr
                key={doc.id}
                className="hover:bg-[#1F222B]/70 transition-colors group"
              >
                {/* ID */}
                <td className="py-2.5 px-3 font-mono text-gray-500 break-words">
                  {doc.id}
                </td>

                {/* Тип документа */}
                <td className="py-2.5 px-3">
                  <span className="break-words leading-tight block text-gray-300">
                    {doc.docTypeName || '—'}
                  </span>
                </td>

                {/* Направление */}
                <td className="py-2.5 px-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 break-words whitespace-normal inline-block">
                    {doc.directionName || '—'}
                  </span>
                </td>

                {/* Исх.№ */}
                <td className="py-2.5 px-3 font-mono text-gray-300 break-words">
                  {doc.outgoingNumber || '—'}
                </td>

                {/* Исх.дата */}
                <td className="py-2.5 px-3 font-mono text-gray-300 break-words">
                  {formatDateRussian(doc.outgoingDate)}
                </td>

                {/* Вх.№ */}
                <td className="py-2.5 px-3 font-mono text-gray-300 break-words">
                  {doc.incomingNumber || '—'}
                </td>

                {/* Вх.дата */}
                <td className="py-2.5 px-3 font-mono text-gray-300 break-words">
                  {formatDateRussian(doc.incomingDate)}
                </td>

                {/* Тема (с переносом по словам по ТЗ) */}
                <td className="py-2.5 px-3">
                  <span
                    onClick={() => onView(doc)}
                    className="font-semibold text-[#E0E0E0] hover:text-blue-500 dark:hover:text-blue-400 cursor-pointer break-words whitespace-normal leading-relaxed transition-colors block"
                    title={doc.subject}
                  >
                    {doc.subject}
                  </span>
                </td>

                {/* Отправитель */}
                <td className="py-2.5 px-3 break-words whitespace-normal text-gray-300">
                  <div>
                    <span className="break-words">{doc.senderName || '—'}</span>
                    {(doc.senderDepartmentName || doc.signatoryEmployeeName || doc.senderEmployeeName) && (
                      <div className="mt-1 flex flex-col gap-0.5 text-[10px]">
                        {doc.senderDepartmentName && (
                          <span className="inline-flex items-center text-blue-400 break-words" title={`Подразделение: ${doc.senderDepartmentName}`}>
                            СП: {doc.senderDepartmentName}
                          </span>
                        )}
                        {doc.signatoryEmployeeName && (
                          <span className="inline-flex items-center text-emerald-400/90 break-words font-medium" title={`Подписал: ${doc.signatoryEmployeeName}`}>
                            Подписал: {doc.signatoryEmployeeName}
                          </span>
                        )}
                        {doc.senderEmployeeName && (
                          <span className="inline-flex items-center text-gray-400 break-words" title={`Исполнитель: ${doc.senderEmployeeName}`}>
                            Исп: {doc.senderEmployeeName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </td>

                {/* Получатель */}
                <td className="py-2.5 px-3 break-words whitespace-normal text-gray-300">
                  <div>
                    <span className="break-words">{doc.recipientName || '—'}</span>
                    {doc.recipientDepartmentNames && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-950/60 text-indigo-300 border border-indigo-800/40 break-words">
                          СП: {doc.recipientDepartmentNames}
                        </span>
                      </div>
                    )}
                  </div>
                </td>

                {/* Путь к документу (гиперссылка) */}
                <td className="py-2.5 px-3">
                  {doc.filePath ? (
                    (() => {
                      const isFolder = doc.filePath.endsWith('/') || doc.filePath.endsWith('\\') || !/\.[a-zA-Z0-9]{1,8}$/.test(doc.filePath.trim());
                      const cleanPath = doc.filePath.replace(/[/\\]+$/, '');
                      const displayName = cleanPath.split(/[/\\]/).pop() || doc.filePath;
                      return (
                        <button
                          type="button"
                          onClick={() => handleOpenFile(doc.filePath)}
                          title={`Открыть ${isFolder ? 'папку' : 'файл'}: ${doc.filePath}`}
                          className={`inline-flex items-center gap-1.5 ${isFolder ? 'text-emerald-400 hover:text-emerald-300' : 'text-blue-400 hover:text-blue-300'} hover:underline max-w-full font-mono text-[11px] cursor-pointer break-all whitespace-normal text-left`}
                        >
                          {isFolder ? (
                            <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          )}
                          <span className="break-all">{displayName}</span>
                        </button>
                      );
                    })()
                  ) : (
                    <span className="text-gray-500 text-[11px]">—</span>
                  )}
                </td>

                {/* Путь к документу в СЭД (гиперссылка) */}
                <td className="py-2.5 px-3">
                  {doc.sedUrl ? (
                    <button
                      type="button"
                      onClick={() => handleOpenSed(doc.sedUrl)}
                      title={`Открыть карточку в СЭД: ${doc.sedUrl}`}
                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline font-mono text-[11px] cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span>В СЭД</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  ) : (
                    <span className="text-gray-500 text-[11px]">—</span>
                  )}
                </td>

                {/* Действия */}
                <td className="py-2.5 px-3 text-right sticky right-0 bg-[#171A21] group-hover:bg-[#1F222B] transition-colors">
                  <div className="flex items-center justify-end gap-1">
                    {/* Просмотр карточки документа */}
                    <button
                      onClick={() => onView(doc)}
                      title="Просмотр карточки документа"
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#2D3139] rounded-lg transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>

                    {/* Редактирование */}
                    <button
                      onClick={() => onEdit(doc)}
                      title="Редактировать запись"
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#2D3139] rounded-lg transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Удаление */}
                    <button
                      onClick={() =>
                        setDeleteDialog({
                          isOpen: true,
                          docId: doc.id,
                          docSubject: doc.subject,
                        })
                      }
                      title="Удалить документ"
                      className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>

              </tr>
            ))}

            {paginatedDocuments.length === 0 && (
              <tr>
                <td colSpan={13} className="py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-gray-600" />
                    <p className="text-sm font-medium">Документы не найдены</p>
                    <p className="text-xs text-gray-500">Попробуйте изменить параметры поиска или фильтрации</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Пагинация и выбор количества записей */}
      <div className="px-4 py-3 border-t border-[#2D3139] bg-[#171A21] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span>Строк на странице:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="px-2 py-1 bg-[#0F1115] border border-[#2D3139] rounded-lg text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          <span className="ml-2 font-mono">
            Всего записей: <strong className="text-[#E0E0E0]">{documents.length}</strong>
          </span>
        </div>

        {/* Навигация по страницам */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="p-1 rounded-lg border border-[#2D3139] bg-[#0F1115] text-gray-300 disabled:opacity-40 hover:bg-[#1F222B] cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1 rounded-lg border border-[#2D3139] bg-[#0F1115] text-gray-300 disabled:opacity-40 hover:bg-[#1F222B] cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="px-2 font-medium">
            Стр. <strong className="text-[#E0E0E0] font-mono">{currentPage}</strong> из <span className="font-mono text-gray-400">{totalPages}</span>
          </span>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1 rounded-lg border border-[#2D3139] bg-[#0F1115] text-gray-300 disabled:opacity-40 hover:bg-[#1F222B] cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1 rounded-lg border border-[#2D3139] bg-[#0F1115] text-gray-300 disabled:opacity-40 hover:bg-[#1F222B] cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Нижняя граница: удобная планка масштабирования высоты окна таблицы мышкой */}
      {!isMaximized && (
        <div
          onMouseDown={(e) => startResizingTable('bottom', e)}
          onDoubleClick={() => setIsMaximized(true)}
          title="Потяните для изменения высоты окна таблицы мышкой (двойной клик — во весь экран)"
          className="h-3.5 w-full bg-[#12151B] hover:bg-blue-950/70 border-t border-[#2D3139] flex items-center justify-center cursor-row-resize transition-all select-none group shrink-0 relative"
        >
          <div className="w-28 h-1 rounded-full bg-[#2D3139] group-hover:bg-blue-500 transition-colors flex items-center justify-center">
            <GripHorizontal className="w-4 h-4 text-gray-500 group-hover:text-blue-300 transition-colors" />
          </div>

          {/* Угловой маркер масштабирования в правом нижнем углу */}
          <div
            onMouseDown={(e) => startResizingTable('corner', e)}
            title="Потяните угол для одновременного изменения ширины и высоты окна таблицы"
            className="absolute right-0 bottom-0 top-0 w-7 flex items-center justify-center cursor-se-resize text-gray-500 hover:text-blue-400 group/corner"
          >
            <MoveDiagonal className="w-3.5 h-3.5 group-hover/corner:scale-110 transition-transform" />
          </div>
        </div>
      )}

      {/* Всплывающий индикатор размеров во время масштабирования мышкой */}
      {isResizingTable && liveDimensions && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-blue-600 text-white font-mono text-xs px-3.5 py-1.5 rounded-full shadow-xl border border-blue-400 flex items-center gap-2 pointer-events-none animate-in fade-in zoom-in-95">
          <span>{liveDimensions.width} × {liveDimensions.height} px</span>
        </div>
      )}

      {/* Модалка подтверждения удаления документа */}
      {deleteDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-md overflow-hidden p-6 space-y-4 text-[#E0E0E0]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 text-rose-400 flex items-center justify-center border border-rose-900">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#E0E0E0]">
                  Удаление документа №{deleteDialog.docId}
                </h4>
                <p className="text-xs text-gray-400">
                  Подтверждение операции
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Вы уверены, что хотите безвозвратно удалить документ: <br />
              <strong className="text-[#E0E0E0]">«{deleteDialog.docSubject}»</strong>?
            </p>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog({ isOpen: false, docId: null, docSubject: '' })}
                className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-[#1F222B] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
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
    </>
  );
};
