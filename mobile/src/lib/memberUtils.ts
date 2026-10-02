import type { Member } from '@/types/app';
import { monthsSinceBirth, parseDateString, toDateString } from '@/lib/dateUtils';

// 家族メンバーの表示まわり。年齢は保存せず、誕生日から毎回出す（docs/family-app.md §3）。

/** 「3歳」「4ヶ月」。誕生日が未設定・未来なら空文字。 */
export const formatAge = (birthDate: string, today: Date = new Date()): string => {
  if (!birthDate) return '';
  const months = monthsSinceBirth(birthDate, toDateString(today));
  if (months === null) return '';
  return months < 12 ? `${months}ヶ月` : `${Math.floor(months / 12)}歳`;
};

/** 氏名（姓 名）。どちらも未入力なら空文字。 */
export const formatFullName = (member: Pick<Member, 'familyName' | 'givenName'>): string =>
  [member.familyName, member.givenName].filter((part) => part !== '').join(' ');

/** 自分の行は自分で、保護者なら全員分を編集できる（RLSと同じ判定。0046）。 */
export const canEditMember = (member: Member, me: Member | null): boolean =>
  me !== null && (me.isGuardian || member.id === me.id);

/**
 * 育児タブの見出しに出す子の月齢。「生後123日目（4ヶ月2日）」「誕生まであと5日」。
 * 1ヶ月未満は「生後20日目」だけ。誕生日が未設定なら空文字。
 */
export const formatBabyAge = (birthDate: string, today: Date = new Date()): string => {
  const birth = parseDateString(birthDate);
  if (!birth) return '';
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const DAY_MS = 1000 * 60 * 60 * 24;
  const days = Math.round((day.getTime() - birth.getTime()) / DAY_MS);
  if (days < 0) return `誕生まであと${-days}日`;
  const months = monthsSinceBirth(birthDate, toDateString(day)) ?? 0;
  if (months === 0) return `生後${days}日目`;
  // 月の応当日からの日数（例: 4/10生まれの8/12は「4ヶ月2日」）
  const anchor = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
  const rest = Math.round((day.getTime() - anchor.getTime()) / DAY_MS);
  return `生後${days}日目（${months}ヶ月${rest}日）`;
};
