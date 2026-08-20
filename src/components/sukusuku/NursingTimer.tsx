'use client';

import { Baby, Pause, Play, RotateCcw, Square, Vibrate, Volume2, VolumeX } from 'lucide-react';

import { buildAlarmPattern, describeAlarmPattern } from '@/lib/alarm';
import { formatDurationClock } from '@/lib/dateUtils';
import {
  ALARM_INTERVAL_OPTIONS,
  NURSING_SIDES,
  NURSING_SIDE_LABELS,
  type NursingTimer as NursingTimerState,
} from '@/hooks/useNursingTimer';

interface NursingTimerProps {
  timer: NursingTimerState;
  /** 「記録して終了」で育児記録に残す */
  onFinish: () => void;
}

// 鳴り方の凡例（お知らせ間隔 → 30分まで。多くなりすぎないよう間引く）
const buildLegendMinutes = (intervalMinutes: number): number[] => {
  const minutes: number[] = [];
  for (let m = intervalMinutes; m < 30 && minutes.length < 5; m += intervalMinutes) {
    minutes.push(m);
  }
  minutes.push(30);
  return minutes;
};

export default function NursingTimer({ timer, onFinish }: NursingTimerProps) {
  const {
    isRunning,
    isPaused,
    hasStarted,
    elapsedMs,
    remainingToNextAlarmMs,
    side,
    settings,
    lastPattern,
    vibrationSupported,
    start,
    pause,
    resume,
    reset,
    setSide,
    updateSettings,
    testAlarm,
  } = timer;

  const legendMinutes = buildLegendMinutes(settings.intervalMinutes);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4 shrink-0">
      <div className="bg-gradient-to-r from-rose-500 to-pink-500 px-4 py-2.5 flex items-center justify-between">
        <h3 className="text-white font-bold text-sm flex items-center">
          <Baby size={16} className="mr-1.5" />
          授乳タイマー
        </h3>
        <span className="text-[10px] text-white/90 font-medium">
          {settings.intervalMinutes}分ごとにお知らせ
        </span>
      </div>

      <div className="p-4">
        {/* 授乳箇所。計測中でも押し間違いを直せるよう切り替え可能にしている */}
        <div className="flex gap-2 mb-3">
          {NURSING_SIDES.map((option) => (
            <button
              key={option}
              onClick={() => setSide(option)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                side === option
                  ? 'bg-rose-50 text-rose-600 border-rose-300'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {NURSING_SIDE_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="text-center py-2">
          <p className="text-5xl font-bold text-gray-800 tabular-nums tracking-tight">
            {formatDurationClock(elapsedMs)}
          </p>
          <p className="text-xs text-gray-500 mt-1.5">
            {isRunning ? (
              <>
                次のお知らせまで{' '}
                <span className="font-bold text-rose-500 tabular-nums">
                  {formatDurationClock(remainingToNextAlarmMs)}
                </span>
              </>
            ) : isPaused ? (
              '一時停止中'
            ) : (
              '開始すると経過時間をお知らせします'
            )}
          </p>
          {lastPattern && (
            <p className="text-[11px] text-gray-400 mt-1">
              直前のお知らせ: {describeAlarmPattern(lastPattern)}
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          {!isRunning ? (
            <button
              onClick={() => (isPaused ? resume() : start())}
              className="flex-1 bg-rose-500 text-white font-bold py-3 rounded-xl flex items-center justify-center shadow-sm hover:bg-rose-600 transition active:scale-95"
            >
              <Play size={18} className="mr-1.5" />
              {isPaused ? '再開' : '開始'}
            </button>
          ) : (
            <button
              onClick={pause}
              className="flex-1 bg-gray-700 text-white font-bold py-3 rounded-xl flex items-center justify-center shadow-sm hover:bg-gray-800 transition active:scale-95"
            >
              <Pause size={18} className="mr-1.5" />
              一時停止
            </button>
          )}
          {hasStarted && (
            <>
              <button
                onClick={onFinish}
                className="flex-1 bg-white text-rose-600 font-bold py-3 rounded-xl border border-rose-300 flex items-center justify-center hover:bg-rose-50 transition active:scale-95"
              >
                <Square size={16} className="mr-1.5" />
                記録して終了
              </button>
              <button
                onClick={reset}
                aria-label="リセット"
                className="w-12 shrink-0 bg-white text-gray-500 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition active:scale-95"
              >
                <RotateCcw size={16} />
              </button>
            </>
          )}
        </div>

        {/* --- お知らせの設定 --- */}
        <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
          <div>
            <p className="text-[11px] font-bold text-gray-500 mb-1.5">お知らせ間隔</p>
            <div className="flex gap-1.5">
              {ALARM_INTERVAL_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => updateSettings({ intervalMinutes: minutes })}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                    settings.intervalMinutes === minutes
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {minutes}分
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border flex items-center justify-center transition ${
                settings.soundEnabled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-gray-400 border-gray-200'
              }`}
            >
              {settings.soundEnabled ? (
                <Volume2 size={14} className="mr-1" />
              ) : (
                <VolumeX size={14} className="mr-1" />
              )}
              音 {settings.soundEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => updateSettings({ vibrationEnabled: !settings.vibrationEnabled })}
              disabled={!vibrationSupported}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg border flex items-center justify-center transition ${
                !vibrationSupported
                  ? 'bg-gray-50 text-gray-300 border-gray-200'
                  : settings.vibrationEnabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-gray-400 border-gray-200'
              }`}
            >
              <Vibrate size={14} className="mr-1" />
              バイブ {!vibrationSupported ? '非対応' : settings.vibrationEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={testAlarm}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
            >
              テスト
            </button>
          </div>

          {/* 画面を見なくても経過時間が分かるよう、鳴り方の対応表を出す */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[11px] font-bold text-gray-500 mb-1.5">鳴り方で分かる経過時間</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {legendMinutes.map((minutes) => (
                <div key={minutes} className="flex items-baseline justify-between">
                  <span className="text-[11px] font-bold text-gray-700 tabular-nums">{minutes}分</span>
                  <span className="text-[11px] text-gray-500">
                    {describeAlarmPattern(buildAlarmPattern(minutes, settings.intervalMinutes))}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
              短い「ピッ」1回＝{settings.intervalMinutes}分、長い「ポーン」1回＝30分。
              例）{30 + settings.intervalMinutes}分は「
              {describeAlarmPattern(buildAlarmPattern(30 + settings.intervalMinutes, settings.intervalMinutes))}
              」。バイブも同じ長短のパターンで振動します。
            </p>
          </div>

          <p className="text-[10px] text-gray-400 leading-relaxed">
            計測中は画面が消えないようにします（対応ブラウザのみ）。画面を消したり
            他のアプリに切り替えたりすると、ブラウザの制限でお知らせが遅れることがあります。
            {!vibrationSupported && ' iPhoneのSafariはバイブに対応していないため、音でお知らせします。'}
          </p>
        </div>
      </div>
    </div>
  );
}
