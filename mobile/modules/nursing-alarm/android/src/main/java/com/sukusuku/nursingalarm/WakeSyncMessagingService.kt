package com.sukusuku.nursingalarm

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * サーバーからの「起床アラームの予約を入れ替えて」を受け取る（docs/night-wake-alarm.md §4）。
 *
 * PWAやパートナーの端末で授乳が記録されても、この端末のアプリは気づけない。サーバーが毎分
 * 各端末の「いま予約しているべき時刻」を求め、変わったときだけ、画面に出ないデータ通知
 * （kind = "wake-sync"）で伝えてくる。アプリが閉じていても、このサービスが受け取って
 * そのまま [WakeAlarmScheduler] を入れ替える（JSも通信も要らない）。
 *
 * expo-notifications の [ExpoFirebaseMessagingService] を継ぐのは、FCMのメッセージは
 * 1つのサービスにしか届かないため。マニフェストの優先度をこちらを上にして先に受け取り、
 * 起床アラームの通知**ではないもの**は、そのまま expo-notifications に渡す
 * （予定のリマインダーなど、これまでの通知の扱いを変えない）。
 */
class WakeSyncMessagingService : ExpoFirebaseMessagingService() {
  private companion object {
    const val KIND = "wake-sync"
    const val OP_SCHEDULE = "schedule"
    const val OP_CANCEL = "cancel"

    /** 過ぎた時刻・過ぎる寸前の時刻は入れない（入れるとその場で鳴ってしまう）。 */
    const val MIN_LEAD_MS = 1_000L
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (data["kind"] != KIND) {
      super.onMessageReceived(remoteMessage)
      return
    }

    when (data["op"]) {
      OP_SCHEDULE -> {
        val triggerAt = data["triggerAt"]?.toLongOrNull() ?: return
        val dueAt = data["dueAt"]?.toLongOrNull() ?: return
        if (triggerAt <= System.currentTimeMillis() + MIN_LEAD_MS) return
        WakeAlarmScheduler.schedule(applicationContext, triggerAt, dueAt)
      }
      OP_CANCEL -> WakeAlarmScheduler.cancel(applicationContext)
    }
  }
}
