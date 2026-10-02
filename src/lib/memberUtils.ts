import type { Member } from '@/types/app';
import { monthsSinceBirth, toDateString } from '@/lib/dateUtils';

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
