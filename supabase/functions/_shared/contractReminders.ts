// 契約の更新日のお知らせ（その他タブ。docs/contracts.md §6）で、「いつ・何を・誰に知らせるか」を決める部分。
//
// 更新日の N 日前（N は契約の notify_days）の日が、その端末へ前回送った日の翌日から今日までに来た契約を、
// 毎朝1回まとめて送る。呼び出し側（send-contract-reminders）は取ってきた契約とこの関数を突き合わせて、
// 文面を作るだけにしてある（Edge Functionの外で試せるよう、Denoにもネットワークにも依存しない）。
// npm run test:contract-reminders
//
// 備蓄の期限のお知らせ（stockExpiry.ts）と同じ作り。**日付で決めるので契約の行ごとの「知らせた」印は持たない**。

import { addDays } from './stockExpiry.ts';

export { addDays, todayJst } from './stockExpiry.ts';

export type ContractKind = 'rent' | 'insurance' | 'subscription' | 'other';

/** お知らせの対象になる契約。contracts から引いた列。 */
export interface ContractRow {
  id: string;
  family_id: string;
  created_by: string | null;
  kind: ContractKind;
  title: string;
  /** 更新日（YYYY-MM-DD）。無い契約は知らせない。 */
  renews_on: string | null;
  /** 更新日の何日前に知らせるか。空ならお知らせなし。 */
  notify_days: number[];
  /**
   * 更新日を足した・直した日（YYYY-MM-DD）。この日より後に来る節目だけ知らせる
   * （更新したあとに、新しい更新日のすでに過ぎた節目を知らせないため）。null は制限なし。
   */
  notify_after: string | null;
  /** 見せる相手（family_members.id）。作った本人は含まれていなくても見える。 */
  visible_member_ids: string[];
}

/** お知らせを受け取る人（端末の持ち主）。 */
export interface Viewer {
  userId: string;
  familyId: string;
  /** 自分の family_members.id。メンバーとして登録されていなければ null。 */
  memberId: string | null;
}

export interface ContractNotice {
  contract: ContractRow;
  /** 更新日まであと何日（今日が更新日なら 0）。 */
  daysLeft: number;
}

/** 画面（contractUtils.ts の KIND_LABEL）と同じ呼び方。 */
export const KIND_LABEL: Record<ContractKind, string> = {
  rent: '賃貸',
  insurance: '保険',
  subscription: 'サブスク',
  other: 'その他',
};

/**
 * その契約が見える人か（RLS の contracts_visible と同じ条件。0096_contracts.sql）。
 * Edge Function は service_role で動いて RLS が効かないので、宛先をここで絞る。
 */
export function canSee(contract: Pick<ContractRow, 'family_id' | 'created_by' | 'visible_member_ids'>, viewer: Viewer): boolean {
  if (contract.family_id !== viewer.familyId) return false;
  if (contract.created_by !== null && contract.created_by === viewer.userId) return true;
  return viewer.memberId !== null && contract.visible_member_ids.includes(viewer.memberId);
}

/** YYYY-MM-DD の差（to - from）の日数。 */
export function daysBetween(from: string, to: string): number {
  const ms = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/**
 * まだ知らせていない分のうち、知らせる日に当たった契約を拾う。
 *
 * 「更新日の N 日前の日」が (since, today] に入った契約が対象。since は前回までに知らせ終えた日
 * （含まない）で、実行が飛んだ日があっても次の実行でまとめて拾える。
 *
 * - 更新日を足した・直した日（notify_after）以前の節目は知らせない。更新した直後に、
 *   新しい更新日のすでに過ぎた節目（例: 1か月進めたサブスクの30日前）が届かないようにする
 * - 更新日の無いもの・更新日を過ぎたもの（一覧のバッジが知らせる）・お知らせの日数が空のもの・
 *   その人に見えないものは対象にしない
 * - 複数の節目が窓に入っても（実行が長く飛んだとき）、1契約につき1件にする
 * - 更新日が近い順に並べる
 */
export function collectNotices(
  contracts: readonly ContractRow[],
  viewer: Viewer,
  sinceExclusive: string,
  today: string,
): ContractNotice[] {
  const inWindow = (day: string) => day > sinceExclusive && day <= today;
  const notices: ContractNotice[] = [];

  for (const contract of contracts) {
    if (!contract.renews_on || contract.renews_on < today) continue;
    if (!canSee(contract, viewer)) continue;
    const renewsOn = contract.renews_on;
    const after = contract.notify_after;
    const hit = contract.notify_days.some((days) => {
      if (!Number.isInteger(days) || days < 0) return false;
      const day = addDays(renewsOn, -days);
      return inWindow(day) && (after === null || day > after);
    });
    if (hit) notices.push({ contract, daysLeft: daysBetween(today, renewsOn) });
  }

  return notices.sort((a, b) =>
    a.contract.renews_on === b.contract.renews_on
      ? a.contract.title.localeCompare(b.contract.title, 'ja')
      : a.contract.renews_on! < b.contract.renews_on!
        ? -1
        : 1,
  );
}

/** 本文に並べる件数。残りは「ほかn件」にする。 */
const MAX_LINES = 3;

const monthDay = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

const leftText = (daysLeft: number): string => (daysLeft === 0 ? '今日が更新日' : `あと${daysLeft}日`);

/**
 * お知らせの文面。いちばん急ぐ契約を見出しにして、2件目以降は「ほかn件」にまとめる
 * （例: 「◯◯マンションの更新まで30日 ほか1件」）。本文には契約ごとに1行ずつ並べる。
 */
export function buildMessage(notices: readonly ContractNotice[]): { title: string; body: string } {
  const [first, ...others] = notices;
  const name = first.contract.title;
  const head = first.daysLeft === 0 ? `${name}の更新日は今日です` : `${name}の更新まで${first.daysLeft}日`;
  const title = others.length > 0 ? `${head} ほか${others.length}件` : head;

  const lines = notices
    .slice(0, MAX_LINES)
    .map(
      (notice) =>
        `${KIND_LABEL[notice.contract.kind]} ${notice.contract.title}（${monthDay(notice.contract.renews_on!)}・${leftText(notice.daysLeft)}）`,
    );
  const rest = notices.length - lines.length;
  if (rest > 0) lines.push(`ほか${rest}件`);
  return { title, body: lines.join('\n') };
}
