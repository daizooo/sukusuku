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

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

/**
 * <input type="date"> と <input type="time"> の値を1つの Date にまとめる。
 * 日付が読めないときは fallback の日付を使う。
 */
export const parseDateTimeInput = (
  dateValue: string,
  timeValue: string,
  fallback: Date,
): Date => parseTimeInput(timeValue, parseDateString(dateValue) ?? fallback);

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

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const isSameDay = (a: Date | null, b: Date | null): boolean => {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

// --- カレンダー表示用 ---

// その週の日曜0:00を返す（月グリッド・週表示の起点）
export const startOfWeek = (date: Date): Date => {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
};

// 月をまたいだ「その月の1日」。月末日の繰り上がりを避けるため日は1で作る。
export const addMonths = (date: Date, months: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);

export const isSameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// 日表示の見出し。年が変わるときだけ年を出す。
export const formatDateHeading = (date: Date, today: Date): string => {
  const base = formatDateWithWeekday(date);
  return date.getFullYear() === today.getFullYear() ? base : `${date.getFullYear()}年${base}`;
};

// 誕生日から対象日までの満月齢（生後ヶ月）。
// どちらかの日付が不正、または対象日が誕生日より前なら null を返す。
export const monthsSinceBirth = (birthDateStr: string, targetDateStr: string): number | null => {
  const birth = parseDateString(birthDateStr);
  const target = parseDateString(targetDateStr);
  if (!birth || !target || target < birth) return null;
  let months =
    (target.getFullYear() - birth.getFullYear()) * 12 + (target.getMonth() - birth.getMonth());
  // 応当日を過ぎていなければ1ヶ月引く（例: 4/10生まれの5/9時点は0ヶ月）
  if (target.getDate() < birth.getDate()) months -= 1;
  return months < 0 ? 0 : months;
};
