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

// 記録し忘れて大きく空いた分は平均を引っ張るだけなので、数えない。
const MAX_COUNTED_GAP_MINUTES = 360;
// 少ない回数の平均は日によってぶれるため、これだけ溜まってから出す。
const MIN_COUNTED_GAPS = 3;

/**
 * 最近の授乳間隔の平均(分)。設定した間隔が実際と合っているかの目安に出す。
 * 判断材料が足りなければ null。
 *
 * @param feedTimes 授乳の時刻。新しい順。
 */
export const averageFeedingIntervalMinutes = (feedTimes: Date[]): number | null => {
  const gaps: number[] = [];
  for (let i = 0; i + 1 < feedTimes.length; i += 1) {
    const gap = (feedTimes[i].getTime() - feedTimes[i + 1].getTime()) / 60_000;
    if (gap > 0 && gap <= MAX_COUNTED_GAP_MINUTES) gaps.push(gap);
  }
  if (gaps.length < MIN_COUNTED_GAPS) return null;
  return Math.round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length);
};

/** 「次の授乳の目安」の表示に要るものをまとめて渡すための入れ物。 */
export interface NextFeedingInfo {
  /** 前回の授乳の時刻。まだ記録が無ければ null。 */
  lastFedAt: Date | null;
  /** 前回の授乳の見出し（「母乳」など）。 */
  lastFedTitle: string;
  intervalMinutes: number;
  /** 最近の実績の平均(分)。足りなければ null。 */
  averageIntervalMinutes: number | null;
  isLoading: boolean;
}
