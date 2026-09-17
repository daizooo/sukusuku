import type { ProfileFieldKey, UserProfile } from '@/types/app';

// Web版(`../../../src/lib/uiUtils.ts`)から、ネイティブ側で要るものだけを持ってきたもの。
// 色やリンクの組み立てはWeb固有なので持ってきていない。

// 設定タブの各セクションはユーザーが自由に項目を追加・削除できるため、
// 生後日数の計算やホーム画面のクイック発信のように特定の値を必要とする機能は、
// 項目の並び順やラベルではなくkey(予約識別子)を頼りに値を探す。
export const getProfileFieldValue = (profile: UserProfile, key: ProfileFieldKey): string => {
  const field = [...profile.childFields, ...profile.familyFields, ...profile.emergencyFields].find(
    (f) => f.key === key,
  );
  // keyを持つ項目は内容を1つだけ持つ想定だが、念のため最初の入力済みの内容を返す。
  return field?.values.find((value) => value.trim() !== '') ?? '';
};
