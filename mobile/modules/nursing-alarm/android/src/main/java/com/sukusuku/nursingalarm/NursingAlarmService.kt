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

/**
 * 授乳中だけ動く前面サービス。
 *
 * 常駐通知に「授乳 3分 左」と出しながら経過時間を自分で数え、5分たつごとに
 * 音（[AlarmTonePlayer]）と振動を鳴らす。鳴る回数は経過時間で変わり（5分=1回、10分=2回…。
 * 規則は [buildAlarmPattern]）、画面を見なくても何分たったかが分かる。ローカル通知を並べて
 * 予約する形にしないのは、Android 8以降は通知の音と振動がチャンネルに固定され、鳴らし分けが
 * できないため（docs/native-app-android.md §3）。
 *
 * 数えるのに要るのは「その側の合計時間が0だった時刻(baselineAt)」だけで、
 * 左右の切り替えは baselineAt を入れ替えた [ACTION_START] として届く。
 *
 * 1つの側が [MAX_MINUTES] に達したら数えるのをやめ、常駐通知を「記録してください」に
 * 書き換えて残す（止め忘れても鳴り続けない。アプリを開いて記録するまでの目印）。
 * 通知を消すのはアプリ側で、記録・リセット・締めのいずれかのときに [stop] が届く。
 */
class NursingAlarmService : Service() {
  companion object {
    const val ACTION_START = "com.sukusuku.nursingalarm.START"
    const val ACTION_STOP = "com.sukusuku.nursingalarm.STOP"

    const val EXTRA_PHASE = "phase"
    const val EXTRA_BASELINE_AT = "baselineAt"
    const val EXTRA_PHASE_MINUTES = "phaseMinutes"

    /** 1つの側を測れる上限（分）。ここまで数えたら止める（アプリ側 NURSING_MAX_MS と合わせる）。 */
    private const val MAX_MINUTES = 60

    private const val CHANNEL_ID = "nursing_ongoing"
    private const val NOTIFICATION_ID = 1001
    private const val TICK_MS = 1000L
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tonePlayer = AlarmTonePlayer()

  private var phase: String = "left"
  private var baselineAt: Long = 0

  /** お知らせの間隔（分）。経過がこの倍数に達するたびに鳴らす。 */
  private var phaseMinutes: Int = 5

  /** どこまで鳴らし終えたか（何回目の間隔か）。預け直しのときは経過ぶんを見て決める。 */
  private var notifiedStep: Int = 0

  /** 上限まで測り終えて、あとは記録を待つだけの状態か。 */
  private var pendingRecord: Boolean = false

  /** 常駐通知の文言を書き換えるのは分が変わったときだけにする。 */
  private var shownMinutes: Int = -1

  private var wakeLock: PowerManager.WakeLock? = null

  private val tick = object : Runnable {
    override fun run() {
      onTick()
      // 上限で止めたら次を積まない（onTick の中で外しても、この直後にまた積んでしまう）。
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
    // 預け直しで鳴り直さないよう、すでに過ぎた間隔は鳴らし済みとして始める。
    notifiedStep = elapsedMinutes() / phaseMinutes
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
    val step = minutes / phaseMinutes
    if (step > notifiedStep) {
      notifiedStep = step
      // 経過時間そのものを回数で伝える（5分=短1、10分=短2…。30分から長音が入る）。
      fireAlarm(buildAlarmPattern(step * phaseMinutes))
    }
    // 上限まで測り終えたら、数えるのをやめ、記録を促す通知に切り替える。
    if (minutes >= MAX_MINUTES) {
      finishMeasuring()
      return
    }
    if (minutes != shownMinutes) {
      shownMinutes = minutes
      notificationManager().notify(NOTIFICATION_ID, buildNotification(minutes))
    }
  }

  /**
   * 上限まで測り終えたあと、記録されるまでの状態にする。
   *
   * サービスは止めずに通知だけ残すのは、アプリを閉じたまま授乳を終えたときに
   * 「記録がまだ」と気づける場所が通知バーしかないため。アプリを開けば、
   * 端末に控えた計測から同じ締めが行われ、そのとき [stop] が届いて通知も消える。
   */
  private fun finishMeasuring() {
    pendingRecord = true
    releaseWakeLock()
    shownMinutes = -1
    notificationManager().notify(NOTIFICATION_ID, buildNotification(MAX_MINUTES))
  }

  private fun fireAlarm(pattern: AlarmPattern) {
    vibrate(pattern)
    tonePlayer.play(pattern)
  }

  /**
   * お知らせを振動で伝える。
   *
   * **アラームとしての振動だと伝えないと、マナーモードでは振動しない。** 属性を付けずに
   * 呼ぶと用途が「不明」のまま扱われ、端末の設定（消音時の振動・通知の振動）に従って
   * 落とされてしまう。音を [AudioAttributes.USAGE_ALARM] で出しているのと同じ理由で、
   * 振動にもアラームの用途を付ける。
   */
  private fun vibrate(pattern: AlarmPattern) {
    val timings = pattern.toVibrationSequence()
    if (timings.isEmpty()) return
    val device = vibrator() ?: return
    // createWaveform の先頭は「鳴らすまでの待ち時間」なので、0を足してから並べる。
    val waveform = LongArray(timings.size + 1)
    System.arraycopy(timings, 0, waveform, 1, timings.size)
    val effect = VibrationEffect.createWaveform(waveform, -1)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      device.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
    } else {
      // Android 12以前は VibrationAttributes が無いので、音と同じ AudioAttributes で伝える。
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

  /** 側の呼び名。アプリ側の getSideLabel と同じ。 */
  private fun phaseLabel(): String = if (phase == "right") "右" else "左"

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
    } else {
      "${phaseMinutes}分ごとにお知らせします"
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
