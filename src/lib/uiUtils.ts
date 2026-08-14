import type { Assignee, ProfileFieldKey, UserProfile } from '@/types/app';

// 担当者ごとのバッジ配色
export const getAssigneeColor = (assignee: Assignee | string): string => {
  switch (assignee) {
    case 'パパ':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ママ':
      return 'bg-pink-100 text-pink-700 border-pink-200';
    case '二人で':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};

// 全角数字を半角に変換
const toHalfWidthDigits = (value: string): string =>
  value.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

// 電話番号らしい文字列かどうかを判定する（設定欄の自由入力項目をtel:リンク化するため）
export const isPhoneNumberLike = (value: string): boolean => {
  const trimmed = toHalfWidthDigits(value.trim());
  if (!trimmed) return false;
  if (!/^[0-9\-‐－ー()（）+ ]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits.length >= 9 && digits.length <= 11;
};

// tel:リンク用に電話番号を正規化する
export const toTelHref = (value: string): string => {
  const digits = toHalfWidthDigits(value.trim()).replace(/[^0-9+]/g, '');
  return `tel:${digits}`;
};

// 設定タブの各セクションはユーザーが自由に項目を追加・削除できるため、
// 生後日数の計算やホーム画面のクイック発信のように特定の値を必要とする機能は、
// 項目の並び順やラベルではなくkey(予約識別子)を頼りに値を探す。
export const getProfileFieldValue = (profile: UserProfile, key: ProfileFieldKey): string => {
  const field = [...profile.childFields, ...profile.familyFields, ...profile.emergencyFields].find(
    (f) => f.key === key,
  );
  return field?.value ?? '';
};
