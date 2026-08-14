// 日付関連のユーティリティ関数群

export const calculateTargetDate = (
  baseDateStr: string,
  daysToAdd: number,
): Date | null => {
  if (!baseDateStr) return null;
  const date = new Date(baseDateStr);
  if (isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + daysToAdd);
  return date;
};

export const formatDateString = (dateObj: Date | null): string => {
  if (!dateObj) return '未設定';
  return `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
};

export const formatTimeString = (dateObj: Date | null): string => {
  if (!dateObj) return '';
  return `${String(dateObj.getHours()).padStart(2, '0')}:${String(
    dateObj.getMinutes(),
  ).padStart(2, '0')}`;
};

/** <input type="time"> に渡す "HH:MM" 形式へ。 */
export const toTimeInputValue = (dateObj: Date): string => formatTimeString(dateObj);

/** <input type="time"> の値を Date に戻す。日付は base（既定は今日）を使う。 */
export const parseTimeInput = (value: string, base: Date = new Date()): Date => {
  const [hours, minutes] = value.split(':').map(Number);
  const result = new Date(base);
  if (Number.isFinite(hours) && Number.isFinite(minutes)) {
    result.setHours(hours, minutes, 0, 0);
  }
  return result;
};

export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

export const getFirstDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month, 1).getDay();
};
