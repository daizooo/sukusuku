// お知らせを「宛先の種類に関わらず1つの入口で送る」層。
//
// 宛先は push_subscriptions の1行で、kind が 'webpush'（ブラウザ）か 'fcm'（ネイティブ版）。
// 配信するEdge Function（send-reminders / send-feeding-reminders /
// send-temperature-reminders）は、どちらの宛先かを気にせずここへ渡す。
//
// 通知の中身（見出し・本文・飛び先）はEdge Function側が作る。
// **PWA版とネイティブ版で同じ文面が出るのは、作る場所が1つだからである**
// （ルートの CLAUDE.md「ネイティブ版はPWA版に準拠する」）。
// ここがやるのは、その中身を種類ごとの形に詰め替えることだけ。
//
//   webpush … JSONの本文を暗号化して送る。通知を組み立てるのは public/sw.js
//   fcm     … 見出し・本文をFCMのnotificationに載せる。OSがそのまま出す
//
// 飛び先の決まりごと（どの種類がどの画面へ行くか）は public/sw.js と
// mobile/src/lib/appLinks.ts が持っている。ここでは種類と url をそのまま渡すだけ。

import {
  createVapidContext,
  sendPushNotification,
  type VapidContext,
  type VapidKeys,
} from './webpush.ts';
import {
  createFcmContext,
  fcmTokenOf,
  sendFcmNotification,
  type FcmContext,
  type FcmServiceAccount,
} from './fcm.ts';

/** 送る相手。push_subscriptions から引いた行。 */
export interface DeliveryTarget {
  id: string;
  kind: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * 同じ人がネイティブ版とPWA版の両方を登録しているとき、ネイティブ版の宛先だけを残す。
 *
 * 移行の途中では1人が宛先を複数持つ。ネイティブ版を入れても、PWA版で通知をオンにした
 * ブラウザの行(kind='webpush')は残り続けるため、同じお知らせが端末に何通も出る。
 *
 * **人ごとに見るのが肝心で、家族ごとにまとめてはいけない。** 片方がネイティブ版へ移り、
 * もう片方がまだPWA版という間に、後者へのお知らせまで止まってしまう。
 *
 * 行そのものは消さない。ネイティブ版を消して kind='fcm' の行が無くなれば、
 * PWA版へそのまま戻る。
 */
export function preferNative<T extends { kind: string; user_id: string }>(
  targets: readonly T[],
): T[] {
  const nativeUsers = new Set(
    targets.filter((target) => target.kind === 'fcm').map((target) => target.user_id),
  );
  if (nativeUsers.size === 0) return [...targets];
  return targets.filter((target) => target.kind === 'fcm' || !nativeUsers.has(target.user_id));
}

/** お知らせの中身。Web Push の本文(JSON)にそのまま載る形。 */
export interface NotificationContent {
  /** お知らせの種類。予定のリマインダーだけは持たない（従来の形のまま）。 */
  kind?: 'nursing' | 'feeding' | 'temperature';
  title: string;
  body: string;
  /** 飛び先。種類を持つお知らせでは受け取り側が種類から決めるので、既定のままでよい。 */
  url: string;
  /** 予定のリマインダーだけが持つ。お知らせを予定ごとに分けるのに使う。 */
  taskId?: string;
}

export interface DeliveryResult {
  ok: boolean;
  /** 宛先が失効している。行を消してよい。 */
  gone: boolean;
  error?: string;
}

/**
 * 同じ用件のお知らせを積み上げず差し替えるための目印。
 * Web Push側は public/sw.js が同じ値を組み立てている（片方を変えるときは両方揃える）。
 */
const tagOf = (content: NotificationContent): string => {
  if (content.kind === 'nursing') return 'nursing-alarm';
  if (content.kind === 'feeding') return 'feeding-reminder';
  if (content.kind === 'temperature') return 'temperature-reminder';
  return content.taskId ? `task-${content.taskId}` : 'sukusuku';
};

/**
 * Androidの通知チャンネル。鳴り方・振動はチャンネルに固定されるため、
 * 種類ごとに分けておく（アプリ側 mobile/src/lib/push.ts が同じidで作る）。
 */
const channelOf = (content: NotificationContent): string => {
  if (content.kind === 'feeding') return 'feeding-reminder';
  if (content.kind === 'temperature') return 'temperature-reminder';
  // 授乳の経過時間お知らせはネイティブ版では前面サービスが鳴らすのでここへは来ないが、
  // 万一届いたときに無いチャンネルへ送って落とさないよう、予定と同じ扱いにしておく。
  return 'task-reminder';
};

/**
 * 配信に使う鍵。1回の実行で何通も送るので、鍵の用意は1度だけにする。
 *
 * どちらの宛先も無いかもしれない（家族の全員がネイティブ版へ移れば webpush の行は消える）。
 * 使う番が来てから初めて用意することで、片方の設定が無いだけで配信全体が止まらないようにする。
 */
export class DeliveryContext {
  private vapid: VapidContext | null = null;
  private fcm: FcmContext | null = null;
  private vapidError: string | null = null;
  private fcmError: string | null = null;

  private async getVapid(): Promise<VapidContext> {
    if (this.vapid) return this.vapid;
    if (this.vapidError) throw new Error(this.vapidError);

    const keysRaw = Deno.env.get('VAPID_KEYS');
    const subject = Deno.env.get('VAPID_SUBJECT');
    if (!keysRaw || !subject) {
      this.vapidError = 'VAPID_KEYS / VAPID_SUBJECT が未設定です';
      throw new Error(this.vapidError);
    }
    this.vapid = await createVapidContext(JSON.parse(keysRaw) as VapidKeys, subject);
    return this.vapid;
  }

  private async getFcm(): Promise<FcmContext> {
    if (this.fcm) return this.fcm;
    if (this.fcmError) throw new Error(this.fcmError);

    const accountRaw = Deno.env.get('FCM_SERVICE_ACCOUNT');
    if (!accountRaw) {
      this.fcmError = 'FCM_SERVICE_ACCOUNT が未設定です';
      throw new Error(this.fcmError);
    }
    this.fcm = await createFcmContext(JSON.parse(accountRaw) as FcmServiceAccount);
    return this.fcm;
  }

  /**
   * これから送る宛先の分だけ、鍵が用意できるかを先に確かめる。
   * 用意できなければその理由を返す（呼び出し側は送らずに 500 で終わる）。
   *
   * **送り始める前に確かめるのが肝心。** 送信済み記録(reminder_deliveries ほか)は
   * (予定, 宛先, 通知時刻) で一意なので、鍵が無いまま送ろうとして失敗の記録を作ると、
   * **設定を直してもその通知は二度と送られない**（記録があるものは対象から外れるため）。
   * 設定漏れは「今回は何も送らず、直したら取りこぼしから拾い直す」のが正しい形になる。
   */
  async ensureReady(targets: readonly DeliveryTarget[]): Promise<string | null> {
    const kinds = new Set(targets.map((target) => target.kind));
    try {
      if (kinds.has('fcm')) await this.getFcm();
      // 'webpush' 以外の知らない種類は送れないので、ここでは鍵を用意しない
      // （その行だけが deliver() で失敗になる）。
      if (kinds.has('webpush')) await this.getVapid();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * 1台へ送る。
   *
   * @param ttlSeconds 届かなかったときに何秒まで配送を待つか。
   *                   時刻を知らせるものは短くする（何時間も後に届いても意味がない）。
   * @param urgency    Web Push側だけの指定。FCMは常に HIGH で送る。
   */
  async deliver(
    target: DeliveryTarget,
    content: NotificationContent,
    ttlSeconds = 12 * 60 * 60,
    urgency: 'very-low' | 'low' | 'normal' | 'high' = 'normal',
  ): Promise<DeliveryResult> {
    try {
      if (target.kind === 'fcm') {
        const fcm = await this.getFcm();
        return await sendFcmNotification(fcm, fcmTokenOf(target.endpoint), {
          title: content.title,
          body: content.body,
          // 受け取り側が飛び先を決めるのに使う。FCMのdataは文字列しか載らない。
          data: {
            ...(content.kind ? { kind: content.kind } : {}),
            ...(content.taskId ? { taskId: content.taskId } : {}),
            url: content.url,
          },
          channelId: channelOf(content),
          tag: tagOf(content),
          ttlSeconds,
        });
      }

      const vapid = await this.getVapid();
      return await sendPushNotification(
        vapid,
        target,
        JSON.stringify(content),
        ttlSeconds,
        urgency,
      );
    } catch (error) {
      // 鍵が無い・壊れているのは宛先の失効ではないので gone にはしない
      // （消してしまうと、設定を直したあとに各端末でオンにし直すことになる）。
      return {
        ok: false,
        gone: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
