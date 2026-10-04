package com.sukusuku.nursingalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 端末の再起動・アプリの更新で消えた予約を、控えから掛け直す。
 *
 * 鳴らす時刻を再起動の最中に過ぎてしまったときは、目安の時刻（dueAt）までなら
 * いまから鳴らす（確実に起こすことを優先）。目安の時刻も過ぎていれば、従来の通知が
 * 拾うので何もせず控えを消す。
 */
class WakeAlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    val scheduled = WakeAlarmScheduler.scheduled(context) ?: return
    val now = System.currentTimeMillis()
    when {
      scheduled.triggerAt > now ->
        WakeAlarmScheduler.schedule(context, scheduled.triggerAt, scheduled.dueAt, scheduled.attempt)
      scheduled.dueAt > now ->
        WakeAlarmReceiver.startRing(context, scheduled.dueAt, scheduled.attempt)
      else -> WakeAlarmScheduler.clearRecord(context)
    }
  }
}
