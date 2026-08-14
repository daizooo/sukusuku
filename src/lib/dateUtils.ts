// 日付関連のユーティリティ関数群

export const calculateTargetDate = (
  baseDateStr: string,
  daysToAdd: number,
): Date | null => {
  if (!baseDateStr) return null;
  const date = parseDateString(baseDateStr);
  if (!date) return null;
  date.setDate(date.getDate() + daysToAdd);
  return date;
};

// 'YYYY-MM-DD' をローカルタイムの Date として解釈する。
// new Date('2026-08-15') は UTC 深夜として解釈されるため、
// タイムゾーンによっては前日になってしまう。それを避ける。
export const parseDateString = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return isNaN(date.getTime()) ? null : date;
};

// Date を 'YYYY-MM-DD' へ（ローカルタイム基準）
export const toDateString = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

export const formatDateString = (dateObj: Date | null): string => {
  if (!dateObj) return '未設定';
  return `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export const formatDateWithWeekday = (dateObj: Date | null): string => {
  if (!dateObj) return '未設定';
  return `${dateObj.getMonth() + 1}月${dateObj.getDate()}日 (${WEEKDAY_LABELS[dateObj.getDay()]})`;
};

export const formatTimeString = (dateObj: Date | null): string => {
  if (!dateObj) return '';
  return `${String(dateObj.getHours()).padStart(2, '0')}:${String(
    dateObj.getMinutes(),
  ).padStart(2, '0')}`;
};

// DB の time 型は 'HH:MM:SS' で返るため 'HH:MM' に整える
export const normalizeTime = (time: string | null): string | null => {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  if (hour === undefined || minute === undefined) return null;
  return `${hour.padStart(2, '0')}:${minute}`;
};

// 予定の時刻表示。終日なら「終日」
export const formatTimeRange = (
  startTime: string | null,
  endTime: string | null,
): string => {
  if (!startTime) return '終日';
  return endTime ? `${startTime} - ${endTime}` : startTime;
};

export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

export const getFirstDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month, 1).getDay();
};

// 時刻を含まない「その日」を表す Date を返す
export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const isSameDay = (a: Date | null, b: Date | null): boolean => {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

// リマインダーの選択肢（分単位。null は通知なし）
export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '通知しない' },
  { value: 0, label: '予定の時刻' },
  { value: 10, label: '10分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '前日' },
  { value: 2880, label: '2日前' },
];

export const formatReminder = (minutes: number | null): string => {
  const option = REMINDER_OPTIONS.find((o) => o.value === minutes);
  return option ? option.label : `${minutes}分前`;
};
