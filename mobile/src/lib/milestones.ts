// 生後日数の節目。カレンダーに小さく表示して「そろそろ何かを決める日」の目印にする。
//
// 行事名（お宮参り・お食い初めなど）は出さず、日数だけを示す。
// 実際に行事を行うかどうかは家庭ごとに違うため、予定として自動追加もしない。
// 節目の日に予定を入れたくなったら、その日から手動で追加する。

import { parseDateString, startOfDay } from '@/lib/dateUtils';

// 生後日数で決まる節目
const DAY_MILESTONES = [7, 30, 50, 100, 180] as const;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** 誕生日からの経過日数。生まれた日を0日目とする。 */
export const getAgeInDaysAt = (birthDate: Date, date: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(birthDate).getTime()) / MS_PER_DAY);

/**
 * その日が節目なら短いラベルを返す。節目でなければ null。
 * 誕生日 > 生後日数 > 月齢 の順に優先する（同じ日に重なったときに細かい方を出さない）。
 */
export const getMilestoneLabel = (birthDateStr: string, date: Date): string | null => {
  const birth = parseDateString(birthDateStr);
  if (!birth) return null;

  const days = getAgeInDaysAt(birth, date);
  if (days <= 0) return null;

  const isSameMonthDay = date.getMonth() === birth.getMonth() && date.getDate() === birth.getDate();
  if (isSameMonthDay) {
    const years = date.getFullYear() - birth.getFullYear();
    if (years >= 1) return `${years}歳`;
  }

  if ((DAY_MILESTONES as readonly number[]).includes(days)) return `生後${days}日`;

  // 1歳までは毎月の月齢も節目として出す（誕生日と同じ日）
  if (date.getDate() === birth.getDate() && days < 365) {
    const months = (date.getFullYear() - birth.getFullYear()) * 12 + (date.getMonth() - birth.getMonth());
    if (months >= 1) return `生後${months}ヶ月`;
  }

  return null;
};

/** 日表示の見出しに出す月齢。'生後30日' / '1歳2ヶ月'。誕生日前は '誕生まであと◯日'。 */
export const formatBabyAgeAt = (birthDateStr: string, date: Date): string | null => {
  const birth = parseDateString(birthDateStr);
  if (!birth) return null;

  const days = getAgeInDaysAt(birth, date);
  if (days < 0) return `誕生まであと${Math.abs(days)}日`;
  if (days < 62) return `生後${days}日`;

  let months = (date.getFullYear() - birth.getFullYear()) * 12 + (date.getMonth() - birth.getMonth());
  if (date.getDate() < birth.getDate()) months -= 1;
  if (months < 12) return `生後${months}ヶ月`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}歳` : `${years}歳${rest}ヶ月`;
};
