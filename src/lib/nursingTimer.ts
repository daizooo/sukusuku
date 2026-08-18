'use client';

// 母乳の授乳時間を左右それぞれ計測するストップウォッチ。
// 授乳中は入力画面を閉じたり他のタブへ移ったりするため、計測中の値は端末内に
// 控えておき、戻ってきたときに続きから測れるようにする。
// （ねんね計測と違い記録として保存する前の値なので、DBには持たせない）

import { useCallback, useSyncExternalStore } from 'react';
import type { BreastSide } from '@/types/app';

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

const load = (): ActiveNursing => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
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
  } catch (err) {
    console.error('Failed to read active nursing:', err);
    return EMPTY;
  }
};

// --- 計測中の値を持つ外部ストア ---
// サーバー側の描画では常に空、画面に出たあとに端末の控えを読む形にして、
// 初回描画の食い違いを避ける。

let cached: ActiveNursing | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const getSnapshot = (): ActiveNursing => {
  if (!cached) cached = load();
  return cached;
};

const getServerSnapshot = (): ActiveNursing => EMPTY;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  // 別のタブで操作された場合も追従する。
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cached = load();
    emit();
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
};

const store = (next: ActiveNursing) => {
  cached = next;
  try {
    if (next.runningSide === null && next.leftMs === 0 && next.rightMs === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch (err) {
    console.error('Failed to save active nursing:', err);
  }
  emit();
};

// --- 経過時間の表示を進めるための時計 ---
// 描画のたびに現在時刻を読まずに済むよう、時計も外部ストアとして扱う。

let clockNow = 0;
let clockTimerId: number | null = null;
const clockListeners = new Set<() => void>();

const getClockSnapshot = (): number => clockNow;

const getClockServerSnapshot = (): number => 0;

const subscribeClock = (listener: () => void): (() => void) => {
  clockListeners.add(listener);
  clockNow = Date.now();
  if (clockTimerId === null) {
    clockTimerId = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((clockListener) => clockListener());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimerId !== null) {
      window.clearInterval(clockTimerId);
      clockTimerId = null;
    }
  };
};

/** 計測していない間は時計を動かす必要がないので、購読しない。 */
const subscribeNothing = (): (() => void) => () => {};

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
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = useSyncExternalStore(
    active.runningSide ? subscribeClock : subscribeNothing,
    getClockSnapshot,
    getClockServerSnapshot,
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
