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
 * 常駐通知に「授乳 3分 左」と出しながら経過時間を自分で数え、その区切りが5分に達したら
 * 音（[AlarmTonePlayer]）と振動を**1回だけ**鳴らす。ローカル通知を並べて予約する形に
 * しないのは、Android 8以降は通知の音と振動がチャンネルに固定され、鳴らし分けが
 * できないため（docs/native-app-android.md §3）。
 *
 * 数えるのに要るのは「その区切りの合計時間が0だった時刻(baselineAt)」だけで、
 * 区切りの切り替えは baselineAt を入れ替えた [ACTION_START] として届く。
 *
 * ゲップの5分まで終わればそのセットは完了。そこで数えるのをやめ、常駐通知を
 * 「記録してください」に書き換えて残す（アプリを開いて記録するまでの目印）。
 * 通知を消すのはアプリ側で、記録・リセット・締めのいずれかのときに [stop] が届く。
 */
class NursingAlarmService : Service() {
  companion object {
    const val ACTION_START = "com.sukusuku.nursingalarm.START"
    const val ACTION_STOP = "com.sukusuku.nursingalarm.STOP"

    const val EXTRA_PHASE = "phase"
    const val EXTRA_BASELINE_AT = "baselineAt"
    const val EXTRA_PHASE_MINUTES = "phaseMinutes"

    /** ゲップ。ここまで終われば1セット完了。 */
    private const val PHASE_BURP = "burp"

    private const val CHANNEL_ID = "nursing_ongoing"
    private const val NOTIFICATION_ID = 1001
    private const val TICK_MS = 1000L
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tonePlayer = AlarmTonePlayer()

  private var phase: String = "left"
  private var baselineAt: Long = 0

  /** 1区切りの長さ（分）。ここに達したら1回だけ鳴らす。 */
  private var phaseMinutes: Int = 5

  /** いまの区切りで鳴らし終えたか。預け直しのときは経過ぶんを見て決める。 */
  private var notified: Boolean = false

  /** ゲップまで終わって、あとは記録を待つだけの状態か。 */
  private var pendingRecord: Boolean = false

  /** 常駐通知の文言を書き換えるのは分が変わったときだけにする。 */
  private var shownMinutes: Int = -1

  private var wakeLock: PowerManager.WakeLock? = null

  private val tick = object : Runnable {
    override fun run() {
      onTick()
      // セットが終わったら次を積まない（onTick の中で外しても、この直後にまた積んでしまう）。
      if (!pendingRecord) handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    phase = intent?.getStringExtra(EXTRA_PHASE) ?: phase
    baselineAt = intent?.getLongExtra(EXTRA_BASELINE_AT, baselineAt) ?: baselineAt
    phaseMinutes = (intent?.getIntExtra(EXTRA_PHASE_MINUTES, phaseMinutes) ?: phaseMinutes)
      .coerceAtLeast(1)
    // 預け直しで鳴り直さないよう、もう5分を過ぎている区切りは鳴らし済みとして始める。
    notified = elapsedMinutes() >= phaseMinutes
    pendingRecord = false
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
    if (!notified && minutes >= phaseMinutes) {
      notified = true
      fireAlarm(buildAlarmPattern(phaseMinutes))
      // ゲップまで終われば1セット完了。数えるのをやめ、記録を促す通知に切り替える。
      if (phase == PHASE_BURP) {
        finishSet()
        return
      }
    }
    if (minutes != shownMinutes) {
      shownMinutes = minutes
      notificationManager().notify(NOTIFICATION_ID, buildNotification(minutes))
    }
  }

  /**
   * 1セット終わったあと、記録されるまでの状態にする。
   *
   * サービスは止めずに通知だけ残すのは、アプリを閉じたまま授乳を終えたときに
   * 「記録がまだ」と気づける場所が通知バーしかないため。アプリを開けば、
   * 端末に控えた計測から同じ締めが行われ、そのとき [stop] が届いて通知も消える。
   */
  private fun finishSet() {
    pendingRecord = true
    releaseWakeLock()
    shownMinutes = -1
    notificationManager().notify(NOTIFICATION_ID, buildNotification(phaseMinutes))
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

  /** 区切りの呼び名。アプリ側の getNursingPhaseLabel と同じ。 */
  private fun phaseLabel(): String = when (phase) {
    PHASE_BURP -> "ゲップ"
    "right" -> "右"
    else -> "左"
  }

  private fun buildNotification(minutes: Int): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val title = if (pendingRecord) "授乳が終わりました" else "授乳 ${minutes}分 ${phaseLabel()}"
    val text = if (pendingRecord) {
      "タップして記録してください"
    } else if (notified) {
      "${phaseMinutes}分経過 — 次の区切りへ"
    } else {
      "${phaseMinutes}分でお知らせします"
    }
    return builder
      .setContentTitle(title)
      .setContentText(text)
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
