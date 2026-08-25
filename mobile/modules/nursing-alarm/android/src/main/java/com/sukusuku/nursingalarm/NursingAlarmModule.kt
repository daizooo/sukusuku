package com.sukusuku.nursingalarm

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 授乳の計測を前面サービスへ預けるだけの受け口。
 *
 * 経過時間を数えるのも鳴らすのも [NursingAlarmService] の側で、ここは開始と停止を渡すだけ。
 * JS側は計測の値（左右の累積・いまどちらか）を持ち、変わるたびに [start] を呼ぶ。
 */
class NursingAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NursingAlarm")

    /**
     * 計測を前面サービスへ預ける。左右の切り替えも「新しい baselineAt での開始」として渡す。
     *
     * @param side "left" | "right"
     * @param baselineAt その側の合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。
     * @param intervalMinutes 何分ごとに知らせるか。
     */
    AsyncFunction("start") { side: String, baselineAt: Double, intervalMinutes: Int ->
      // 0引数版のAsyncFunctionはブロックの戻り値の型がAny?に固定されるオーバーロードへ
      // 解決されるため、値を伴わないreturnではなくletで済ませる（型推論を素直に通すため）。
      appContext.reactContext?.let { context ->
        val intent = Intent(context, NursingAlarmService::class.java).apply {
          action = NursingAlarmService.ACTION_START
          putExtra(NursingAlarmService.EXTRA_SIDE, side)
          putExtra(NursingAlarmService.EXTRA_BASELINE_AT, baselineAt.toLong())
          putExtra(NursingAlarmService.EXTRA_INTERVAL_MINUTES, intervalMinutes)
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
  }
}
