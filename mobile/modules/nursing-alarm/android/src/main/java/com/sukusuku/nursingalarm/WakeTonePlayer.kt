package com.sukusuku.nursingalarm

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.sin

/**
 * 起床アラームの音。目が覚めるよう、高い短音を3つ＋少し高い音を1つ並べた2秒ほどの
 * ひと節を、止めるまで繰り返す。音量は [setVolume] で小さく始めて上げていく
 * （呼ぶのはサービス側）。
 *
 * 授乳中の区切りの音（[AlarmTonePlayer]、低め・1回きり）とは別物にして、聞き分けられるようにする。
 * 音声ファイルは持たず、[AlarmTonePlayer] と同じく合成する。出し方も同じ
 * [AudioAttributes.USAGE_ALARM] で、マナーモードでも鳴り、端末のアラーム音量に乗る。
 */
class WakeTonePlayer {
  private companion object {
    const val SAMPLE_RATE = 44100
    const val AMPLITUDE = 0.6
    const val FADE_SEC = 0.02
    const val BEEP_SEC = 0.2
    const val GAP_SEC = 0.12

    /** 短音3つの高さと、最後の少し高い1つ。 */
    val BEEP_HZ = doubleArrayOf(880.0, 880.0, 880.0, 1175.0)

    /** ひと節の終わりに空ける間。 */
    const val TAIL_SEC = 1.0
  }

  private var track: AudioTrack? = null

  /** 鳴らし始める。音量は 0.0〜1.0。止めるまで繰り返す。 */
  fun start(initialVolume: Float) {
    stop()
    val samples = render()
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(SAMPLE_RATE)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val next = AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(format)
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setBufferSizeInBytes(samples.size * 2)
      .build()
    next.write(samples, 0, samples.size)
    next.setLoopPoints(0, samples.size, -1)
    next.setVolume(initialVolume.coerceIn(0f, 1f))
    next.play()
    track = next
  }

  fun setVolume(volume: Float) {
    track?.setVolume(volume.coerceIn(0f, 1f))
  }

  fun stop() {
    track?.let {
      runCatching { it.stop() }
      it.release()
    }
    track = null
  }

  /** ひと節ぶんのPCM。繰り返してもつなぎ目で切れないよう、終わりに無音の間を足しておく。 */
  private fun render(): ShortArray {
    val beepSamples = (BEEP_SEC * SAMPLE_RATE).toInt()
    val gapSamples = (GAP_SEC * SAMPLE_RATE).toInt()
    val tailSamples = (TAIL_SEC * SAMPLE_RATE).toInt()
    val samples = ShortArray(BEEP_HZ.size * (beepSamples + gapSamples) + tailSamples)

    var offset = 0
    for (frequency in BEEP_HZ) {
      val fade = (FADE_SEC * SAMPLE_RATE).toInt().coerceAtMost(beepSamples / 2)
      for (i in 0 until beepSamples) {
        val envelope = when {
          fade <= 0 -> 1.0
          i < fade -> i.toDouble() / fade
          i > beepSamples - fade -> (beepSamples - i).toDouble() / fade
          else -> 1.0
        }
        val value = sin(2.0 * PI * frequency * i / SAMPLE_RATE) * AMPLITUDE * envelope
        samples[offset + i] = (value * Short.MAX_VALUE).toInt().toShort()
      }
      offset += beepSamples + gapSamples
    }
    return samples
  }
}
