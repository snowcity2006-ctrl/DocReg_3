import React, { useState, useEffect, useRef } from 'react';
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
  ClipboardPaste,
  ChevronDown,
  Search,
  Layers,
  CheckSquare,
  Square,
  User,
  UserCheck,
} from 'lucide-react';
import {
  DocumentRecord,
  DocumentType,
  Direction,
  Organization,
  Department,
  Employee,
} from '../../types';
import { electronBridge } from '../../services/electronBridge';

interface DocumentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }) => Promise<void>;
  documentTypes: DocumentType[];
  directions: Direction[];
  organizations: Organization[];
  departments: Department[];
  employees: Employee[];
  onOpenNewOrgModal: () => void;
  onOpenNewDepartmentModal: () => void;
  onOpenNewEmployeeModal: () => void;
  onOpenNewDocTypeModal: () => void;
  onOpenNewDirectionModal: () => void;
  initialData?: DocumentRecord | null;
}

export const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  documentTypes,
  directions,
  organizations,
  departments,
  employees,
  onOpenNewOrgModal,
  onOpenNewDepartmentModal,
  onOpenNewEmployeeModal,
  onOpenNewDocTypeModal,
  onOpenNewDirectionModal,
  initialData,
}) => {
  const [docTypeId, setDocTypeId] = useState<number | ''>('');
  const [directionId, setDirectionId] = useState<number | ''>('');
  const [outgoingNumber, setOutgoingNumber] = useState('');
  const [outgoingDate, setOutgoingDate] = useState('');
  const [incomingNumber, setIncomingNumber] = useState('');
  const [incomingDate, setIncomingDate] = useState('');
  const [subject, setSubject] = useState('');
  
  // Отправитель: Организация, СП, Подписал и Исполнитель (Сотрудники)
  const [senderId, setSenderId] = useState<number | ''>('');
  const [senderDepartmentId, setSenderDepartmentId] = useState<number | ''>('');
  const [senderEmployeeId, setSenderEmployeeId] = useState<number | ''>('');
  const [signatoryEmployeeId, setSignatoryEmployeeId] = useState<number | ''>('');

  // Отслеживание добавления сотрудника для авто-выбора (Подписал / Исполнитель)
  const [pendingEmployeeTarget, setPendingEmployeeTarget] = useState<'signatory' | 'executor' | null>(null);
  const prevEmployeesCountRef = useRef(employees.length);

  // Множественный выбор получателей (Организации)
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [isRecipientDropdownOpen, setIsRecipientDropdownOpen] = useState(false);
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('');
  const recipientDropdownRef = useRef<HTMLDivElement>(null);

  // Множественный выбор структурных подразделений для Получателя
  const [recipientDepartmentIds, setRecipientDepartmentIds] = useState<number[]>([]);
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [deptSearchQuery, setDeptSearchQuery] = useState('');
  const deptDropdownRef = useRef<HTMLDivElement>(null);

  const [filePath, setFilePath] = useState('');
  const [sedUrl, setSedUrl] = useState('');
  const [comments, setComments] = useState('');

  const [pastedFeedback, setPastedFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Закрытие выпадающих списков при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        recipientDropdownRef.current &&
        !recipientDropdownRef.current.contains(event.target as Node)
      ) {
        setIsRecipientDropdownOpen(false);
      }
      if (
        deptDropdownRef.current &&
        !deptDropdownRef.current.contains(event.target as Node)
      ) {
        setIsDeptDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
      setSenderDepartmentId(initialData.senderDepartmentId || '');
      setSenderEmployeeId(initialData.senderEmployeeId || '');
      setSignatoryEmployeeId(initialData.signatoryEmployeeId || '');

      // Инициализация получателей
      if (initialData.recipientIds && initialData.recipientIds.length > 0) {
        setRecipientIds(initialData.recipientIds);
      } else if (initialData.recipientId) {
        setRecipientIds([initialData.recipientId]);
      } else {
        setRecipientIds([]);
      }

      // Инициализация структурных подразделений получателя
      setRecipientDepartmentIds(initialData.recipientDepartmentIds || []);

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
      setSenderDepartmentId('');
      setSenderEmployeeId('');
      setSignatoryEmployeeId('');
      setRecipientIds([]);
      setRecipientDepartmentIds([]);
      setFilePath('');
      setSedUrl('');
      setComments('');
    }
    setError(null);
    setIsRecipientDropdownOpen(false);
    setIsDeptDropdownOpen(false);
    setRecipientSearchQuery('');
    setDeptSearchQuery('');
  }, [initialData, isOpen, documentTypes, directions]);

  // Автоматический выбор добавленного сотрудника (для «Подписал» или «Исполнитель»)
  useEffect(() => {
    if (employees.length > prevEmployeesCountRef.current) {
      const newestEmp = employees[employees.length - 1];
      if (newestEmp && pendingEmployeeTarget === 'signatory') {
        setSignatoryEmployeeId(newestEmp.id);
        if (!senderId || senderId !== newestEmp.organizationId) {
          setSenderId(newestEmp.organizationId);
        }
      } else if (newestEmp && pendingEmployeeTarget === 'executor') {
        handleSenderEmployeeChange(newestEmp.id);
      }
      setPendingEmployeeTarget(null);
    }
    prevEmployeesCountRef.current = employees.length;
  }, [employees]);

  const handleBrowseFile = async () => {
    try {
      const selected = electronBridge.selectDocumentFile
        ? await electronBridge.selectDocumentFile()
        : await electronBridge.selectDocumentFileOrFolder();
      if (selected) {
        setFilePath(selected);
      }
    } catch (e: any) {
      setError(`Ошибка выбора файла: ${e.message}`);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = electronBridge.selectDocumentFolder
        ? await electronBridge.selectDocumentFolder()
        : await electronBridge.selectDocumentFileOrFolder();
      if (selected) {
        setFilePath(selected);
      }
    } catch (e: any) {
      setError(`Ошибка выбора папки: ${e.message}`);
    }
  };

  // Вставка ссылки из буфера обмена для поля "Путь к документу в СЭД"
  const handlePasteFromClipboard = async () => {
    try {
      let clipboardText = '';
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        clipboardText = await navigator.clipboard.readText();
      }

      if (clipboardText && clipboardText.trim()) {
        const clean = clipboardText.trim();
        setSedUrl(clean);
        setPastedFeedback(true);
        setTimeout(() => setPastedFeedback(false), 2200);
      } else {
        setError('Буфер обмена пуст или не содержит текстовую ссылку');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err: any) {
      setError(`Не удалось вставить из буфера: ${err.message || 'нет доступа к буферу обмена'}`);
      setTimeout(() => setError(null), 4000);
    }
  };

  // Обработка переключения получателя (Организации)
  const toggleRecipient = (orgId: number) => {
    setRecipientIds((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId]
    );
  };

  const removeRecipient = (orgId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRecipientIds((prev) => prev.filter((id) => id !== orgId));
  };

  const handleSelectAllRecipients = () => {
    setRecipientIds(organizations.map((org) => org.id));
  };

  const handleClearRecipients = () => {
    setRecipientIds([]);
  };

  // Обработка переключения структурных подразделений получателя
  const toggleDepartment = (deptId: number) => {
    setRecipientDepartmentIds((prev) =>
      prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]
    );
  };

  const removeDepartment = (deptId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRecipientDepartmentIds((prev) => prev.filter((id) => id !== deptId));
  };

  const handleSelectAllDepartments = () => {
    setRecipientDepartmentIds(availableDepartments.map((d) => d.id));
  };

  const handleClearDepartments = () => {
    setRecipientDepartmentIds([]);
  };

  // Фильтрация организаций по поисковому запросу
  const filteredOrganizations = organizations.filter((org) =>
    org.name.toLowerCase().includes(recipientSearchQuery.toLowerCase())
  );

  // Доступные подразделения: приоритет отдается выбранным получателям, либо всем если получатели не выбраны
  const availableDepartments = departments.filter((d) => {
    if (recipientIds.length === 0) return true;
    return recipientIds.includes(d.organizationId);
  });

  const filteredDepartments = availableDepartments.filter((d) => {
    const q = deptSearchQuery.toLowerCase();
    const nameMatch = d.name.toLowerCase().includes(q);
    const shortMatch = d.shortName.toLowerCase().includes(q);
    const orgMatch = d.organizationName?.toLowerCase().includes(q);
    return nameMatch || shortMatch || orgMatch;
  });

  // Обработка выбора для Отправителя: Организация, СП, Исполнитель (Сотрудник)
  const handleSenderOrgChange = (newOrgId: number | '') => {
    setSenderId(newOrgId);
    if (newOrgId) {
      if (senderDepartmentId) {
        const dept = departments.find((d) => d.id === senderDepartmentId);
        if (dept && dept.organizationId !== newOrgId) {
          setSenderDepartmentId('');
        }
      }
      if (senderEmployeeId) {
        const emp = employees.find((e) => e.id === senderEmployeeId);
        if (emp && emp.organizationId !== newOrgId) {
          setSenderEmployeeId('');
        }
      }
      if (signatoryEmployeeId) {
        const emp = employees.find((e) => e.id === signatoryEmployeeId);
        if (emp && emp.organizationId !== newOrgId) {
          setSignatoryEmployeeId('');
        }
      }
    }
  };

  const handleSignatoryEmployeeChange = (newEmpId: number | '') => {
    setSignatoryEmployeeId(newEmpId);
    if (newEmpId) {
      const emp = employees.find((e) => e.id === newEmpId);
      if (emp) {
        if (!senderId || senderId !== emp.organizationId) {
          setSenderId(emp.organizationId);
        }
      }
    }
  };

  const handleSenderDeptChange = (newDeptId: number | '') => {
    setSenderDepartmentId(newDeptId);
    if (newDeptId) {
      const dept = departments.find((d) => d.id === newDeptId);
      if (dept) {
        if (!senderId || senderId !== dept.organizationId) {
          setSenderId(dept.organizationId);
        }
        if (senderEmployeeId) {
          const emp = employees.find((e) => e.id === senderEmployeeId);
          if (
            emp &&
            emp.departmentShortName.toLowerCase() !== dept.shortName.toLowerCase() &&
            emp.organizationId !== dept.organizationId
          ) {
            setSenderEmployeeId('');
          }
        }
      }
    }
  };

  const handleSenderEmployeeChange = (newEmpId: number | '') => {
    setSenderEmployeeId(newEmpId);
    if (newEmpId) {
      const emp = employees.find((e) => e.id === newEmpId);
      if (emp) {
        if (!senderId || senderId !== emp.organizationId) {
          setSenderId(emp.organizationId);
        }
        const matchingDept = departments.find(
          (d) =>
            d.organizationId === emp.organizationId &&
            d.shortName.toLowerCase() === emp.departmentShortName.toLowerCase()
        );
        if (matchingDept) {
          setSenderDepartmentId(matchingDept.id);
        }
      }
    }
  };

  // Фильтрация СП для отправителя
  const filteredSenderDepartments = departments.filter((d) => {
    if (!senderId) return true;
    return d.organizationId === senderId;
  });

  // Фильтрация сотрудников для отправителя
  const filteredSenderEmployees = employees.filter((e) => {
    if (senderDepartmentId) {
      const dept = departments.find((d) => d.id === senderDepartmentId);
      if (dept) {
        return (
          e.organizationId === dept.organizationId &&
          e.departmentShortName.toLowerCase() === dept.shortName.toLowerCase()
        );
      }
    }
    if (senderId) {
      return e.organizationId === senderId;
    }
    return true;
  });

  // Фильтрация сотрудников для «Подписал» (по организации отправителя, если выбрана)
  const availableSignatoryEmployees = employees.filter((e) => {
    if (senderId) {
      return e.organizationId === senderId;
    }
    return true;
  });

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

    let formattedSedUrl = sedUrl.trim();
    if (formattedSedUrl && !/^https?:\/\//i.test(formattedSedUrl) && !formattedSedUrl.startsWith('http')) {
      formattedSedUrl = `https://${formattedSedUrl}`;
    }

    // Составляем названия подразделения и исполнителя отправителя
    const senderDept = departments.find((d) => d.id === senderDepartmentId);
    const senderDeptName = senderDept ? (senderDept.shortName || senderDept.name) : undefined;

    const senderEmp = employees.find((e) => e.id === senderEmployeeId);
    const senderEmpName = senderEmp ? senderEmp.fullName : undefined;

    // Подписавший сотрудник
    const signatoryEmp = employees.find((e) => e.id === signatoryEmployeeId);
    const signatoryEmpName = signatoryEmp ? signatoryEmp.fullName : undefined;

    // Составляем строку названий структурных подразделений
    const selectedDepts = departments.filter((d) => recipientDepartmentIds.includes(d.id));
    const recipientDeptNames = selectedDepts.map((d) => d.shortName || d.name).join(', ');

    // Названия выбранных организаций-получателей
    const selectedOrgs = organizations.filter((o) => recipientIds.includes(o.id));
    const recipientNames = selectedOrgs.map((o) => o.name).join(', ');

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
        senderDepartmentId: senderDepartmentId ? Number(senderDepartmentId) : undefined,
        senderDepartmentName: senderDeptName,
        senderEmployeeId: senderEmployeeId ? Number(senderEmployeeId) : undefined,
        senderEmployeeName: senderEmpName,
        signatoryEmployeeId: signatoryEmployeeId ? Number(signatoryEmployeeId) : undefined,
        signatoryEmployeeName: signatoryEmpName,
        // Для обратной совместимости сохраняем первого получателя в recipientId
        recipientId: recipientIds.length > 0 ? recipientIds[0] : undefined,
        recipientName: recipientNames || undefined,
        recipientIds: recipientIds.length > 0 ? recipientIds : undefined,
        recipientDepartmentIds: recipientDepartmentIds.length > 0 ? recipientDepartmentIds : undefined,
        recipientDepartmentNames: recipientDeptNames || undefined,
        filePath: filePath.trim() || undefined,
        sedUrl: formattedSedUrl || undefined,
        comments: comments.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения документа');
    } finally {
      setSaving(false);
    }
  };

  // Вспомогательные данные для всплывающих подсказок (title) и предотвращения визуальных наложений
  const selectedDocType = documentTypes.find((t) => t.id === Number(docTypeId));
  const selectedDirection = directions.find((d) => d.id === Number(directionId));
  const selectedSenderOrg = organizations.find((o) => o.id === Number(senderId));
  const selectedSenderDept = departments.find((d) => d.id === Number(senderDepartmentId));
  const selectedSenderEmp = employees.find((e) => e.id === Number(senderEmployeeId));
  const selectedSignatoryEmp = employees.find((e) => e.id === Number(signatoryEmployeeId));

  // Взаимное переключение выпадающих списков получателя и СП (предотвращает их взаимное перекрытие)
  const toggleRecipientDropdown = () => {
    setIsRecipientDropdownOpen((prev) => {
      const next = !prev;
      if (next) setIsDeptDropdownOpen(false);
      return next;
    });
  };

  const toggleDeptDropdown = () => {
    setIsDeptDropdownOpen((prev) => {
      const next = !prev;
      if (next) setIsRecipientDropdownOpen(false);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#171A21] rounded-2xl shadow-2xl border border-[#2D3139] w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] text-[#E0E0E0]">
        
        {/* Заголовок формы */}
        <div className="px-5 sm:px-6 py-3.5 sm:py-4 border-b border-[#2D3139] flex items-center justify-between bg-[#1F222B] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-400 flex items-center justify-center border border-blue-500/20 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#E0E0E0] truncate">
                {initialData ? `Редактирование карточки документа №${initialData.id}` : 'Регистрация нового документа'}
              </h3>
              <p className="text-xs text-gray-400 truncate">
                Символом <span className="text-rose-400 font-bold">*</span> обозначены обязательные для заполнения поля
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#2D3139] transition-colors cursor-pointer shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Тело формы с полосой прокрутки */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto overflow-x-hidden space-y-4 sm:space-y-5 text-xs">
          
          {error && (
            <div className="p-3.5 bg-rose-950/50 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}

          {/* 1. Блок классификации: Тип документа и Направление */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 min-w-0 w-full">
            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1 min-w-0 truncate">
                <Tag className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Тип документа <span className="text-rose-400 font-bold">*</span></span>
              </label>
              <div className="flex gap-2 min-w-0 w-full items-center">
                <select
                  required
                  value={docTypeId}
                  onChange={(e) => setDocTypeId(e.target.value ? Number(e.target.value) : '')}
                  title={selectedDocType ? selectedDocType.name : undefined}
                  className="w-full min-w-0 flex-1 truncate px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 font-medium transition-colors"
                >
                  <option value="">-- Выберите тип документа --</option>
                  {documentTypes.map((t) => (
                    <option key={t.id} value={t.id} title={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewDocTypeModal}
                  title="Добавить новый тип документа в справочник"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1.5 flex items-center gap-1 min-w-0 truncate">
                <Compass className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Направление <span className="text-rose-400 font-bold">*</span></span>
              </label>
              <div className="flex gap-2 min-w-0 w-full items-center">
                <select
                  required
                  value={directionId}
                  onChange={(e) => setDirectionId(e.target.value ? Number(e.target.value) : '')}
                  title={selectedDirection ? selectedDirection.name : undefined}
                  className="w-full min-w-0 flex-1 truncate px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 font-medium transition-colors"
                >
                  <option value="">-- Выберите направление --</option>
                  {directions.map((d) => (
                    <option key={d.id} value={d.id} title={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewDirectionModal}
                  title="Добавить новое направление в справочник"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 2. Блок номеров и дат: Исходящие и Входящие с календарем */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 sm:p-4 bg-[#0F1115] rounded-xl border border-[#2D3139] min-w-0 w-full">
            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1 truncate">
                Исх. №
              </label>
              <input
                type="text"
                value={outgoingNumber}
                onChange={(e) => setOutgoingNumber(e.target.value)}
                placeholder="Например: ИСХ-102/26"
                className="w-full min-w-0 px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1 flex items-center gap-1 min-w-0 truncate">
                <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Исх. дата</span>
              </label>
              <input
                type="date"
                value={outgoingDate}
                onChange={(e) => setOutgoingDate(e.target.value)}
                className="w-full min-w-0 px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1 truncate">
                Вх. №
              </label>
              <input
                type="text"
                value={incomingNumber}
                onChange={(e) => setIncomingNumber(e.target.value)}
                placeholder="Например: ВХ-00452"
                className="w-full min-w-0 px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="min-w-0 w-full">
              <label className="block font-semibold text-gray-300 mb-1 flex items-center gap-1 min-w-0 truncate">
                <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Вх. дата</span>
              </label>
              <input
                type="date"
                value={incomingDate}
                onChange={(e) => setIncomingDate(e.target.value)}
                className="w-full min-w-0 px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-lg text-xs font-mono text-[#E0E0E0] focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 3. Тема документа */}
          <div className="min-w-0 w-full">
            <label className="block font-semibold text-gray-300 mb-1.5 min-w-0 truncate">
              <span className="truncate">Тема (краткое содержание)</span> <span className="text-rose-400 font-bold">*</span>
            </label>
            <textarea
              required
              rows={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Опишите краткое содержание или предмет документа..."
              className="w-full min-w-0 px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 4. Блок: Отправитель (Организация, СП, Исполнитель) */}
          <div className="p-3.5 sm:p-4 bg-[#0F1115] rounded-xl border border-[#2D3139] space-y-3 min-w-0 w-full">
            <div className="flex items-center justify-between min-w-0">
              <span className="font-semibold text-gray-300 flex items-center gap-1.5 min-w-0 truncate">
                <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Отправитель</span>
              </span>
              {(senderId || senderDepartmentId || senderEmployeeId || signatoryEmployeeId) && (
                <button
                  type="button"
                  onClick={() => {
                    setSenderId('');
                    setSenderDepartmentId('');
                    setSenderEmployeeId('');
                    setSignatoryEmployeeId('');
                  }}
                  className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0 ml-2"
                >
                  Очистить отправителя
                </button>
              )}
            </div>

            {/* Организация */}
            <div className="min-w-0 w-full">
              <label className="block text-[11px] font-medium text-gray-400 mb-1 truncate">
                Организация
              </label>
              <div className="flex gap-2 min-w-0 w-full items-center">
                <select
                  value={senderId}
                  onChange={(e) => handleSenderOrgChange(e.target.value ? Number(e.target.value) : '')}
                  title={selectedSenderOrg ? selectedSenderOrg.name : undefined}
                  className="w-full min-w-0 flex-1 truncate px-3.5 py-2 bg-[#171A21] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">-- Выберите организацию-отправителя --</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id} title={org.name}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewOrgModal}
                  title="Добавить новую организацию в справочник"
                  className="p-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Структурное подразделение */}
            <div className="min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
                <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1 min-w-0 truncate">
                  <Layers className="w-3 h-3 text-blue-400 shrink-0" />
                  <span className="truncate">Структурное подразделение</span>
                </label>
                {senderDepartmentId && (
                  <button
                    type="button"
                    onClick={() => setSenderDepartmentId('')}
                    className="text-[10px] text-gray-500 hover:text-rose-400 transition-colors shrink-0"
                  >
                    Сбросить
                  </button>
                )}
              </div>
              <div className="flex gap-2 min-w-0 w-full items-center">
                <select
                  value={senderDepartmentId}
                  onChange={(e) => handleSenderDeptChange(e.target.value ? Number(e.target.value) : '')}
                  title={selectedSenderDept ? `${selectedSenderDept.shortName} — ${selectedSenderDept.name}` : undefined}
                  className="w-full min-w-0 flex-1 truncate px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">-- Не выбрано --</option>
                  {filteredSenderDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id} title={`${dept.shortName} — ${dept.name}`}>
                      {dept.shortName} — {dept.name} {!senderId && dept.organizationName ? `(${dept.organizationName})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenNewDepartmentModal}
                  title="Добавить структурное подразделение в справочник"
                  className="p-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Выбор Подписал и Исполнитель: адаптивная сетка с min-w-0 и предотвращением перекрытия */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 pt-0.5 min-w-0 w-full">
              
              {/* Подписал (Сотрудник) */}
              <div className="min-w-0 w-full flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
                  <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1 min-w-0 truncate">
                    <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">Подписал</span>
                  </label>
                  {signatoryEmployeeId && (
                    <button
                      type="button"
                      onClick={() => setSignatoryEmployeeId('')}
                      className="text-[10px] text-gray-500 hover:text-rose-400 transition-colors shrink-0"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
                <div className="flex gap-2 min-w-0 w-full items-center">
                  <select
                    value={signatoryEmployeeId}
                    onChange={(e) => handleSignatoryEmployeeChange(e.target.value ? Number(e.target.value) : '')}
                    title={selectedSignatoryEmp ? `${selectedSignatoryEmp.fullName} (${selectedSignatoryEmp.departmentShortName || ''})` : undefined}
                    className="w-full min-w-0 flex-1 truncate px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">-- Не выбрано --</option>
                    {(availableSignatoryEmployees.length > 0 ? availableSignatoryEmployees : employees).map((emp) => (
                      <option key={emp.id} value={emp.id} title={`${emp.fullName} (${emp.departmentShortName})`}>
                        {emp.fullName} ({emp.departmentShortName}) {!senderId && emp.organizationName ? `— ${emp.organizationName}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingEmployeeTarget('signatory');
                      onOpenNewEmployeeModal();
                    }}
                    title="Добавить сотрудника в справочник"
                    className="p-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Исполнитель (Сотрудник) */}
              <div className="min-w-0 w-full flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
                  <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1 min-w-0 truncate">
                    <User className="w-3 h-3 text-blue-400 shrink-0" />
                    <span className="truncate">Исполнитель (Сотрудник)</span>
                  </label>
                  {senderEmployeeId && (
                    <button
                      type="button"
                      onClick={() => setSenderEmployeeId('')}
                      className="text-[10px] text-gray-500 hover:text-rose-400 transition-colors shrink-0"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
                <div className="flex gap-2 min-w-0 w-full items-center">
                  <select
                    value={senderEmployeeId}
                    onChange={(e) => handleSenderEmployeeChange(e.target.value ? Number(e.target.value) : '')}
                    title={selectedSenderEmp ? `${selectedSenderEmp.fullName} (${selectedSenderEmp.departmentShortName || ''})` : undefined}
                    className="w-full min-w-0 flex-1 truncate px-3 py-2 bg-[#171A21] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">-- Не выбрано --</option>
                    {filteredSenderEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id} title={`${emp.fullName} (${emp.departmentShortName})`}>
                        {emp.fullName} ({emp.departmentShortName}) {!senderId && emp.organizationName ? `— ${emp.organizationName}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingEmployeeTarget('executor');
                      onOpenNewEmployeeModal();
                    }}
                    title="Добавить сотрудника в справочник"
                    className="p-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* 5. ПОЛУЧАТЕЛЬ (Множественный выбор организаций) и СТРУКТУРНЫЕ ПОДРАЗДЕЛЕНИЯ ПОЛУЧАТЕЛЯ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 min-w-0 w-full">
            
            {/* 5.1 Множественный выбор: Получатель (Организации) */}
            <div className={`min-w-0 w-full relative ${isRecipientDropdownOpen ? 'z-40' : 'z-20'}`} ref={recipientDropdownRef}>
              <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                <label className="font-semibold text-gray-300 flex items-center gap-1 min-w-0 truncate">
                  <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">Получатель (множественный выбор)</span>
                </label>
                {recipientIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearRecipients}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                  >
                    Очистить ({recipientIds.length})
                  </button>
                )}
              </div>

              <div className="flex gap-2 min-w-0 w-full items-center">
                {/* Триггер выпадающего списка с чипами */}
                <div
                  onClick={toggleRecipientDropdown}
                  className={`w-full min-w-0 flex-1 min-h-[42px] px-3 py-2 bg-[#0F1115] border ${
                    isRecipientDropdownOpen ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-[#2D3139]'
                  } rounded-xl cursor-pointer flex items-center justify-between gap-2 transition-colors`}
                >
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 min-w-0 flex-1">
                    {recipientIds.length === 0 ? (
                      <span className="text-gray-500 select-none truncate">
                        -- Выберите одного или нескольких получателей --
                      </span>
                    ) : (
                      organizations
                        .filter((org) => recipientIds.includes(org.id))
                        .map((org) => (
                          <span
                            key={org.id}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/20 text-blue-300 border border-blue-500/40 rounded-lg text-[11px] font-medium max-w-full"
                          >
                            <span className="truncate max-w-[150px]">{org.name}</span>
                            <button
                              type="button"
                              onClick={(e) => removeRecipient(org.id, e)}
                              className="text-blue-400 hover:text-rose-400 p-0.5 rounded-md hover:bg-white/10 transition-colors shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                    )}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                      isRecipientDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <button
                  type="button"
                  onClick={onOpenNewOrgModal}
                  title="Добавить новую организацию в справочник"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Выпадающее окно множественного выбора получателей */}
              {isRecipientDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#1F222B] border border-[#2D3139] rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-100">
                  {/* Поиск и быстрые действия */}
                  <div className="p-2.5 border-b border-[#2D3139] bg-[#171A21] space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        type="text"
                        autoFocus
                        value={recipientSearchQuery}
                        onChange={(e) => setRecipientSearchQuery(e.target.value)}
                        placeholder="Быстрый поиск организации..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[#0F1115] border border-[#2D3139] rounded-lg text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] px-1 text-gray-400">
                      <span>Найдено: {filteredOrganizations.length}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllRecipients}
                          className="hover:text-blue-400 transition-colors cursor-pointer"
                        >
                          Выбрать все
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={handleClearRecipients}
                          className="hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          Снять все
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Список чекбоксов */}
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#2D3139]/40 p-1">
                    {filteredOrganizations.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 text-xs">
                        Организации не найдены
                      </div>
                    ) : (
                      filteredOrganizations.map((org) => {
                        const isSelected = recipientIds.includes(org.id);
                        return (
                          <div
                            key={org.id}
                            onClick={() => toggleRecipient(org.id)}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-600/15 text-[#E0E0E0] font-medium'
                                : 'hover:bg-[#2D3139]/40 text-gray-300'
                            }`}
                          >
                            <div className="text-blue-400 shrink-0">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-blue-400" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-500" />
                              )}
                            </div>
                            <span className="text-xs select-none truncate">{org.name}</span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="p-2 border-t border-[#2D3139] bg-[#171A21] flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsRecipientDropdownOpen(false)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Готово
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 5.2 Множественный выбор: Структурные подразделения для Получателя */}
            <div className={`min-w-0 w-full relative ${isDeptDropdownOpen ? 'z-40' : 'z-20'}`} ref={deptDropdownRef}>
              <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                <label className="font-semibold text-gray-300 flex items-center gap-1 min-w-0 truncate">
                  <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">СП для «Получателя» (множественный выбор)</span>
                </label>
                {recipientDepartmentIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearDepartments}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                  >
                    Очистить ({recipientDepartmentIds.length})
                  </button>
                )}
              </div>

              {/* Триггер выпадающего списка структурных подразделений */}
              <div className="flex gap-2 min-w-0 w-full items-center">
                <div
                  onClick={toggleDeptDropdown}
                  className={`w-full min-w-0 flex-1 min-h-[42px] px-3 py-2 bg-[#0F1115] border ${
                    isDeptDropdownOpen ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-[#2D3139]'
                  } rounded-xl cursor-pointer flex items-center justify-between gap-2 transition-colors`}
                >
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 min-w-0 flex-1">
                    {recipientDepartmentIds.length === 0 ? (
                      <span className="text-gray-500 select-none truncate">
                        {recipientIds.length > 0
                          ? '-- Выберите структурные подразделения получателя --'
                          : '-- Выберите структурные подразделения (опционально) --'}
                      </span>
                    ) : (
                      departments
                        .filter((d) => recipientDepartmentIds.includes(d.id))
                        .map((dept) => (
                          <span
                            key={dept.id}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 rounded-lg text-[11px] font-medium max-w-full"
                          >
                            <span className="font-semibold text-blue-300 mr-0.5 shrink-0">{dept.shortName}</span>
                            <span className="truncate max-w-[130px]">({dept.name})</span>
                            <button
                              type="button"
                              onClick={(e) => removeDepartment(dept.id, e)}
                              className="text-indigo-400 hover:text-rose-400 p-0.5 rounded-md hover:bg-white/10 transition-colors shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                    )}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                      isDeptDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                <button
                  type="button"
                  onClick={onOpenNewDepartmentModal}
                  title="Добавить новое структурное подразделение в справочник"
                  className="p-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Выпадающее окно выбора структурных подразделений */}
              {isDeptDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#1F222B] border border-[#2D3139] rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-100">
                  {/* Поиск и быстрые действия */}
                  <div className="p-2.5 border-b border-[#2D3139] bg-[#171A21] space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        type="text"
                        autoFocus
                        value={deptSearchQuery}
                        onChange={(e) => setDeptSearchQuery(e.target.value)}
                        placeholder="Поиск по названию или аббревиатуре СП..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[#0F1115] border border-[#2D3139] rounded-lg text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] px-1 text-gray-400">
                      <span>
                        {recipientIds.length > 0
                          ? `СП выбранных получателей (${filteredDepartments.length})`
                          : `Всего подразделений (${filteredDepartments.length})`}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllDepartments}
                          className="hover:text-blue-400 transition-colors cursor-pointer"
                        >
                          Выбрать все
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={handleClearDepartments}
                          className="hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          Снять все
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Список подразделений */}
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#2D3139]/40 p-1">
                    {filteredDepartments.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 text-xs">
                        {availableDepartments.length === 0
                          ? 'Для выбранных получателей нет структурных подразделений в справочнике'
                          : 'Структурные подразделения не найдены'}
                      </div>
                    ) : (
                      filteredDepartments.map((dept) => {
                        const isSelected = recipientDepartmentIds.includes(dept.id);
                        return (
                          <div
                            key={dept.id}
                            onClick={() => toggleDepartment(dept.id)}
                            className={`flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-indigo-600/20 text-[#E0E0E0] font-medium'
                                : 'hover:bg-[#2D3139]/40 text-gray-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 overflow-hidden min-w-0">
                              <div className="text-blue-400 shrink-0">
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                                ) : (
                                  <Square className="w-4 h-4 text-gray-500" />
                                )}
                              </div>
                              <span className="font-mono text-blue-300 px-1.5 py-0.5 rounded bg-blue-950/60 text-[10px] font-bold border border-blue-800/40 shrink-0">
                                {dept.shortName}
                              </span>
                              <span className="text-xs truncate select-none">{dept.name}</span>
                            </div>
                            {dept.organizationName && (
                              <span className="text-[10px] text-gray-400 shrink-0 bg-[#0F1115] px-1.5 py-0.5 rounded border border-[#2D3139] truncate max-w-[140px]">
                                {dept.organizationName}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="p-2 border-t border-[#2D3139] bg-[#171A21] flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsDeptDropdownOpen(false)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Готово
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 6. Путь к файлу/папке и ссылка на СЭД с иконкой вставки из буфера обмена */}
          <div className="space-y-3 min-w-0 w-full">
            {/* Путь к сетевой папке/файлу */}
            <div className="min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                <label className="font-semibold text-gray-300 flex items-center gap-1 min-w-0 truncate text-xs">
                  <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">Путь к документу (гиперссылка на сетевую папку или файл)</span>
                </label>
                {filePath && (
                  <button
                    type="button"
                    onClick={() => setFilePath('')}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                    title="Очистить поле пути"
                  >
                    Очистить
                  </button>
                )}
              </div>
              <div className="flex flex-wrap sm:flex-nowrap gap-2 min-w-0 w-full items-center">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/mnt/network_share/documents/2026/09/doc.pdf или /mnt/network_share/documents/2026/09/"
                  className="flex-1 min-w-0 px-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleBrowseFile}
                    title="Открыть окно операционной среды для выбора конкретного файла"
                    className="px-3 py-2 bg-[#0F1115] hover:bg-[#1F222B] text-gray-300 hover:text-white rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors border border-[#2D3139] cursor-pointer"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-blue-400" />
                    <span>Файл</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    title="Открыть окно операционной среды для выбора папки с файлами"
                    className="px-3 py-2 bg-[#0F1115] hover:bg-[#1F222B] text-gray-300 hover:text-white rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors border border-[#2D3139] cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Папка</span>
                  </button>
                </div>
              </div>
              {/* Индикатор сформированной ссылки: файл или папка */}
              {filePath && (
                <div className="mt-1.5 text-[11px] text-gray-400 flex items-center gap-1.5 min-w-0">
                  {filePath.endsWith('/') || filePath.endsWith('\\') || !/\.[a-zA-Z0-9]{1,8}$/.test(filePath.trim()) ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-emerald-400 font-medium shrink-0">Сформирована ссылка на папку:</span>
                      <span className="font-mono text-gray-300 truncate">{filePath}</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-blue-400 font-medium shrink-0">Сформирована ссылка на файл:</span>
                      <span className="font-mono text-gray-300 truncate">{filePath}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Путь к документу в СЭД с кнопкой/иконкой вставки из буфера обмена */}
            <div className="min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                <label className="font-semibold text-gray-300 flex items-center gap-1 min-w-0 truncate">
                  <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">Путь к документу в СЭД (гиперссылка в формате интернет браузера)</span>
                </label>
                {sedUrl && (
                  <button
                    type="button"
                    onClick={() => setSedUrl('')}
                    className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                  >
                    Очистить
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 min-w-0 w-full">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="url"
                    value={sedUrl}
                    onChange={(e) => setSedUrl(e.target.value)}
                    placeholder="https://sed.company.local/documents/card/12345"
                    className="w-full min-w-0 px-3.5 py-2.5 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs font-mono text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                {/* Иконка / кнопка вставки ссылки из буфера обмена */}
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  title="Вставить ссылку из буфера обмена"
                  className={`px-3.5 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all border cursor-pointer shrink-0 ${
                    pastedFeedback
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#0F1115] hover:bg-[#1F222B] text-gray-300 hover:text-blue-400 border-[#2D3139] hover:border-blue-500/40'
                  }`}
                >
                  {pastedFeedback ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400 animate-in zoom-in-50 duration-150 shrink-0" />
                      <span className="text-emerald-400 font-semibold whitespace-nowrap">Вставлено!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardPaste className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="whitespace-nowrap">Вставить из буфера</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 7. Дополнительные примечания */}
          <div className="min-w-0 w-full">
            <label className="block font-semibold text-gray-300 mb-1 truncate">
              Примечания и комментарии
            </label>
            <input
              type="text"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Дополнительные сведения, резолюция, ответственный исполнитель..."
              className="w-full min-w-0 px-3.5 py-2 bg-[#0F1115] border border-[#2D3139] rounded-xl text-xs text-[#E0E0E0] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
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
