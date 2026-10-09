import type { MemberColor } from '@/types/app';
import { colors } from '@/lib/theme';
import { participantColorName } from '@/lib/familyRoster';

// Web版(`../../../src/lib/uiUtils.ts`)から、ネイティブ側で要るものだけを持ってきたもの。
// 色やリンクの組み立てはWeb固有なので持ってきていない。

type Tone = { background: string; text: string; border: string };

const TONE_BY_COLOR: Record<MemberColor, Tone> = {
  blue: { background: colors.labelDaizoSurface, text: colors.labelDaizoText, border: colors.labelDaizoBorder },
  pink: { background: colors.labelIzumiSurface, text: colors.labelIzumiText, border: colors.labelIzumiBorder },
  emerald: { background: colors.labelGakuSurface, text: colors.labelGakuText, border: colors.labelGakuBorder },
  gray: { background: colors.neutralSurface, text: colors.labelDefaultText, border: colors.border },
};

/**
 * 参加者1人の色分け。色は家族メンバーの色（設定タブの「家族」。lib/familyRoster.ts）、
 * 家族にいない名前は灰。
 */
export const getParticipantColor = (participant: string): Tone =>
  TONE_BY_COLOR[participantColorName(participant)];

/**
 * 予定・タスクの参加者の色分け。参加者がちょうど1人のときだけその人の色にし、
 * 0人または複数（=まとめて関わる）のときは既定の色にする。
 * 主体(owner)が無い古いデータ向けのフォールバックとして getOwnerTone から使う。
 */
export const getParticipantsTone = (
  participants: string[],
): { background: string; text: string; border: string } =>
  getParticipantColor(participants.length === 1 ? participants[0] : '');

/**
 * 予定・タスクの色分け。主体(owner)が決まっていればその人の色にし、
 * 主体が未設定の古いデータは今までどおり参加者の人数で決める。
 */
export const getOwnerTone = (
  owner: string | null,
  participants: string[],
): { background: string; text: string; border: string } =>
  owner !== null ? getParticipantColor(owner) : getParticipantsTone(participants);

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
