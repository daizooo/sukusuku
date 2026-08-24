package com.sukusuku.nursingalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * 授乳中だけ動く前面サービス。
 *
 * 常駐通知に「授乳 12分 左」と出しながら経過時間を自分で数え、区切りごとに
 * 音（[AlarmTonePlayer]）と振動を鳴らす。ローカル通知を並べて予約する形にしないのは、
 * Android 8以降は通知の音と振動がチャンネルに固定され、長短の鳴らし分けができないため
 * （docs/native-app-android.md §3）。
 *
 * 数えるのに要るのは「その側の合計時間が0だった時刻(baselineAt)」だけで、
 * 左右の切り替えは baselineAt を入れ替えた [ACTION_START] として届く。
 */
class NursingAlarmService : Service() {
  companion object {
    const val ACTION_START = "com.sukusuku.nursingalarm.START"
    const val ACTION_STOP = "com.sukusuku.nursingalarm.STOP"

    const val EXTRA_SIDE = "side"
    const val EXTRA_BASELINE_AT = "baselineAt"
    const val EXTRA_INTERVAL_MINUTES = "intervalMinutes"

    private const val CHANNEL_ID = "nursing_ongoing"
    private const val NOTIFICATION_ID = 1001
    private const val TICK_MS = 1000L
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tonePlayer = AlarmTonePlayer()

  private var side: String = "left"
  private var baselineAt: Long = 0

  /** 何分ごとに知らせるか。鳴り方（長短）はこの値に関係なく同じ数え方で組み立てる。 */
  private var intervalMinutes: Int = 5

  /** 何回目のお知らせまで鳴らしたか。左右を切り替えたときはその側の経過ぶんまで進めておく。 */
  private var notifiedStep: Int = 0

  /** 常駐通知の文言を書き換えるのは分が変わったときだけにする。 */
  private var shownMinutes: Int = -1

  private var wakeLock: PowerManager.WakeLock? = null

  private val tick = object : Runnable {
    override fun run() {
      onTick()
      handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    side = intent?.getStringExtra(EXTRA_SIDE) ?: side
    baselineAt = intent?.getLongExtra(EXTRA_BASELINE_AT, baselineAt) ?: baselineAt
    intervalMinutes = (intent?.getIntExtra(EXTRA_INTERVAL_MINUTES, intervalMinutes) ?: intervalMinutes)
      .coerceAtLeast(1)
    // 切り替え前の側で鳴らした分をもう一度鳴らさないよう、いまの経過ぶんまで進めた状態から始める。
    notifiedStep = elapsedMinutes() / intervalMinutes
    shownMinutes = -1

    createChannel()
    startInForeground()
    acquireWakeLock()

    handler.removeCallbacks(tick)
    handler.post(tick)
    // 明示的に止めるまで動き続ける。落とされた場合は、アプリが前面に戻ったときに
    // 端末に控えてある計測から掛け直す（src/lib/nursingAlarm.ts）。
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    tonePlayer.stop()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun elapsedMinutes(): Int {
    val elapsedMs = (System.currentTimeMillis() - baselineAt).coerceAtLeast(0)
    return (elapsedMs / 60_000L).toInt()
  }

  private fun onTick() {
    val minutes = elapsedMinutes()
    val step = minutes / intervalMinutes
    if (step >= 1 && step > notifiedStep) {
      notifiedStep = step
      fireAlarm(buildAlarmPattern(step * intervalMinutes))
    }
    if (minutes != shownMinutes) {
      shownMinutes = minutes
      notificationManager().notify(NOTIFICATION_ID, buildNotification(minutes))
    }
  }

  private fun fireAlarm(pattern: AlarmPattern) {
    vibrate(pattern)
    tonePlayer.play(pattern)
  }

  private fun vibrate(pattern: AlarmPattern) {
    val timings = pattern.toVibrationSequence()
    if (timings.isEmpty()) return
    // createWaveform の先頭は「鳴らすまでの待ち時間」なので、0を足してから並べる。
    val waveform = LongArray(timings.size + 1)
    System.arraycopy(timings, 0, waveform, 1, timings.size)
    vibrator()?.vibrate(VibrationEffect.createWaveform(waveform, -1))
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
    // 音と振動はサービスが自分で鳴らすので、通知そのものは黙らせておく
    // （チャンネルに音を持たせると長短の鳴らし分けができなくなる）。
    val channel = NotificationChannel(CHANNEL_ID, "授乳中", NotificationManager.IMPORTANCE_LOW).apply {
      description = "授乳の計測中に出しっぱなしにする通知"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    notificationManager().createNotificationChannel(channel)
  }

  private fun startInForeground() {
    val notification = buildNotification(elapsedMinutes())
    // specialUse はAndroid 14で入った種別なので、渡すのもそこから。
    // それより前は種別なしで始める（マニフェストの宣言だけで足りる）。
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(minutes: Int): Notification {
    val sideLabel = if (side == "right") "右" else "左"
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("授乳 ${minutes}分 $sideLabel")
      .setContentText("${intervalMinutes}分ごとにお知らせします")
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(launchAppIntent())
      .build()
  }

  /** 通知をタップしたらアプリを開く。計測を止めるのは画面側で行う。 */
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

  /** 画面が消えている間もCPUを止めさせない。前面サービスでも機種によっては間引かれるため。 */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = manager
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sukusuku:nursing")
      .apply { acquire() }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }
}
