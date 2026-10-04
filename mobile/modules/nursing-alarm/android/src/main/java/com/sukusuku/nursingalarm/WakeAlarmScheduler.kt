package com.sukusuku.nursingalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * 夜間の起床アラーム（docs/night-wake-alarm.md）の予約。
 *
 * `AlarmManager.setAlarmClock` で端末に直接預けるので、通信が無くても、省電力（Doze）の最中でも
 * 時刻どおりに発火する。このやり方は「正確なアラーム」の権限も要らず、発火したときに
 * 前面サービスを始めることも許される。状態バーに目覚ましのアイコンが出るのもこの方式の特徴。
 *
 * 予約は1つだけ。入れ直すときは古いものを置き換える。再起動で消えるので、
 * 予約した時刻は SharedPreferences にも控え、[WakeAlarmBootReceiver] が掛け直す。
 */
object WakeAlarmScheduler {
  const val ACTION_FIRE = "com.sukusuku.nursingalarm.WAKE_FIRE"

  const val EXTRA_DUE_AT = "dueAt"
  const val EXTRA_ATTEMPT = "attempt"

  /** 止められなかったときの再鳴動は1回だけ。2回目（attempt = 2）の後ろには足さない。 */
  const val MAX_ATTEMPT = 2

  /** 止められなかったときに、もう一度鳴らすまでの間隔。 */
  const val RETRY_DELAY_MS = 5 * 60_000L

  private const val PREFS = "nursing_wake_alarm"
  private const val KEY_TRIGGER_AT = "trigger_at"
  private const val KEY_DUE_AT = "due_at"
  private const val KEY_ATTEMPT = "attempt"
  private const val REQUEST_CODE = 2001

  /** 控えてある予約。無ければ null。 */
  data class Scheduled(val triggerAt: Long, val dueAt: Long, val attempt: Int)

  /** 予約を入れる（既にあれば置き換える）。 [attempt] は何回目の鳴動か（1 = 最初、2 = 再鳴動）。 */
  fun schedule(context: Context, triggerAt: Long, dueAt: Long, attempt: Int = 1) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val showIntent = launchAppIntent(context)
    val info = AlarmManager.AlarmClockInfo(triggerAt, showIntent)
    manager.setAlarmClock(info, firePendingIntent(context, dueAt, attempt))
    prefs(context).edit()
      .putLong(KEY_TRIGGER_AT, triggerAt)
      .putLong(KEY_DUE_AT, dueAt)
      .putInt(KEY_ATTEMPT, attempt)
      .apply()
  }

  /** 予約を取り消す。控えも消す。 */
  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(firePendingIntent(context, 0L, 1))
    prefs(context).edit().clear().apply()
  }

  /** 鳴らし終えた（または発火を受け取った）あとに、控えだけを消す。 */
  fun clearRecord(context: Context) {
    prefs(context).edit().clear().apply()
  }

  fun scheduled(context: Context): Scheduled? {
    val prefs = prefs(context)
    val triggerAt = prefs.getLong(KEY_TRIGGER_AT, 0L)
    if (triggerAt <= 0L) return null
    return Scheduled(
      triggerAt = triggerAt,
      dueAt = prefs.getLong(KEY_DUE_AT, triggerAt),
      attempt = prefs.getInt(KEY_ATTEMPT, 1),
    )
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * 発火時に受け取る PendingIntent。取り消しのときも同じ requestCode・同じ宛先で作れば
   * 同じものとして扱われるので、extras は FLAG_UPDATE_CURRENT で入れ替える。
   */
  private fun firePendingIntent(context: Context, dueAt: Long, attempt: Int): PendingIntent {
    val intent = Intent(context, WakeAlarmReceiver::class.java).apply {
      action = ACTION_FIRE
      putExtra(EXTRA_DUE_AT, dueAt)
      putExtra(EXTRA_ATTEMPT, attempt)
    }
    return PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** 状態バーの目覚ましアイコンを押したときに開くアプリ。 */
  private fun launchAppIntent(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      context,
      REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
