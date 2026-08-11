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

export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

export const getFirstDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month, 1).getDay();
};
