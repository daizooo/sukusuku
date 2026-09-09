// 用件が済んだお知らせを、端末から消す。
//
// Web Pushで出したお知らせは、タップするか手で払うまで残り続ける。そのため
// 「妻が授乳を記録したのに、夫の端末には『そろそろ次の授乳』が出たまま」
// 「アプリをホーム画面から開いても、お知らせだけがいつまでも残る」ことが起きる。
//
// そこで、アプリを開いた・前面に戻した・記録を触ったときに、いま残っている
// お知らせを見て、もう済んでいるものをこちらから閉じる。
//
// 済んだかどうかは、届いたお知らせの中身ではなく「いまのデータ」で判断する。
// 相手の端末で記録された分もこちらのデータには入っているので、これなら
// どちらが記録しても両方の端末から消える。

/**
 * お知らせに付くタグ（＝お知らせの種類）。組み立て側は public/sw.js。
 * sw.js はビルドを通さない静的ファイルで import できないため、同じ値を
 * こちらにも置いている（どちらかを変えるときは両方揃えること）。
 */
export const NOTIFICATION_TAG = {
  /** 授乳の経過時間のお知らせ。 */
  nursing: 'nursing-alarm',
  /** 次の授乳の目安のお知らせ。 */
  feeding: 'feeding-reminder',
  /** 朝・夕の検温のお知らせ。 */
  temperature: 'temperature-reminder',
} as const;

/** 予定のリマインダーは、予定ごとに `task-<id>` のタグが付く。 */
const TASK_TAG_PREFIX = 'task-';

const DAY_MS = 24 * 60 * 60_000;

/** 検温の時刻の設定（'HH:mm'）。 */
export interface TemperatureSlotTimes {
  morningTime: string;
  eveningTime: string;
}

/** お知らせが済んだかを決める材料。 */
export interface NotificationSubjects {
  /** 次の授乳の目安をもう過ぎているか（feedingSchedule.ts で求めたもの）。 */
  isFeedingDue: boolean;
  /** 記録前の授乳が端末に残っているか（計測中・計測後の記録待ちを含む）。 */
  hasNursingSession: boolean;
  /** 直近の体温の記録の時刻。まだ記録が無ければ null。 */
  lastTemperatureAt: Date | null;
  temperatureTimes: TemperatureSlotTimes;
  /** 済んだ予定のid。 */
  doneTaskIds: readonly string[];
  now: number;
}

/** 'HH:mm' を、その日の時刻(ミリ秒)にする。 */
const timeOnDay = (base: Date, hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const at = new Date(base);
  at.setHours(hours || 0, minutes || 0, 0, 0);
  return at.getTime();
};

/**
 * 直近に過ぎた検温の時刻。出ているお知らせは必ずこの回のものなので
 * （同じタグで差し替わるため）、これより後に測っていれば済んでいる。
 */
const lastTemperatureSlotAt = (times: TemperatureSlotTimes, now: number): number => {
  const base = new Date(now);
  const today = [timeOnDay(base, times.morningTime), timeOnDay(base, times.eveningTime)];
  // 今日の朝の分もまだ来ていない時間帯なら、前の日の夕方の分が直近になる。
  const candidates = [...today, ...today.map((at) => at - DAY_MS)].filter((at) => at <= now);
  return Math.max(...candidates);
};

/** このタグのお知らせは、もう用が済んでいるか。知らないタグは触らない。 */
export const isSettledNotification = (tag: string, subjects: NotificationSubjects): boolean => {
  if (tag === NOTIFICATION_TAG.nursing) {
    // 記録（またはリセット）まで済めば、計測の残りは無くなる。
    return !subjects.hasNursingSession;
  }

  if (tag === NOTIFICATION_TAG.feeding) {
    // 授乳を記録すれば次の目安は先へ動く。目安がまだ先なら、このお知らせは役目を終えている。
    return !subjects.isFeedingDue;
  }

  if (tag === NOTIFICATION_TAG.temperature) {
    if (!subjects.lastTemperatureAt) return false;
    return (
      subjects.lastTemperatureAt.getTime() >=
      lastTemperatureSlotAt(subjects.temperatureTimes, subjects.now)
    );
  }

  if (tag.startsWith(TASK_TAG_PREFIX)) {
    return subjects.doneTaskIds.includes(tag.slice(TASK_TAG_PREFIX.length));
  }

  return false;
};

/** いま端末に残っているお知らせのうち、用が済んだものを閉じる。 */
export async function closeSettledNotifications(subjects: NotificationSubjects): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    // getNotifications は端末によっては使えない（そのときは手で払うこれまでどおり）。
    if (!registration?.getNotifications) return;
    const notifications = await registration.getNotifications();
    for (const notification of notifications) {
      if (isSettledNotification(notification.tag, subjects)) notification.close();
    }
  } catch (err) {
    // 消せなくても記録そのものには関わらないので、ここで止めない。
    console.error('Failed to close settled notifications:', err);
  }
}
