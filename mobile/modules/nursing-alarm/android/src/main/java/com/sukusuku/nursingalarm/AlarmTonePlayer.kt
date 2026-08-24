package com.sukusuku.nursingalarm

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * 長音・短音のビープをその場で合成して鳴らす。
 *
 * PWA版はWeb Audio APIで同じことをしていた（`src/lib/alarm.ts`）。音声ファイルを持たずに済み、
 * 長さと高さを規則どおりに組み立てられるので、ネイティブでも合成のまま持ってきている。
 *
 * 音は [AudioAttributes.USAGE_ALARM] で出す。マナーモードでも鳴り、音量は端末の
 * アラーム音量に乗る（夜中に鳴らすものなので、着信音量とは別に決められるほうがよい）。
 */
class AlarmTonePlayer {
  private companion object {
    const val SAMPLE_RATE = 44100

    const val SHORT_BEEP_SEC = 0.18
    const val LONG_BEEP_SEC = 0.6
    const val GAP_SEC = 0.12

    /** 高い「ピッ」= 5分。 */
    const val SHORT_BEEP_HZ = 880.0

    /** 低い「ポーン」= 30分。 */
    const val LONG_BEEP_HZ = 440.0

    /** 長音と短音の境目に足す間。聞き分けやすくするため。 */
    const val GROUP_GAP_SEC = 0.25

    const val AMPLITUDE = 0.35

    /** 立ち上がり・立ち下がりを鈍らせてプチッというノイズを防ぐ。 */
    const val FADE_SEC = 0.02
  }

  private var track: AudioTrack? = null

  /** 長音→短音の順に鳴らす。回数を数えれば経過時間が分かる。 */
  fun play(pattern: AlarmPattern) {
    if (pattern.isEmpty) return
    val samples = render(pattern)
    if (samples.isEmpty()) return

    stop()
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
    next.play()
    track = next
  }

  fun stop() {
    track?.let {
      runCatching { it.stop() }
      it.release()
    }
    track = null
  }

  /** パターン全体を1本のPCMに書き出す。無音の間も含めて並べる。 */
  private fun render(pattern: AlarmPattern): ShortArray {
    val totalSec =
      pattern.long * (LONG_BEEP_SEC + GAP_SEC) +
        (if (pattern.long > 0 && pattern.short > 0) GROUP_GAP_SEC else 0.0) +
        pattern.short * (SHORT_BEEP_SEC + GAP_SEC)
    val samples = ShortArray((totalSec * SAMPLE_RATE).toInt().coerceAtLeast(1))

    var offset = 0
    repeat(pattern.long) {
      offset = writeBeep(samples, offset, LONG_BEEP_HZ, LONG_BEEP_SEC)
      offset += (GAP_SEC * SAMPLE_RATE).toInt()
    }
    if (pattern.long > 0 && pattern.short > 0) offset += (GROUP_GAP_SEC * SAMPLE_RATE).toInt()
    repeat(pattern.short) {
      offset = writeBeep(samples, offset, SHORT_BEEP_HZ, SHORT_BEEP_SEC)
      offset += (GAP_SEC * SAMPLE_RATE).toInt()
    }
    return samples
  }

  /** サイン波を1つ書き込み、書き終わった位置を返す。 */
  private fun writeBeep(samples: ShortArray, offset: Int, frequency: Double, durationSec: Double): Int {
    val length = min((durationSec * SAMPLE_RATE).toInt(), samples.size - offset)
    if (length <= 0) return offset
    val fade = (FADE_SEC * SAMPLE_RATE).toInt().coerceAtMost(length / 2)
    for (i in 0 until length) {
      val envelope = when {
        fade <= 0 -> 1.0
        i < fade -> i.toDouble() / fade
        i > length - fade -> (length - i).toDouble() / fade
        else -> 1.0
      }
      val value = sin(2.0 * PI * frequency * i / SAMPLE_RATE) * AMPLITUDE * envelope
      samples[offset + i] = (value * Short.MAX_VALUE).toInt().toShort()
    }
    return offset + length
  }
}
