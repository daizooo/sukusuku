package com.sukusuku.nursingalarm

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 授乳の計測を前面サービスへ預けるだけの受け口。
 *
 * 経過時間を数えるのも鳴らすのも [NursingAlarmService] の側で、ここは開始と停止を渡すだけ。
 * JS側は計測の値（区切りごとの累積・いまどの区切りか）を持ち、変わるたびに [start] を呼ぶ。
 */
class NursingAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NursingAlarm")

    /**
     * 計測を前面サービスへ預ける。区切りの切り替えも「新しい baselineAt での開始」として渡す。
     *
     * @param phase "left" | "right" | "burp"
     * @param baselineAt その区切りの合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。
     * @param phaseMinutes 1区切りの長さ（分）。ここに達したら1回だけ鳴らす。
     */
    AsyncFunction("start") { phase: String, baselineAt: Double, phaseMinutes: Int ->
      // 0引数版のAsyncFunctionはブロックの戻り値の型がAny?に固定されるオーバーロードへ
      // 解決されるため、値を伴わないreturnではなくletで済ませる（型推論を素直に通すため）。
      appContext.reactContext?.let { context ->
        val intent = Intent(context, NursingAlarmService::class.java).apply {
          action = NursingAlarmService.ACTION_START
          putExtra(NursingAlarmService.EXTRA_PHASE, phase)
          putExtra(NursingAlarmService.EXTRA_BASELINE_AT, baselineAt.toLong())
          putExtra(NursingAlarmService.EXTRA_PHASE_MINUTES, phaseMinutes)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      }
    }

    /** 計測をやめる。常駐通知も一緒に消える。 */
    AsyncFunction("stop") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, NursingAlarmService::class.java))
      }
    }

    // --- 夜間の起床アラーム（docs/night-wake-alarm.md） ---

    /**
     * 起床アラームを予約する（既にあれば置き換える）。
     *
     * @param triggerAt 鳴らす時刻(epoch ms)。目安の時刻の15分前。
     * @param dueAt 次の授乳の目安の時刻(epoch ms)。通知の文面と、再鳴動の打ち切りに使う。
     */
    AsyncFunction("scheduleWakeAlarm") { triggerAt: Double, dueAt: Double ->
      appContext.reactContext?.let { context ->
        WakeAlarmScheduler.schedule(context, triggerAt.toLong(), dueAt.toLong())
      }
    }

    /** 予約を取り消す。 */
    AsyncFunction("cancelWakeAlarm") {
      appContext.reactContext?.let { context -> WakeAlarmScheduler.cancel(context) }
    }

    /** 鳴っている起床アラームを止める（アプリを開いたとき）。残してある通知も消す。 */
    AsyncFunction("dismissWakeRing") {
      appContext.reactContext?.let { context -> WakeAlarmService.dismissFrom(context) }
    }

    /** 控えてある予約の鳴らす時刻(epoch ms)。予約が無ければ 0。 */
    AsyncFunction("getScheduledWakeAlarm") {
      appContext.reactContext?.let { context ->
        (WakeAlarmScheduler.scheduled(context)?.triggerAt ?: 0L).toDouble()
      } ?: 0.0
    }
  }
}
