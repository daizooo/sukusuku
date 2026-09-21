// 「次の授乳はいつか」を求める。
//
// 授乳中は手が離せず、終わったころには次が何時だったか分からなくなる。
// 前回の授乳（記録の時刻＝飲ませ始めた時刻）から一定の間隔をおいた時刻を
// 「次の目安」として出し、夫婦のどちらが見ても同じ時刻が出るようにする。
//
// 間隔は家族ごとの設定(feeding_settings)で、既定は3時間。
// 赤ちゃんが欲しがるタイミングが本来の正解なので、あくまで目安として扱う。

/** 設定が無い家族の既定値。新生児〜生後数ヶ月の授乳間隔の目安。 */
export const DEFAULT_FEEDING_INTERVAL_MINUTES = 180;

/** 設定で選べる間隔。2時間〜4時間を30分刻みで。 */
export const FEEDING_INTERVAL_OPTIONS = [120, 150, 180, 210, 240];

/** 180 -> 「3時間」 / 150 -> 「2時間30分」 / 45 -> 「45分」 */
export const formatMinutesText = (minutes: number): string => {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
};

export interface FeedingSchedule {
  /** 前回の授乳の時刻。 */
  lastFedAt: Date;
  /** 次の目安の時刻。 */
  dueAt: Date;
  /** 目安までの残り(分)。切り上げ。目安を過ぎていれば0。 */
  remainingMinutes: number;
  /** 目安を過ぎてからの経過(分)。切り捨て。まだなら0。 */
  overdueMinutes: number;
  isOverdue: boolean;
  /** 前回からいまへの進み具合(0〜1)。目安を過ぎたら1。 */
  progress: number;
}

/** 前回の授乳が無ければ null（目安を出しようがない）。 */
export const nextFeedingSchedule = (
  lastFedAt: Date | null,
  intervalMinutes: number,
  now: number,
): FeedingSchedule | null => {
  if (!lastFedAt) return null;
  const totalMs = Math.max(1, intervalMinutes) * 60_000;
  const dueAt = new Date(lastFedAt.getTime() + totalMs);
  const remainingMs = dueAt.getTime() - now;
  const elapsedMs = now - lastFedAt.getTime();
  return {
    lastFedAt,
    dueAt,
    remainingMinutes: remainingMs > 0 ? Math.ceil(remainingMs / 60_000) : 0,
    overdueMinutes: remainingMs > 0 ? 0 : Math.floor(-remainingMs / 60_000),
    isOverdue: remainingMs <= 0,
    progress: Math.min(1, Math.max(0, elapsedMs / totalMs)),
  };
};

// ここから下は「まだ記録に入っていない授乳」の扱い。
//
// 母乳はストップウォッチを止めたあと、入力画面で保存して初めて記録(care_logs)になる。
// 止めてから保存するまでには数十分の開きが出ることがあり、その間の「前回の授乳」は
// 1つ前のままに見える。通知の側はこの隙間を手当てしてあるが(0027・send-feeding-reminders)、
// 画面はずっと記録だけを見ていたため、飲ませ終えた直後でも目安を過ぎた赤い表示のまま
// だった（測った端末でも、パートナーの端末でも）。
//
// そこで、計測中・記録待ちのぶん(nursing_alarms)も前回の授乳として扱う。

/** 置き去りの印を信じないための古さの上限。サーバー側(send-nursing-alarms)と合わせている。 */
const NURSING_MAX_ELAPSED_MINUTES = 90;
const NURSING_MAX_PENDING_MINUTES = 60;

/** まだ記録に入っていない授乳（計測中、または測り終えて記録待ち）。 */
export interface PendingNursing {
  /** 飲ませ始めた時刻の目安（計測を始めた時刻）。 */
  startedAt: Date;
  /** 計測を止めた時刻。まだ測っている間は null。 */
  stoppedAt: Date | null;
}

/**
 * 家族が預けている印から、いま数えるべき1件を選ぶ。
 *
 * 夫婦の端末が同時に印を持つことは、ふつうは無い。それでも両方あるときは
 * 「まだ測っている」ほうを優先し、同じ種類なら新しいほうを採る。
 * 古すぎる印（サーバーの片付けが追いつく前の行）は無いものとして落とす。
 */
export const activePendingNursing = <T extends PendingNursing>(
  states: readonly T[],
  now: number,
): T | null => {
  const fresh = states.filter((state) => {
    const limit = state.stoppedAt ? NURSING_MAX_PENDING_MINUTES : NURSING_MAX_ELAPSED_MINUTES;
    const since = (state.stoppedAt ?? state.startedAt).getTime();
    return Number.isFinite(since) && now - since <= limit * 60_000;
  });
  if (fresh.length === 0) return null;
  return fresh.reduce((best, state) => {
    // 計測中が1つでもあれば、そちらが「いまの授乳」。
    if (!best.stoppedAt !== !state.stoppedAt) return best.stoppedAt ? state : best;
    return state.startedAt.getTime() > best.startedAt.getTime() ? state : best;
  });
};

/** 画面に出す「前回の授乳」。記録に入る前のぶんも含めて決めたもの。 */
export interface LastFeeding {
  /** 目安の起点。いま飲ませている最中なら、まだ終わっていないので null。 */
  lastFedAt: Date | null;
  /** いま飲ませている最中。 */
  isNursing: boolean;
  /** 飲ませ終えたが、まだ記録に入っていない。 */
  isPendingRecord: boolean;
}

/**
 * 記録と「記録に入る前の授乳」から、前回の授乳を決める。
 *
 * 保存が済めば印は消えるが、消えたことがこちらに届くまでには少し間がある。
 * その授乳が始まったあとに授乳の記録が入っていれば、それが保存されたぶんと見て
 * 印は使わない（同じ授乳を二重に数えて目安が後ろへずれないようにする）。
 */
export const resolveLastFeeding = (
  lastLoggedAt: Date | null,
  pending: PendingNursing | null,
): LastFeeding => {
  const isRecorded =
    pending !== null &&
    lastLoggedAt !== null &&
    lastLoggedAt.getTime() >= pending.startedAt.getTime();
  if (!pending || isRecorded) {
    return { lastFedAt: lastLoggedAt, isNursing: false, isPendingRecord: false };
  }
  if (!pending.stoppedAt) {
    return { lastFedAt: null, isNursing: true, isPendingRecord: false };
  }
  return { lastFedAt: pending.stoppedAt, isNursing: false, isPendingRecord: true };
};

/** 「次の授乳の目安」の表示に要るものをまとめて渡すための入れ物。 */
export interface NextFeedingInfo {
  /** 前回の授乳の記録の時刻。まだ記録が無ければ null。 */
  lastFedAt: Date | null;
  /** まだ記録に入っていない授乳。あればこちらを前回の授乳として扱う。 */
  pendingNursing: PendingNursing | null;
  intervalMinutes: number;
  isLoading: boolean;
}
