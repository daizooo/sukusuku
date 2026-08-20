'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  buildAlarmPattern,
  isVibrationSupported,
  playAlarmPattern,
  requestScreenWakeLock,
  stopVibration,
  unlockAudio,
  vibrateAlarmPattern,
  type AlarmPattern,
  type WakeLockSentinelLike,
} from '@/lib/alarm';
import {
  elapsedOf,
  finishNursingTimer,
  getNursingTimerServerSnapshot,
  getNursingTimerSnapshot,
  markNursingAlarmNotified,
  pauseNursingTimer,
  resetNursingTimer,
  resumeNursingTimer,
  setNursingSide,
  startNursingTimer,
  subscribeNursingTimer,
  updateNursingTimerSettings,
  type NursingSide,
  type NursingTimerSettings,
} from '@/lib/nursingTimerStore';

export {
  ALARM_INTERVAL_OPTIONS,
  NURSING_SIDES,
  NURSING_SIDE_LABELS,
  type NursingSide,
  type NursingTimerSettings,
} from '@/lib/nursingTimerStore';

const TICK_MS = 500;

// バイブ対応可否はブラウザ依存なので、サーバー描画では常にfalseを返してズレを防ぐ
const subscribeNothing = () => () => {};

export interface NursingTimer {
  isRunning: boolean;
  isPaused: boolean;
  hasStarted: boolean;
  elapsedMs: number;
  /** 次のお知らせまでの残りミリ秒 */
  remainingToNextAlarmMs: number;
  side: NursingSide;
  settings: NursingTimerSettings;
  /** 直近に鳴らしたお知らせのパターン（まだ鳴っていなければnull） */
  lastPattern: AlarmPattern | null;
  vibrationSupported: boolean;
  start: (side?: NursingSide) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  /** 計測を終了し、経過時間と授乳箇所を返す（育児記録への保存用） */
  finish: () => { durationMs: number; side: NursingSide } | null;
  setSide: (side: NursingSide) => void;
  updateSettings: (patch: Partial<NursingTimerSettings>) => void;
  /** 設定した鳴り方を試聴する */
  testAlarm: () => void;
}

export function useNursingTimer(): NursingTimer {
  const { state, settings } = useSyncExternalStore(
    subscribeNursingTimer,
    getNursingTimerSnapshot,
    getNursingTimerServerSnapshot,
  );
  const vibrationSupported = useSyncExternalStore(
    subscribeNothing,
    isVibrationSupported,
    () => false,
  );

  const [now, setNow] = useState(() => Date.now());
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const isRunning = state.runningSince !== null;
  const elapsedMs = elapsedOf(state, now);
  const intervalMs = settings.intervalMinutes * 60_000;

  // 経過時間は常に実時刻から計算するので、タブが裏に回ってsetIntervalが
  // 間引かれてもズレは蓄積しない（お知らせのタイミングは遅れうる）。
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // 画面が復帰したら即座に時刻を取り直し、鳴らし損ねたお知らせに追いつかせる
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // 計測中は画面を消灯させない（消灯するとタイマーが間引かれ、お知らせが遅れる）
  useEffect(() => {
    if (!isRunning) return;

    let cancelled = false;
    const acquire = async () => {
      if (wakeLockRef.current && !wakeLockRef.current.released) return;
      const sentinel = await requestScreenWakeLock();
      if (cancelled) {
        void sentinel?.release();
        return;
      }
      wakeLockRef.current = sentinel;
    };
    void acquire();

    // タブを離れるとロックは自動解放されるため、戻ってきたら取り直す
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      void sentinel?.release();
    };
  }, [isRunning]);

  // 経過が次の区切りに達したらお知らせを鳴らす
  useEffect(() => {
    if (!isRunning) return;
    const step = Math.floor(elapsedMs / intervalMs);
    if (step < 1 || step <= state.notifiedStep) return;

    const pattern = buildAlarmPattern(step * settings.intervalMinutes, settings.intervalMinutes);
    if (settings.soundEnabled) playAlarmPattern(pattern);
    if (settings.vibrationEnabled) vibrateAlarmPattern(pattern);
    markNursingAlarmNotified(step);
  }, [isRunning, elapsedMs, intervalMs, state.notifiedStep, settings]);

  const start = useCallback((side?: NursingSide) => {
    // iOS/Chromeはユーザー操作のハンドラ内でしか音の再生を許可しないため、ここで解除する
    void unlockAudio();
    setNow(Date.now());
    startNursingTimer(side);
  }, []);

  const pause = useCallback(() => {
    stopVibration();
    pauseNursingTimer();
  }, []);

  const resume = useCallback(() => {
    void unlockAudio();
    setNow(Date.now());
    resumeNursingTimer();
  }, []);

  const reset = useCallback(() => {
    stopVibration();
    resetNursingTimer();
  }, []);

  const finish = useCallback(() => {
    stopVibration();
    return finishNursingTimer();
  }, []);

  const testAlarm = useCallback(() => {
    void unlockAudio().then(() => {
      // 「長音1回＋短音1回」= 30分＋間隔1つ分。長短どちらの鳴り方も確認できる
      const pattern: AlarmPattern = { long: 1, short: 1 };
      if (settings.soundEnabled) playAlarmPattern(pattern);
      if (settings.vibrationEnabled) vibrateAlarmPattern(pattern);
    });
  }, [settings.soundEnabled, settings.vibrationEnabled]);

  // 直近のお知らせは「通知済み回数」から導けるので、別途stateを持たない
  const lastPattern = useMemo<AlarmPattern | null>(
    () =>
      state.notifiedStep > 0
        ? buildAlarmPattern(state.notifiedStep * settings.intervalMinutes, settings.intervalMinutes)
        : null,
    [state.notifiedStep, settings.intervalMinutes],
  );

  const remainingToNextAlarmMs = elapsedMs === 0 ? intervalMs : intervalMs - (elapsedMs % intervalMs);

  return {
    isRunning,
    isPaused: !isRunning && state.accumulatedMs > 0,
    hasStarted: isRunning || state.accumulatedMs > 0,
    elapsedMs,
    remainingToNextAlarmMs,
    side: state.side,
    settings,
    lastPattern,
    vibrationSupported,
    start,
    pause,
    resume,
    reset,
    finish,
    setSide: setNursingSide,
    updateSettings: updateNursingTimerSettings,
    testAlarm,
  };
}
