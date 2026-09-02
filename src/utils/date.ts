/**
 * Утилиты форматирования дат и времени в соответствии с ТЗ
 */

/**
 * Форматирует дату в формат «дд.мм.гггг_чч.мм.сс»
 * Например: 02.09.2026_14.30.45
 */
export function formatDbTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${day}.${month}.${year}_${hours}.${minutes}.${seconds}`;
}

/**
 * Форматирует дату в формат «дд.мм.гггг» (для отображения в таблицах и карточках)
 */
export function formatDateRussian(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      // Формат YYYY-MM-DD
      const [year, month, day] = parts;
      return `${day.padStart(2, '0')}.${month.padStart(2, '0')}.${year}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  } catch {
    return dateStr || '—';
  }
}

/**
 * Форматирует дату и время в «дд.мм.гггг чч:мм:сс»
 */
export function formatDateTimeRussian(isoStr?: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return isoStr || '—';
  }
}

/**
 * Форматирует размер файла в человекочитаемый вид (Б, КБ, МБ)
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Байт';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Байт', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
