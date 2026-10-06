// お知らせを送る入口。通知の中身を、FCMへ渡す形に詰め替える層。
//
// 宛先は push_subscriptions の kind = 'fcm' の行（ネイティブ版のAndroid）。
// 配信するEdge Function（send-reminders / send-feeding-reminders /
// send-temperature-reminders / send-stock-expiry-reminders）は、送り方を気にせず中身をここへ渡す。
//
// **かつてはブラウザ向けの Web Push もここで振り分けていた**（kind = 'webpush'）。
// 家族全員がネイティブ版へ移ったので撤去した（フェーズ4の条件D。
// docs/native-app-rewrite.md §7、docs/notifications.md §11）。戻すときは
// この層に分岐を戻し、_shared/webpush.ts をgitの履歴から取り出す。
//
// 飛び先の決まりごと（どの種類がどの画面へ行くか）は
// mobile/src/lib/appLinks.ts が持っている。ここでは種類と url をそのまま渡すだけ。

import {
  createFcmContext,
  fcmTokenOf,
  sendFcmData,
  sendFcmNotification,
  type FcmContext,
  type FcmServiceAccount,
} from './fcm.ts';

/** 送る相手。push_subscriptions から引いた行（kind = 'fcm'）。 */
export interface DeliveryTarget {
  id: string;
  kind: string;
  /** 'fcm:' + 登録トークン。 */
  endpoint: string;
}

/** お知らせの中身。 */
export interface NotificationContent {
  /** お知らせの種類。予定のリマインダーだけは持たない（従来の形のまま）。 */
  kind?: 'nursing' | 'feeding' | 'temperature' | 'stock';
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

/** 同じ用件のお知らせを積み上げず差し替えるための目印。 */
const tagOf = (content: NotificationContent): string => {
  if (content.kind === 'nursing') return 'nursing-alarm';
  if (content.kind === 'feeding') return 'feeding-reminder';
  if (content.kind === 'temperature') return 'temperature-reminder';
  if (content.kind === 'stock') return 'stock-expiry';
  return content.taskId ? `task-${content.taskId}` : 'sukusuku';
};

/**
 * Androidの通知チャンネル。鳴り方・振動はチャンネルに固定されるため、
 * 種類ごとに分けておく（アプリ側 mobile/src/lib/push.ts が同じidで作る）。
 */
const channelOf = (content: NotificationContent): string => {
  if (content.kind === 'feeding') return 'feeding-reminder';
  if (content.kind === 'temperature') return 'temperature-reminder';
  if (content.kind === 'stock') return 'stock-expiry';
  // 授乳の経過時間お知らせはネイティブ版では前面サービスが鳴らすのでここへは来ないが、
  // 万一届いたときに無いチャンネルへ送って落とさないよう、予定と同じ扱いにしておく。
  return 'task-reminder';
};

/**
 * 配信に使う鍵。1回の実行で何通も送るので、鍵の用意は1度だけにする。
 * 送る分があると分かってから用意する（宛先が0件の実行では取りに行かない）。
 */
export class DeliveryContext {
  private fcm: FcmContext | null = null;
  private fcmError: string | null = null;

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
    if (targets.length === 0) return null;
    try {
      await this.getFcm();
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
   */
  async deliver(
    target: DeliveryTarget,
    content: NotificationContent,
    ttlSeconds = 12 * 60 * 60,
  ): Promise<DeliveryResult> {
    try {
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

  /**
   * 1台へデータだけを送る（画面には出ない）。起床アラームの予約を端末へ伝えるのに使う。
   * data は文字列しか載らない。
   */
  async deliverData(
    target: DeliveryTarget,
    data: Record<string, string>,
    ttlSeconds: number,
  ): Promise<DeliveryResult> {
    try {
      const fcm = await this.getFcm();
      return await sendFcmData(fcm, fcmTokenOf(target.endpoint), data, ttlSeconds);
    } catch (error) {
      return {
        ok: false,
        gone: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
