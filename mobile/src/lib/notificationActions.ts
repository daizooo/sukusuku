import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { getMyMembership } from '@/lib/api/me';
import { updateTaskDone, updateTaskDoneDates } from '@/lib/api/tasks';
import { flushCareLogOutbox, queueInsertCareLog } from '@/lib/offline/careLogs';
import { MAX_CELSIUS, MIN_CELSIUS } from '@/lib/careLogUtils';
import { parseCelsiusText } from '@/lib/celsiusText';

// お知らせの上のボタン。タスクのリマインダーは「完了」、検温のお知らせは体温を打ち込んで「記録」。
// アプリを開かずに済ませられるようにする（docs/notifications.md §15）。
//
// ボタンはOSが出すお知らせには付けられないので、この2つだけはサーバーがデータだけで送り、
// expo-notifications に出させる（supabase/functions/_shared/deliver.ts の actionableData）。
// 押したときの処理は3つの入口から来るが、中身はすべて handleNotificationAction に通す。
//
//   - アプリが裏にいる・閉じている: expo-task-manager の背景の処理（notificationActionTask.ts）
//   - アプリを開いている: お知らせの応答の受け手（app/_layout.tsx）
//   - 閉じている間に押されて背景の処理が動かなかった分: 次に開いたとき、同じ受け手に届く
//
// 同じ押下が2つの入口から届くことがあるので、一度済ませた押下は覚えておいて二度は行わない
// （体温が二重に記録されないように）。

/** ボタンの組の名前。送る側（_shared/deliver.ts の categoryId）と合わせる。 */
export const NOTIFICATION_CATEGORY = {
  taskComplete: 'task-complete',
  temperatureRecord: 'temperature-record',
} as const;

const ACTION_COMPLETE = 'complete';
const ACTION_RECORD = 'record';

/** 済ませた押下の控え。新しいものから残す数。 */
const HANDLED_KEY = 'sukusuku.notificationActions.handled';
const HANDLED_LIMIT = 50;

/**
 * ボタンの組を端末に登録する。起動のたびに呼んでよい（同じ名前なら上書きされるだけ）。
 * 登録は端末に残るので、アプリが閉じている間に届いたお知らせにもボタンが付く。
 */
export async function configureNotificationCategories(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY.taskComplete, [
      {
        identifier: ACTION_COMPLETE,
        buttonTitle: '完了',
        options: { opensAppToForeground: false },
      },
    ]),
    Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY.temperatureRecord, [
      {
        identifier: ACTION_RECORD,
        buttonTitle: '体温を記録',
        textInput: { submitButtonTitle: '記録', placeholder: '例: 37.0' },
        options: { opensAppToForeground: false },
      },
    ]),
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

const handledInMemory = new Set<string>();

/** この押下をまだ済ませていなければ、済ませたことにして true を返す。 */
async function claim(key: string): Promise<boolean> {
  if (handledInMemory.has(key)) return false;
  handledInMemory.add(key);
  try {
    const raw = await AsyncStorage.getItem(HANDLED_KEY);
    const handled: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (handled.includes(key)) return false;
    await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify([key, ...handled].slice(0, HANDLED_LIMIT)));
  } catch {
    // 控えが読めなくても、押されたことは済ませる（二重になるよりは、やらないほうが困る）
  }
  return true;
}

async function myFamily(): Promise<{ userId: string; familyId: string }> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error('ログインしていません');
  const { familyId } = await getMyMembership(supabase, userId);
  if (!familyId) throw new Error('家族に属していません');
  return { userId, familyId };
}

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

/** 体温を記録する。圏外でも端末の控えに入り、つながったときに送られる（育児タブと同じ経路）。 */
async function recordTemperature(celsius: number): Promise<void> {
  const { userId, familyId } = await myFamily();
  await queueInsertCareLog(familyId, userId, {
    type: 'temperature',
    celsius,
    time: new Date(),
    note: '',
  });
  await flushCareLogOutbox(supabase, familyId, userId).catch(() => false);
}

/**
 * お知らせのボタンが押されたときの処理。ボタンの押下でなければ何もせず false。
 * 済ませたらお知らせを消す。できなければ、理由を本文にして出し直す（もう一度押せる）。
 */
export async function handleNotificationAction(
  response: Notifications.NotificationResponse,
): Promise<boolean> {
  const { actionIdentifier, notification } = response;
  if (actionIdentifier !== ACTION_COMPLETE && actionIdentifier !== ACTION_RECORD) return false;

  const { request } = notification;
  const key = [request.identifier, notification.date, actionIdentifier, response.userText ?? ''].join('|');
  if (!(await claim(key))) return true;

  const data = (request.content.data ?? {}) as NotificationData;

  if (actionIdentifier === ACTION_COMPLETE) {
    const taskId = stringOf(data.taskId);
    if (!taskId) return true;
    try {
      await completeTask(taskId, stringOf(data.date));
    } catch {
      await presentAgain(request, '完了にできませんでした。アプリを開いて完了にしてください。');
      return true;
    }
    await Notifications.dismissNotificationAsync(request.identifier);
    return true;
  }

  const text = response.userText ?? '';
  const celsius = parseCelsiusText(text);
  if (celsius === null) {
    await presentAgain(request, `「${text}」は体温として読めませんでした。数字で入れてください（例: 37.2）。`);
    return true;
  }
  if (celsius < MIN_CELSIUS || celsius > MAX_CELSIUS) {
    await presentAgain(
      request,
      `${celsius.toFixed(1)}℃ は記録できません。${MIN_CELSIUS.toFixed(1)}〜${MAX_CELSIUS.toFixed(1)}℃ の間で入れてください。`,
    );
    return true;
  }
  try {
    await recordTemperature(celsius);
  } catch {
    await presentAgain(request, '記録できませんでした。アプリを開いて記録してください。');
    return true;
  }
  await Notifications.dismissNotificationAsync(request.identifier);
  return true;
}
