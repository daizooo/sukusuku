import { useSyncExternalStore } from 'react';
import type { Member, MemberColor } from '@/types/app';

// 予定の参加者・主体に出す家族の名前と色（docs/family-app.md §3.2）。
//
// 予定（tasks.participants / owner）は家族の表示名で持つ。名前の並びと色は
// 家族メンバー（family_members）から決め、コードには直書きしない。
// 表示名を変えると、DBのトリガーが予定の名前も書き換える（0048）。
//
// 画面のあちこち（予定の一覧・カレンダー・入力画面）から読むので、読み込んだ一覧を
// ここに1つだけ置き、変わったら読んでいる画面を描き直す。

/** 家族メンバーを読み込む前に出す既定の並びと色（いまの白石家の3人）。 */
const DEFAULT_ROSTER: { displayName: string; color: MemberColor }[] = [
  { displayName: '大造', color: 'blue' },
  { displayName: 'いづみ', color: 'pink' },
  { displayName: '岳', color: 'emerald' },
];

let roster: Member[] = [];
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getRoster = () => roster;

/** 家族メンバーを読み込んだ・直したときに呼ぶ。 */
export const setFamilyRoster = (members: Member[]): void => {
  roster = members;
  listeners.forEach((listener) => listener());
};

/** 予定の参加者として選べる名前（並び順）。 */
export const participantNames = (members: Member[] = roster): string[] =>
  members.length > 0
    ? members.map((member) => member.displayName)
    : DEFAULT_ROSTER.map((member) => member.displayName);

/** その名前の人の色。家族にいない名前は灰色。 */
export const participantColorName = (name: string, members: Member[] = roster): MemberColor =>
  (members.length > 0 ? members : DEFAULT_ROSTER).find((member) => member.displayName === name)
    ?.color ?? 'gray';

/** ログインしている人の表示名（新しい予定の主体の初期値）。分からなければ null。 */
export const myParticipantName = (userId: string, members: Member[] = roster): string | null =>
  members.find((member) => member.userId === userId)?.displayName ?? null;

/** 画面で使う。家族メンバーが変わると描き直される。 */
export const useFamilyRoster = (): Member[] => useSyncExternalStore(subscribe, getRoster, getRoster);
