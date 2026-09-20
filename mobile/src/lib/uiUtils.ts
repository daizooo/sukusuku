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
 * 参加者1人の色分け（大造=青 / いづみ=桃 / 岳=翠 / それ以外=灰）。
 */
export const getParticipantColor = (
  participant: string,
): { background: string; text: string; border: string } => {
  switch (participant) {
    case '大造':
      return {
        background: colors.labelDaizoSurface,
        text: colors.labelDaizoText,
        border: colors.labelDaizoBorder,
      };
    case 'いづみ':
      return {
        background: colors.labelIzumiSurface,
        text: colors.labelIzumiText,
        border: colors.labelIzumiBorder,
      };
    case '岳':
      return {
        background: colors.labelGakuSurface,
        text: colors.labelGakuText,
        border: colors.labelGakuBorder,
      };
    default:
      return {
        background: colors.neutralSurface,
        text: colors.labelDefaultText,
        border: colors.border,
      };
  }
};

/**
 * 予定・タスクの参加者の色分け。参加者がちょうど1人のときだけその人の色にし、
 * 0人または複数（=まとめて関わる）のときは既定の色にする。
 */
export const getParticipantsTone = (
  participants: string[],
): { background: string; text: string; border: string } =>
  getParticipantColor(participants.length === 1 ? participants[0] : '');

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

// 保存に失敗したとき、Supabaseが返した理由まで画面に出す。
// 「失敗しました」だけだと、入力のどこが悪いのか利用者にも開発者にも分からないため。
export const describeError = (err: unknown): string => {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && message !== '') return `\n（${message}）`;
  }
  return '';
};
