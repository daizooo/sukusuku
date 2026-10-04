package com.sukusuku.nursingalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 起床アラームの発火を受け取り、鳴らす前面サービスを始める。
 *
 * `setAlarmClock` の発火は「バックグラウンドからの前面サービス開始」の制限を受けないので、
 * アプリを閉じていても、画面が消えていても始められる。
 */
class WakeAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != WakeAlarmScheduler.ACTION_FIRE) return
    startRing(
      context,
      dueAt = intent.getLongExtra(WakeAlarmScheduler.EXTRA_DUE_AT, 0L),
      attempt = intent.getIntExtra(WakeAlarmScheduler.EXTRA_ATTEMPT, 1),
    )
  }

  companion object {
    /** 鳴らすサービスを始める。再起動後の掛け直し（[WakeAlarmBootReceiver]）からも使う。 */
    fun startRing(context: Context, dueAt: Long, attempt: Int) {
      val service = Intent(context, WakeAlarmService::class.java).apply {
        action = WakeAlarmService.ACTION_RING
        putExtra(WakeAlarmScheduler.EXTRA_DUE_AT, dueAt)
        putExtra(WakeAlarmScheduler.EXTRA_ATTEMPT, attempt)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service)
      } else {
        context.startService(service)
      }
    }
  }
}
