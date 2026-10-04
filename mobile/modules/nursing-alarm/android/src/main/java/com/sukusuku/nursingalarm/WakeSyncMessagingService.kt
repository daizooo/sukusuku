package com.sukusuku.nursingalarm

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * サーバーからの「起床アラームの予約を入れ替えて」を受け取る（docs/night-wake-alarm.md §4）。
 *
 * PWAやパートナーの端末で授乳が記録されても、この端末のアプリは気づけない。サーバーが毎分
 * 各端末の「いま予約しているべき時刻」を求め、変わったときだけ、画面に出ないデータ通知
 * （kind = "wake-sync"）で伝えてくる。アプリが閉じていても、このサービスが受け取って
 * そのまま [WakeAlarmScheduler] を入れ替える（JSも通信も要らない）。
 *
 * FCMのメッセージは1つのサービスにしか届かない。マニフェストの優先度を expo-notifications の
 * サービス（-1）より上にしてこちらが先に受け取り、起床アラーム**以外**のメッセージ・トークンの
 * 更新は、expo-notifications の [DELEGATE_CLASS] へそのまま渡す（予定のリマインダーなど、
 * これまでの通知の扱いを変えない）。
 *
 * expo-notifications のクラスを直接参照しないのは、SDK 54 では事前ビルド済みの版が使われ、
 * このモジュールからGradleのプロジェクトとして参照できないため。実行時に名前で呼ぶ。
 */
class WakeSyncMessagingService : FirebaseMessagingService() {
  private companion object {
    const val TAG = "WakeSyncMessaging"

    const val KIND = "wake-sync"
    const val OP_SCHEDULE = "schedule"
    const val OP_CANCEL = "cancel"

    /** 過ぎた時刻・過ぎる寸前の時刻は入れない（入れるとその場で鳴ってしまう）。 */
    const val MIN_LEAD_MS = 1_000L

    /** expo-notifications がFCMのメッセージを扱う本体（ExpoFirebaseMessagingService が使うもの）。 */
    const val DELEGATE_CLASS = "expo.modules.notifications.service.delegates.FirebaseMessagingDelegate"
  }

  private val expoDelegate: Any? by lazy {
    runCatching {
      Class.forName(DELEGATE_CLASS).getConstructor(Context::class.java).newInstance(this)
    }.onFailure { Log.e(TAG, "expo-notifications のデリゲートを作れませんでした", it) }.getOrNull()
  }

  /** expo-notifications のデリゲートの同名のメソッドを呼ぶ。見つからなければログだけ残す。 */
  private fun forwardToExpo(method: String, parameterType: Class<*>?, argument: Any?) {
    val delegate = expoDelegate ?: return
    runCatching {
      if (parameterType == null) {
        delegate.javaClass.getMethod(method).invoke(delegate)
      } else {
        delegate.javaClass.getMethod(method, parameterType).invoke(delegate, argument)
      }
    }.onFailure { Log.e(TAG, "expo-notifications へ $method を渡せませんでした", it) }
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (data["kind"] != KIND) {
      forwardToExpo("onMessageReceived", RemoteMessage::class.java, remoteMessage)
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

  override fun onNewToken(token: String) {
    forwardToExpo("onNewToken", String::class.java, token)
  }

  override fun onDeletedMessages() {
    forwardToExpo("onDeletedMessages", null, null)
  }
}
