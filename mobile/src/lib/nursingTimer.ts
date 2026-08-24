import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BreastSide } from '@/types/app';
import {
  applyNursingAlarm,
  NURSING_ALARM_INTERVAL_MINUTES,
  type NursingAlarmTarget,
} from '@/lib/nursingAlarm';

// 母乳の授乳時間を左右それぞれ計測するストップウォッチ。
//
// 授乳中は入力画面を閉じたり他の画面へ移ったりするため、計測中の値は端末内に控えておき、
// 戻ってきたときに続きから測れるようにする（記録として保存する前の値なので、DBには持たせない）。
//
// PWA版(src/lib/nursingTimer.ts)からの作り直し。変わったのは次の2つ。
// - 控え先が localStorage から AsyncStorage へ。読み書きが非同期なので、
//   起動直後は空から始めて読み終えた時点で差し替える
// - 「何回目のお知らせまで鳴らしたか」を持たない。数えるのは前面サービスの側になったので、
//   こちらは「いまどちらを何時から測っているか」だけを預ける（src/lib/nursingAlarm.ts）

const STORAGE_KEY = 'sukusuku:activeNursing';

interface ActiveNursing {
  /** 停止済みの累積時間(ミリ秒)。 */
  leftMs: number;
  rightMs: number;
  /** 計測中の側と、その計測を始めた時刻。停止中は null。 */
  runningSide: BreastSide | null;
  startedAt: number | null;
  /** 最後に計測した側。記録の「最後に飲ませた側」に使う。 */
  lastSide: BreastSide | null;
}

const EMPTY: ActiveNursing = {
  leftMs: 0,
  rightMs: 0,
  runningSide: null,
  startedAt: null,
  lastSide: null,
};

const toMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const toSide = (value: unknown): BreastSide | null =>
  value === 'left' || value === 'right' ? value : null;

const parse = (raw: string | null): ActiveNursing => {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveNursing>;
    const startedAt = toMs(parsed.startedAt) || null;
    return {
      leftMs: toMs(parsed.leftMs),
      rightMs: toMs(parsed.rightMs),
      // 開始時刻が失われていると経過時間を復元できないので、計測中とは扱わない。
      runningSide: startedAt ? toSide(parsed.runningSide) : null,
      startedAt,
      lastSide: toSide(parsed.lastSide),
    };
  } catch {
    return EMPTY;
  }
};

// --- 計測中の値を持つ外部ストア ---

let cached: ActiveNursing = EMPTY;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const getSnapshot = (): ActiveNursing => cached;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 計測していなければ null（＝前面サービスを止める）。 */
const alarmTarget = (active: ActiveNursing): NursingAlarmTarget | null => {
  const side = active.runningSide;
  if (!side || !active.startedAt) return null;
  return {
    side,
    // 左右を行き来してもその側の経過時間で数えるので、累積ぶんさかのぼった時刻を基準にする。
    baselineAt: active.startedAt - (side === 'left' ? active.leftMs : active.rightMs),
    intervalMinutes: NURSING_ALARM_INTERVAL_MINUTES,
  };
};

const store = (next: ActiveNursing) => {
  cached = next;
  const isEmpty = next.runningSide === null && next.leftMs === 0 && next.rightMs === 0;
  // 控えの書き込みを待たせると、押した手応えが遅れる。結果は待たない。
  void (isEmpty
    ? AsyncStorage.removeItem(STORAGE_KEY)
    : AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  ).catch(() => {
    // 控えられなくても計測そのものは続く（アプリを閉じたときに失われるだけ）。
  });
  emit();
  applyNursingAlarm(alarmTarget(next));
};

let hydration: Promise<void> | null = null;

/** 端末に控えた計測を読み戻し、続きから測れるようにする。 */
const hydrate = (): Promise<void> => {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        cached = parse(raw);
        emit();
      })
      .catch(() => {
        // 読めなければ計測なしとして始める。
      });
  }
  return hydration;
};

// --- 経過時間の表示を進めるための時計 ---
// 描画のたびに現在時刻を読まずに済むよう、時計も外部ストアとして扱う。

let clockNow = 0;
let clockTimerId: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

const getClockSnapshot = (): number => clockNow;

const subscribeClock = (listener: () => void): (() => void) => {
  clockListeners.add(listener);
  clockNow = Date.now();
  if (clockTimerId === null) {
    clockTimerId = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((clockListener) => clockListener());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimerId !== null) {
      clearInterval(clockTimerId);
      clockTimerId = null;
    }
  };
};

/** 計測していない間は時計を動かす必要がないので、購読しない。 */
const subscribeNothing = (): (() => void) => () => {};

/**
 * 端末に控えた計測を読み戻し、前面サービスへ預け直す。アプリ全体で1回だけ動かす。
 *
 * 前面サービスは機種によっては落とされることがあるので、前面に戻るたびに預け直す。
 * 預け直しても「何回目まで鳴らしたか」はいまの経過ぶんから数え始めるので、鳴り直さない。
 */
export function useNursingAlarmWatcher(): void {
  useEffect(() => {
    void hydrate().then(() => applyNursingAlarm(alarmTarget(getSnapshot())));

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyNursingAlarm(alarmTarget(getSnapshot()));
    });
    return () => subscription.remove();
  }, []);
}

export interface NursingTimer {
  /** 左の合計時間(ミリ秒)。計測中の分を含む。 */
  leftMs: number;
  /** 右の合計時間(ミリ秒)。計測中の分を含む。 */
  rightMs: number;
  runningSide: BreastSide | null;
  /** 最後に計測した側。まだ一度も測っていなければ null。 */
  lastSide: BreastSide | null;
  /** 計測中、または止めたあと記録前の時間が残っている。 */
  hasSession: boolean;
  /**
   * 押した側の計測を始める。計測中の側をもう一度押すと停止、
   * 反対側を押すと切り替え（左右を同時には測らない）。
   * 停止済みの累積時間を返すので、そのまま分数の入力欄へ反映できる。
   */
  toggleSide: (side: BreastSide) => { leftMs: number; rightMs: number };
  reset: () => void;
}

export function useNursingTimer(): NursingTimer {
  const active = useSyncExternalStore(subscribe, getSnapshot);
  const now = useSyncExternalStore(
    active.runningSide ? subscribeClock : subscribeNothing,
    getClockSnapshot,
  );

  const runningMs = active.runningSide && active.startedAt ? Math.max(0, now - active.startedAt) : 0;
  const leftMs = active.leftMs + (active.runningSide === 'left' ? runningMs : 0);
  const rightMs = active.rightMs + (active.runningSide === 'right' ? runningMs : 0);

  const toggleSide = useCallback((side: BreastSide) => {
    const at = Date.now();
    clockNow = at;
    const prev = getSnapshot();
    const elapsed = prev.runningSide && prev.startedAt ? Math.max(0, at - prev.startedAt) : 0;
    const settled = {
      leftMs: prev.leftMs + (prev.runningSide === 'left' ? elapsed : 0),
      rightMs: prev.rightMs + (prev.runningSide === 'right' ? elapsed : 0),
    };
    const stopping = prev.runningSide === side;
    store({
      ...prev,
      ...settled,
      runningSide: stopping ? null : side,
      startedAt: stopping ? null : at,
      lastSide: side,
    });
    return settled;
  }, []);

  const reset = useCallback(() => store(EMPTY), []);

  return {
    leftMs,
    rightMs,
    runningSide: active.runningSide,
    lastSide: active.lastSide,
    hasSession: active.runningSide !== null || leftMs > 0 || rightMs > 0,
    toggleSide,
    reset,
  };
}

/** 計測した時間を記録用の分数に。1分に満たない計測も0分にはしない。 */
export const nursingMinutes = (ms: number): number =>
  ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60000));
