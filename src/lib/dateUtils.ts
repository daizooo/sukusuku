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

/** 経過ミリ秒を mm:ss（1時間以上は h:mm:ss）に整形する。 */
export const formatDurationClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** 経過ミリ秒を「12分」「1時間5分」のような記録用ラベルにする。 */
export const formatDurationLabel = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
};
