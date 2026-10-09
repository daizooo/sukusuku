import type { MemberColor } from '@/types/app';
import { participantColorName } from '@/lib/familyRoster';

// 参加者1人のバッジ配色（家族メンバーの色ごと）。
const TONE_BY_COLOR: Record<MemberColor, string> = {
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  pink: 'bg-red-100 text-red-700 border-red-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
};

const DOT_BY_COLOR: Record<MemberColor, string> = {
  blue: 'bg-blue-500',
  pink: 'bg-red-500',
  emerald: 'bg-emerald-500',
  gray: 'bg-gray-400',
};

// 参加者1人の色分け。色は家族メンバーの色（設定タブの「家族」。lib/familyRoster.ts）、
// 家族にいない名前は灰。
export const getParticipantColor = (participant: string): string =>
  TONE_BY_COLOR[participantColorName(participant)];

// カレンダーのドット表示用（参加者1人の塗り色）
export const getParticipantDotColor = (participant: string): string =>
  DOT_BY_COLOR[participantColorName(participant)];

// 予定・タスクの参加者の色分け。参加者がちょうど1人のときだけその人の色にし、
// 0人または複数（=まとめて関わる）のときは既定の色にする。
// 主体(owner)が無い古いデータ向けのフォールバックとして getOwnerTone から使う。
export const getParticipantsTone = (participants: string[]): string =>
  getParticipantColor(participants.length === 1 ? participants[0] : '');

// 予定・タスクの色分け。主体(owner)が決まっていればその人の色にし、
// 主体が未設定の古いデータは今までどおり参加者の人数で決める。
export const getOwnerTone = (owner: string | null, participants: string[]): string =>
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
export const toTelHref = (value: string): string => {
  const digits = toHalfWidthDigits(value.trim()).replace(/[^0-9+]/g, '');
  return `tel:${digits}`;
};
