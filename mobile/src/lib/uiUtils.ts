import type { ProfileFieldKey, UserProfile } from '@/types/app';
import { colors } from '@/lib/theme';

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

/**
 * 予定のラベルの色。Web版の `getLabelColor` と同じ割り当て
 * （パパ=青 / ママ=桃 / 家族=翠 / それ以外=灰）。
 * Web版はTailwindのクラス名を返すが、こちらは色そのものを返す。
 */
export const getLabelColors = (
  label: string,
): { background: string; text: string; border: string } => {
  switch (label) {
    case 'パパ':
      return {
        background: colors.labelPapaSurface,
        text: colors.labelPapaText,
        border: colors.labelPapaBorder,
      };
    case 'ママ':
      return {
        background: colors.labelMamaSurface,
        text: colors.labelMamaText,
        border: colors.labelMamaBorder,
      };
    case '家族':
      return {
        background: colors.labelFamilySurface,
        text: colors.labelFamilyText,
        border: colors.labelFamilyBorder,
      };
    default:
      return {
        background: colors.neutralSurface,
        text: colors.labelDefaultText,
        border: colors.border,
      };
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
