// 予定・タスクの通知を、どの端末へ送るか。
//
// 共有の予定は、その家族の全端末へ送る。「自分だけ」の予定・タスク（is_private）は、
// 画面でも作成者にしか見えない（RLS。0040）ので、通知も作成した本人の端末だけへ送る。
// 通知にはタイトルと場所が入るため、他の家族の端末へ送ると中身が漏れる。
//
// 配信は service_role で動きRLSが効かないので、ここで自前で絞る。

/** 送り先の端末のうち、判定に使う列。 */
export interface RecipientCandidate {
  /** 端末の持ち主（push_subscriptions.user_id）。 */
  user_id: string;
}

/** 通知の対象の予定のうち、判定に使う列。 */
export interface PrivacyScoped {
  is_private?: boolean | null;
  /** 作成者。作成者のユーザーが消えると null になる（0040）。 */
  created_by?: string | null;
}

/**
 * row の通知を送ってよい端末だけを返す。
 *
 * - 共有（is_private が true でない）: 渡された端末すべて
 * - 「自分だけ」: 作成者の端末だけ。作成者が分からない（null）ときは誰にも送らない
 *   （迷ったら送らない側に倒す。通知が届かないほうが、他人に見えるより害が小さい）
 */
export function recipientsFor<T extends RecipientCandidate>(row: PrivacyScoped, candidates: readonly T[]): T[] {
  if (row.is_private !== true) return [...candidates];
  if (!row.created_by) return [];
  return candidates.filter((candidate) => candidate.user_id === row.created_by);
}
