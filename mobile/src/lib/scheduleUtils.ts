import { startOfDay } from '@/lib/dateUtils';

// 予定まわりの日付の数え方。Web版の `src/components/sukusuku/schedule/utils.ts` から、
// ネイティブ側で要るものだけを持ってきたもの。

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 今日から何日後か。過去なら負。 */
export const diffInDays = (date: Date, today: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / MS_PER_DAY);

/** 日付見出しに添える相対表記。'今日' / '明日' / 'あと3日' / '3日前'。 */
export const formatRelativeDay = (date: Date, today: Date): string => {
  const days = diffInDays(date, today);
  if (days === 0) return '今日';
  if (days === 1) return '明日';
  if (days === -1) return '昨日';
  return days > 0 ? `あと${days}日` : `${-days}日前`;
};
