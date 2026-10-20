import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { updateTaskDone, updateTaskDoneDates } from '@/lib/api/tasks';

// お知らせの上のボタン。タスクのリマインダーに「完了」を付け、アプリを開かずに完了にできるようにする（docs/notifications.md §15）。
//
// ボタンはOSが出すお知らせには付けられないので、タスクのリマインダーだけはサーバーがデータだけで送り、
// expo-notifications に出させる（supabase/functions/_shared/deliver.ts の actionableData）。
// 押したときの処理は3つの入口から来るが、中身はすべて handleNotificationAction に通す。
//
//   - アプリが裏にいる・閉じている: expo-task-manager の背景の処理（notificationActionTask.ts）
//   - アプリを開いている: お知らせの応答の受け手（app/_layout.tsx）
//   - 閉じている間に押されて背景の処理が動かなかった分: 次に開いたとき、同じ受け手に届く
//
// 同じ押下が2つの入口から届くことがあるが、完了は何度行っても結果が同じなので、
// 処理中の押下だけを重ねて行わないようにする（端末には控えない。控えを持つと、残った控えのせいで
// 以後の押下が黙って捨てられ、押しても何も起きなくなりうる）。

/** ボタンの組の名前。送る側（_shared/deliver.ts の categoryId）と合わせる。 */
export const NOTIFICATION_CATEGORY = {
  taskComplete: 'task-complete',
} as const;

const ACTION_COMPLETE = 'complete';

/**
 * ボタンの組を端末に登録する。起動のたびに呼んでよい（同じ名前なら上書きされるだけ）。
 * 登録は端末に残るので、アプリが閉じている間に届いたお知らせにもボタンが付く。
 */
export async function configureNotificationCategories(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY.taskComplete, [
    {
      identifier: ACTION_COMPLETE,
      buttonTitle: '完了',
      options: { opensAppToForeground: false },
    },
  ]);
}

type NotificationData = Record<string, unknown>;

const stringOf = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** お知らせを、中身はそのままで本文だけ差し替えて出し直す（できなかったことを伝える）。 */
async function presentAgain(request: Notifications.NotificationRequest, body: string): Promise<void> {
  const data = (request.content.data ?? {}) as NotificationData;
  const categoryId = stringOf(data.categoryId);
  await Notifications.scheduleNotificationAsync({
    identifier: request.identifier,
    content: {
      title: request.content.title ?? stringOf(data.title) ?? '',
      body,
      data,
      ...(categoryId ? { categoryIdentifier: categoryId } : {}),
    },
    trigger: { channelId: stringOf(data.channelId) ?? 'task-reminder' },
  });
}

/**
 * アプリを開いている間に届いた、ボタン付きのお知らせを出す。
 *
 * データだけのメッセージは、アプリを開いている間は expo-notifications が出さない
 * （閉じている間は出す）。そこで届いたものをそのまま、ボタンを付けて自分で出す。
 * 自分で出したお知らせもここへ来るので、サーバーから届いたもの（push）だけを扱う。
 */
export async function presentActionableNotification(
  notification: Notifications.Notification,
): Promise<void> {
  const { request } = notification;
  if ((request.trigger as { type?: unknown } | null)?.type !== 'push') return;
  const data = (request.content.data ?? {}) as NotificationData;
  const categoryId = stringOf(data.categoryId);
  if (!categoryId) return;

  await Notifications.scheduleNotificationAsync({
    // 閉じている間に届いたときと同じidにする（同じ用件は差し替わる。消すときも同じ規則）
    identifier: stringOf(data.tag) ?? request.identifier,
    content: {
      title: request.content.title ?? stringOf(data.title) ?? '',
      body: request.content.body ?? stringOf(data.message) ?? '',
      data,
      categoryIdentifier: categoryId,
    },
    trigger: { channelId: stringOf(data.channelId) ?? 'task-reminder' },
  });
}

/**
 * 押したが、まだ書き込めていない完了。通知は押した時点で消すので、裏で書き込む前にアプリの処理が
 * 止まっても（電波が無い・端末が眠る・処理が打ち切られる）、完了が失われないよう端末に控える。
 * 書き込めたら外し、書き込めなかった分は次にアプリを開いたときに書き込み直す（flushPendingCompletions）。
 */
const PENDING_KEY = 'sukusuku.notificationActions.pendingCompletions';

type PendingCompletion = { taskId: string; date: string | null };

const samePending = (a: PendingCompletion, b: PendingCompletion) =>
  a.taskId === b.taskId && a.date === b.date;

async function readPending(): Promise<PendingCompletion[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingCompletion[]) : [];
  } catch {
    return [];
  }
}

async function updatePending(change: (list: PendingCompletion[]) => PendingCompletion[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(change(await readPending())));
  } catch (err) {
    console.error('Failed to save pending completions:', err);
  }
}

/** いま処理している押下。同じ押下が2つの入口から同時に届いても、行うのは一度だけにする。 */
const inFlight = new Set<string>();

/**
 * タスクを完了にする。繰り返すタスクは、お知らせの回（date）だけを完了にする
 * （予定タブの完了の切り替えと同じ。app/(tabs)/schedule.tsx の toggleTodo）。
 */
async function completeTask(taskId: string, date: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('tasks')
    .select('recurrence, done_dates')
    .eq('id', taskId)
    .single();
  if (error) throw error;
  if (data.recurrence && date) {
    const dates = data.done_dates ?? [];
    if (!dates.includes(date)) await updateTaskDoneDates(supabase, taskId, [...dates, date]);
    return;
  }
  await updateTaskDone(supabase, taskId, true);
}

/** 1回の書き込みを待つ上限。裏の処理は通信が途中で止まって返らないことがあり、待ち続けると失敗の知らせも出せない。 */
const WRITE_TIMEOUT_MS = 10_000;
/** 書き込みをやり直す間隔。完了は何度書いても同じ結果なので、読み取りからまとめてやり直してよい。 */
const WRITE_RETRY_DELAYS_MS = [1_000, 3_000];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ms}ms 以内に終わりませんでした`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 完了を書き込む。通信が一瞬つながらない・途中で止まるだけで失敗にしないよう、待ち時間に上限を付けてやり直す
 * （2026-10-20: 通知から押した完了で、読み取りは届いたのに書き込みが届かず「完了にできませんでした」になった）。
 */
async function completeTaskWithRetry(taskId: string, date: string | null): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await withTimeout(completeTask(taskId, date), WRITE_TIMEOUT_MS);
      return;
    } catch (err) {
      const delay = WRITE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw err;
      console.warn('Retrying completion from notification:', err);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * お知らせのボタンが押されたときの処理。ボタンの押下でなければ何もせず false。
 * 済ませたらお知らせを消す。できなければ、そのことを本文にして出し直す（もう一度押せる）。
 */
export async function handleNotificationAction(
  response: Notifications.NotificationResponse,
): Promise<boolean> {
  const { actionIdentifier, notification } = response;
  console.log('[notification-action] received', actionIdentifier, notification?.request?.identifier);
  if (actionIdentifier !== ACTION_COMPLETE) return false;

  const { request } = notification;
  const key = [request.identifier, notification.date, actionIdentifier].join('|');
  if (inFlight.has(key)) return true;
  inFlight.add(key);

  try {
    const data = (request.content.data ?? {}) as NotificationData;
    const taskId = stringOf(data.taskId);
    const pending: PendingCompletion | null = taskId ? { taskId, date: stringOf(data.date) } : null;

    // 先に控える。お知らせを消したあとで処理が止まっても、完了が失われないようにする。
    // 書き込めたら外し、書き込めなかった分は次にアプリを開いたときに書き込み直す。
    if (pending) {
      await updatePending((list) => (list.some((p) => samePending(p, pending)) ? list : [...list, pending]));
    }

    // Googleカレンダーのタスクと同じく、押したらすぐお知らせを消す（完了の書き込みを待たない）。
    // できなかったときは下で本文を差し替えて出し直す。
    await dismissTaskNotifications(request.identifier, taskId);

    try {
      if (!pending) throw new Error(`お知らせにタスクのidがありません: ${JSON.stringify(Object.keys(data))}`);
      await completeTaskWithRetry(pending.taskId, pending.date);
      await updatePending((list) => list.filter((p) => !samePending(p, pending)));
      console.log('[notification-action] completed', pending.taskId, pending.date);
    } catch (err) {
      // 黙って終えない。できなかったことを本文にして出し直し、もう一度押せるようにする。
      console.error('Failed to complete task from notification:', err);
      await presentAgain(request, '完了を書き込めませんでした。アプリを開くと完了になります。').catch(
        (presentErr: unknown) => console.error('Failed to present notification again:', presentErr),
      );
    }
  } finally {
    inFlight.delete(key);
  }
  return true;
}

/**
 * このタスクのお知らせを端末から消す。押されたお知らせのidで消し、idが合わなかった場合に備えて、
 * 出ているお知らせのうち同じタスクのものも消す（同じ用件が積み上がっていても残さない）。
 */
async function dismissTaskNotifications(
  identifier: string | null,
  taskId: string | null,
  date?: string | null,
): Promise<void> {
  if (identifier) {
    await Notifications.dismissNotificationAsync(identifier).catch((err: unknown) =>
      console.error('Failed to dismiss notification:', err),
    );
  }
  if (!taskId) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = n.request.content.data as NotificationData | undefined;
          // 日付を指定したときは、その回のお知らせだけ（繰り返すタスクの別の回のお知らせは残す）。
          return stringOf(data?.taskId) === taskId && (date === undefined || stringOf(data?.date) === date);
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch (err) {
    console.error('Failed to dismiss presented notifications:', err);
  }
}

/**
 * 通知から押した完了のうち、書き込めていないものを書き込み直す。アプリを開いたとき・前面に戻ったときに呼ぶ。
 * 書き込めなかったものは控えに残し、次の機会にまた試す。
 */
export async function flushPendingCompletions(): Promise<void> {
  for (const pending of await readPending()) {
    try {
      await completeTask(pending.taskId, pending.date);
      await updatePending((list) => list.filter((p) => !samePending(p, pending)));
      // 書き込めなかったと伝えたお知らせが残っていると、完了済みなのに「完了にできませんでした」と見えてしまう。
      await dismissTaskNotifications(null, pending.taskId, pending.date);
    } catch (err) {
      console.error('Failed to flush pending completion:', err);
    }
  }
}
