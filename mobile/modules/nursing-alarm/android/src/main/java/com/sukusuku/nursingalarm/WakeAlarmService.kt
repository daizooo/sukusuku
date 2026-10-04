package com.sukusuku.nursingalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 夜間の起床アラームを鳴らす前面サービス（docs/night-wake-alarm.md §5）。
 *
 * [WakeAlarmReceiver] が予約の発火で始める。授乳中の経過時間を数える [NursingAlarmService] とは
 * 別のサービスにしている（状態も通知も別物で、片方が止まってももう片方に影響させないため）。
 *
 * - 小さな音から始めて約20秒で最大まで上げ、最大60秒鳴らす（[WakeTonePlayer] + 振動）。
 * - 常駐通知の「起きた」ボタン、またはアプリを開いたとき（JSから [ACTION_DISMISS]）で止まる。
 * - 止められないまま60秒たったら自動で止め、**5分後に1回だけ**もう一度予約する（2回目は足さない）。
 *   通知は消さずに残すので、起きたときに目安の時刻が分かる。
 */
class WakeAlarmService : Service() {
  companion object {
    const val ACTION_RING = "com.sukusuku.nursingalarm.WAKE_RING"
    const val ACTION_DISMISS = "com.sukusuku.nursingalarm.WAKE_DISMISS"

    private const val CHANNEL_ID = "nursing_wake_alarm"
    private const val NOTIFICATION_ID = 1002

    /**
     * アプリを開いたときなど、外から鳴り止める。鳴っていなければ何もしない。
     * 60秒で自動的に止まったあとに残してある通知も消す。
     */
    fun dismissFrom(context: Context) {
      context.stopService(Intent(context, WakeAlarmService::class.java))
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .cancel(NOTIFICATION_ID)
    }

    /** 鳴らす最長の長さ。 */
    private const val RING_MAX_MS = 60_000L

    /** 音量を小→大へ上げていく長さと、その刻み。 */
    private const val RAMP_MS = 20_000L
    private const val RAMP_STEP_MS = 500L
    private const val VOLUME_START = 0.15f
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tonePlayer = WakeTonePlayer()

  private var dueAt: Long = 0
  private var attempt: Int = 1
  private var startedAt: Long = 0
  private var wakeLock: PowerManager.WakeLock? = null

  private val ramp = object : Runnable {
    override fun run() {
      val elapsed = System.currentTimeMillis() - startedAt
      val progress = (elapsed.toFloat() / RAMP_MS).coerceIn(0f, 1f)
      tonePlayer.setVolume(VOLUME_START + (1f - VOLUME_START) * progress)
      if (progress < 1f) handler.postDelayed(this, RAMP_STEP_MS)
    }
  }

  private val autoStop = Runnable { finishUnanswered() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_DISMISS) {
      dismiss()
      return START_NOT_STICKY
    }

    dueAt = intent?.getLongExtra(WakeAlarmScheduler.EXTRA_DUE_AT, dueAt) ?: dueAt
    attempt = intent?.getIntExtra(WakeAlarmScheduler.EXTRA_ATTEMPT, attempt) ?: attempt
    // 発火を受け取ったので、予約の控えは役目を終えた。次の予約はアプリが組み直す。
    WakeAlarmScheduler.clearRecord(this)

    createChannel()
    startInForeground()
    acquireWakeLock()
    startRinging()
    // 落とされたら、そのまま鳴り止む。再起動での掛け直しはしない（サービスは短命で、
    // 次の予約はアプリが組み直す）。
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(ramp)
    handler.removeCallbacks(autoStop)
    tonePlayer.stop()
    vibrator()?.cancel()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun startRinging() {
    handler.removeCallbacks(ramp)
    handler.removeCallbacks(autoStop)
    startedAt = System.currentTimeMillis()
    tonePlayer.start(VOLUME_START)
    vibrate()
    handler.postDelayed(ramp, RAMP_STEP_MS)
    handler.postDelayed(autoStop, RING_MAX_MS)
  }

  /** 「起きた」・アプリを開いた。鳴り止め、通知も消す。再鳴動はしない。 */
  private fun dismiss() {
    stopRinging()
    stopForeground(Service.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /** 60秒たっても止められなかった。鳴り止め、1回だけ5分後に予約し直す。通知は残す。 */
  private fun finishUnanswered() {
    stopRinging()
    val retryAt = System.currentTimeMillis() + WakeAlarmScheduler.RETRY_DELAY_MS
    // 目安の時刻を過ぎてからの再鳴動は意味がない（その時刻の従来の通知が拾う）。
    if (attempt < WakeAlarmScheduler.MAX_ATTEMPT && dueAt > 0 && retryAt <= dueAt) {
      WakeAlarmScheduler.schedule(this, retryAt, dueAt, attempt + 1)
    }
    // 常駐をやめて、ふつうの通知として残す（起きたときに目安の時刻が読める）。
    notificationManager().notify(NOTIFICATION_ID, buildNotification(ringing = false))
    stopForeground(Service.STOP_FOREGROUND_DETACH)
    stopSelf()
  }

  private fun stopRinging() {
    handler.removeCallbacks(ramp)
    handler.removeCallbacks(autoStop)
    tonePlayer.stop()
    vibrator()?.cancel()
  }

  /**
   * 振動もアラームの用途で伝える（マナーモードでも震えるように。[NursingAlarmService.vibrate] と同じ理由）。
   * 止めるまで繰り返す。
   */
  private fun vibrate() {
    val device = vibrator() ?: return
    // 0 = 待たずに始める。長く震え、少し休む、を繰り返す。
    val effect = VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600, 1400), 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      device.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
    } else {
      @Suppress("DEPRECATION")
      device.vibrate(
        effect,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
    }
  }

  private fun vibrator(): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  private fun notificationManager(): NotificationManager =
    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    // 音と振動はサービスが自分で鳴らす（チャンネルに音を持たせると音量を上げていけない）。
    // 通知そのものは目に入るよう高めの重要度にする。
    val channel = NotificationChannel(CHANNEL_ID, "授乳の起床アラーム", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "夜の授乳の少し前に、起きるための音で知らせる通知"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    notificationManager().createNotificationChannel(channel)
  }

  private fun startInForeground() {
    val notification = buildNotification(ringing = true)
    // specialUse はAndroid 14で入った種別なので、渡すのもそこから（[NursingAlarmService] と同じ）。
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(ringing: Boolean): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val dueText = if (dueAt > 0) {
      "${SimpleDateFormat("H:mm", Locale.JAPAN).format(Date(dueAt))} の目安です"
    } else {
      "次の授乳の時間が近づいています"
    }
    builder
      .setContentTitle("そろそろ授乳です")
      .setContentText(if (ringing) "$dueText — 起きてください" else dueText)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(ringing)
      .setAutoCancel(!ringing)
      .setContentIntent(launchAppIntent())
    if (ringing) {
      @Suppress("DEPRECATION")
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "起きた", dismissIntent())
    }
    return builder.build()
  }

  private fun dismissIntent(): PendingIntent {
    val intent = Intent(this, WakeAlarmService::class.java).apply { action = ACTION_DISMISS }
    return PendingIntent.getService(
      this,
      1,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** 通知をタップしたらアプリを開く。鳴り止めるのはアプリ側が開いたときに行う。 */
  private fun launchAppIntent(): PendingIntent? {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** 鳴らしている間だけ画面が消えてもCPUを止めさせない。時間で自動的に手放す。 */
  private fun acquireWakeLock() {
    releaseWakeLock()
    val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = manager
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sukusuku:wake_alarm")
      .apply { acquire(RING_MAX_MS + 10_000L) }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }
}
