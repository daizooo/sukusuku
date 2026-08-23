'use client';

// 母乳の授乳時間を左右それぞれ計測するストップウォッチ。
// 授乳中は入力画面を閉じたり他のタブへ移ったりするため、計測中の値は端末内に
// 控えておき、戻ってきたときに続きから測れるようにする。
// （記録として保存する前の値なので、DBには持たせない）

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { BreastSide } from '@/types/app';
import {
  buildAlarmPattern,
  flushPendingVibration,
  playAlarmPattern,
  requestScreenWakeLock,
  stopVibration,
  unlockAudio,
  vibrateAlarmPattern,
  type AlarmPattern,
  type WakeLockSentinelLike,
} from '@/lib/alarm';

const STORAGE_KEY = 'sukusuku:activeNursing';
const ALARM_STORAGE_KEY = 'sukusuku:nursingAlarm';

interface ActiveNursing {
  /** 停止済みの累積時間(ミリ秒)。 */
  leftMs: number;
  rightMs: number;
  /** 計測中の側と、その計測を始めた時刻。停止中は null。 */
  runningSide: BreastSide | null;
  startedAt: number | null;
  /** 最後に計測した側。記録の「最後に飲ませた側」に使う。 */
  lastSide: BreastSide | null;
  /**
   * 側ごとに「何回目のお知らせまで鳴らしたか」。
   * 画面を開き直したり左右を行き来したりしても鳴り直さないよう控えておく。
   */
  notifiedLeft: number;
  notifiedRight: number;
}

const EMPTY: ActiveNursing = {
  leftMs: 0,
  rightMs: 0,
  runningSide: null,
  startedAt: null,
  lastSide: null,
  notifiedLeft: 0,
  notifiedRight: 0,
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
      notifiedLeft: toMs(parsed.notifiedLeft),
      notifiedRight: toMs(parsed.notifiedRight),
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
  syncAlarmWatcher();
};

/** その側の合計時間(ミリ秒)。計測中ならその分も含む。 */
const sideElapsed = (active: ActiveNursing, side: BreastSide, at: number): number =>
  (side === 'left' ? active.leftMs : active.rightMs) +
  (active.runningSide === side && active.startedAt ? Math.max(0, at - active.startedAt) : 0);

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

// --- お知らせ（音・バイブ）の設定 ---
// 授乳中は手が離せないため、一定間隔で音とバイブを鳴らし、
// 「鳴り方」だけで経過時間が分かるようにする。
// （短い「ピッ」1回＝5分、長い「ポーン」1回＝30分。設定はいつ鳴らすかだけを決める）
//
// 設定を変える画面は記録画面から外したため、いまは端末に控えてある値
// （なければ既定値）をそのまま使う。鳴らす仕組み自体はこれまでどおり動く。

// 短音=5分・長音=30分で言い表せる間隔だけを選べるようにしている。
const ALARM_INTERVAL_OPTIONS = [5, 10, 15] as const;
type AlarmIntervalMinutes = (typeof ALARM_INTERVAL_OPTIONS)[number];

interface NursingAlarmSettings {
  intervalMinutes: AlarmIntervalMinutes;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

const DEFAULT_ALARM: NursingAlarmSettings = {
  intervalMinutes: 5,
  soundEnabled: true,
  vibrationEnabled: true,
};

const toInterval = (value: unknown): AlarmIntervalMinutes =>
  ALARM_INTERVAL_OPTIONS.includes(value as AlarmIntervalMinutes)
    ? (value as AlarmIntervalMinutes)
    : DEFAULT_ALARM.intervalMinutes;

const loadAlarm = (): NursingAlarmSettings => {
  try {
    const raw = window.localStorage.getItem(ALARM_STORAGE_KEY);
    if (!raw) return DEFAULT_ALARM;
    const parsed = JSON.parse(raw) as Partial<NursingAlarmSettings>;
    return {
      intervalMinutes: toInterval(parsed.intervalMinutes),
      soundEnabled: parsed.soundEnabled ?? DEFAULT_ALARM.soundEnabled,
      vibrationEnabled: parsed.vibrationEnabled ?? DEFAULT_ALARM.vibrationEnabled,
    };
  } catch (err) {
    console.error('Failed to read nursing alarm settings:', err);
    return DEFAULT_ALARM;
  }
};

let alarmCached: NursingAlarmSettings | null = null;

const getAlarmSnapshot = (): NursingAlarmSettings => {
  if (!alarmCached) alarmCached = loadAlarm();
  return alarmCached;
};

const fireAlarm = (pattern: AlarmPattern, settings: NursingAlarmSettings) => {
  // 振動を先に出す。ユーザー操作起点で呼ばれたとき、音の準備を待つ間に
  // 「操作の直後」という扱いから外れて端末に無視されるのを避けるため。
  if (settings.vibrationEnabled) vibrateAlarmPattern(pattern);
  if (settings.soundEnabled) playAlarmPattern(pattern);
};

/** 計測中の側が次の区切りに達していたら鳴らす。 */
const checkAlarm = () => {
  const active = getSnapshot();
  const side = active.runningSide;
  if (!side || !active.startedAt) return;
  const settings = getAlarmSnapshot();
  const step = Math.floor(sideElapsed(active, side, Date.now()) / (settings.intervalMinutes * 60000));
  const notified = side === 'left' ? active.notifiedLeft : active.notifiedRight;
  if (step < 1 || step <= notified) return;

  fireAlarm(buildAlarmPattern(step * settings.intervalMinutes), settings);
  store(side === 'left' ? { ...active, notifiedLeft: step } : { ...active, notifiedRight: step });
};

// --- 計測中の見張り ---
// 記録タブを開いていなくても鳴らせるよう、Reactの外で動かす。
// あわせて画面を消灯させない（消灯するとブラウザがタイマーを間引き、お知らせが遅れる）。

let watcherId: number | null = null;
let wakeLock: WakeLockSentinelLike | null = null;

const releaseWakeLock = () => {
  const held = wakeLock;
  wakeLock = null;
  void held?.release();
};

const acquireWakeLock = async () => {
  if (wakeLock && !wakeLock.released) return;
  const sentinel = await requestScreenWakeLock();
  // 取得を待つ間に計測が終わっていたら、すぐ返す
  if (getSnapshot().runningSide === null) {
    void sentinel?.release();
    return;
  }
  wakeLock = sentinel;
};

const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return;
  // 裏に回っている間はタイマーが間引かれるので、戻った時点で鳴らし損ねた分を確認する。
  // 画面ロックもタブを離れると自動解放されるため取り直す。
  // 画面が消えている間の振動は端末に無視されるので、戻ってきたここで鳴らし直す。
  // 先に鳴らし直しておけば、直後のcheckAlarmでさらに新しいお知らせが出たときは
  // そちら（より新しい経過時間）で上書きされる。
  flushPendingVibration();
  checkAlarm();
  void acquireWakeLock();
};

const syncAlarmWatcher = () => {
  if (typeof window === 'undefined') return;
  const running = getSnapshot().runningSide !== null;
  if (running && watcherId === null) {
    watcherId = window.setInterval(checkAlarm, 1000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void acquireWakeLock();
  } else if (!running && watcherId !== null) {
    window.clearInterval(watcherId);
    watcherId = null;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    releaseWakeLock();
  }
};

/**
 * アプリのどの画面を開いていてもお知らせが鳴るよう、見張りをアプリ全体で1つ動かす。
 * 読み込み直後に計測が残っていた場合もここから再開する。
 */
export function useNursingAlarmWatcher(): void {
  useEffect(() => {
    syncAlarmWatcher();
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
    // iOS/Chromeは「タップの処理の中」でしか音の再生を許可しないため、ここで解除しておく。
    void unlockAudio();
    stopVibration();
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

  const reset = useCallback(() => {
    stopVibration();
    store(EMPTY);
  }, []);

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
