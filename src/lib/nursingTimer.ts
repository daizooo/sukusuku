'use client';

// 授乳を左右別に測るストップウォッチ。左か右のボタンをタップして測り、もう一度押すと止まり、
// 反対側を押すと切り替わる（同時には測らない）。
// 授乳中は入力画面を閉じたり他のタブへ移ったりするため、計測中の値は端末内に
// 控えておき、戻ってきたときに続きから測れるようにする。
// （記録として保存する前の値なので、DBには持たせない）
//
// 測っている間は5分たつごとにお知らせ（音・バイブ）が鳴る。5分=1回、10分=2回…と、
// 経過時間が回数で分かるので、画面を見ていなくても何分たったか分かる。
// 止め忘れて数えっぱなしにならないよう、1つの側が60分に達したところで計測を止める。
//
// 以前は「左5分 → 右5分 → ゲップ5分」の1セットとして測っていたが、セットの仕組み
// （ゲップ・セット数・測る前に済ませたセット）はやめた。端末に控えてある旧形式の計測は
// 読み込むときに左右の合計へ畳む。

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

/** 測る側。並べる順番は画面側で決める。 */
export const NURSING_SIDES: BreastSide[] = ['left', 'right'];

/** お知らせを鳴らす間隔（分）。 */
export const NURSING_ALARM_MINUTES = 5;

/** お知らせの間隔(ミリ秒)。 */
const NURSING_ALARM_MS = NURSING_ALARM_MINUTES * 60_000;

/** 1つの側を測れる上限(ミリ秒)。ここに達したら計測を止める。 */
export const NURSING_MAX_MS = 60 * 60_000;

/** 左右ごとの時間(ミリ秒)や「何回目まで鳴らしたか」を持つ入れ物。 */
export type NursingSideValues = Record<BreastSide, number>;

const ZERO: NursingSideValues = { left: 0, right: 0 };

/** 1つの側だけを差し替えた入れ物を作る。 */
const withSide = (
  values: NursingSideValues,
  side: BreastSide,
  value: number,
): NursingSideValues => ({
  left: side === 'left' ? value : values.left,
  right: side === 'right' ? value : values.right,
});

interface ActiveNursing {
  /** 左右それぞれの、停止済みの時間(ミリ秒)。 */
  elapsed: NursingSideValues;
  /** 計測中の側と、その計測を始めた時刻。停止中は null。 */
  runningSide: BreastSide | null;
  startedAt: number | null;
  /**
   * この授乳を測り始めた時刻（1回目にボタンを押した時刻）。記録・リセットまで変えない。
   *
   * 記録の日時は「飲ませ始めた時刻」であってほしい（次の授乳の目安の起点になるため）。
   * 保存するのは飲ませ終えたあとなので、保存した時刻を入れると実際より後ろにずれる。
   */
  sessionStartedAt: number | null;
  /**
   * 計測を止めた時刻。まだ記録していない計測が残っている間だけ入る。
   * 計測中と、記録・リセットしたあとは null。
   */
  stoppedAt: number | null;
  /** 最後に計測した側。記録の「最後に飲ませた側」に使う。 */
  lastSide: BreastSide | null;
  /**
   * 側ごとに「何回目の5分まで鳴らし終えたか」。
   * 画面を開き直したり左右を行き来したりしても鳴り直さないよう控えておく。
   */
  notified: NursingSideValues;
}

const EMPTY: ActiveNursing = {
  elapsed: ZERO,
  runningSide: null,
  startedAt: null,
  sessionStartedAt: null,
  stoppedAt: null,
  lastSide: null,
  notified: ZERO,
};

const toMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const toSide = (value: unknown): BreastSide | null =>
  value === 'left' || value === 'right' ? value : null;

/** セット制だった頃の控え。左右の値と、測る前に済ませたセット(1セット=左右5分)を畳んで読む。 */
interface StoredNursing {
  elapsed?: Partial<Record<string, unknown>>;
  carried?: Partial<Record<string, unknown>>;
  untrackedSets?: unknown;
  leftMs?: unknown;
  rightMs?: unknown;
  runningSide?: unknown;
  runningPhase?: unknown;
  startedAt?: unknown;
  sessionStartedAt?: unknown;
  stoppedAt?: unknown;
  lastSide?: unknown;
}

const foldSide = (parsed: StoredNursing, side: BreastSide, legacy: unknown): number => {
  const untracked = Math.floor(toMs(parsed.untrackedSets));
  const total =
    toMs(parsed.elapsed?.[side] ?? legacy) + toMs(parsed.carried?.[side]) + untracked * NURSING_ALARM_MS;
  return Math.min(total, NURSING_MAX_MS);
};

const load = (): ActiveNursing => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as StoredNursing;
    const startedAt = toMs(parsed.startedAt) || null;
    // 開始時刻が失われていると経過時間を復元できないので、計測中とは扱わない。
    // 旧形式でゲップを測っていた場合も、続きは無いので停止扱いにする。
    const runningSide = startedAt ? toSide(parsed.runningPhase ?? parsed.runningSide) : null;
    const elapsed = { left: foldSide(parsed, 'left', parsed.leftMs), right: foldSide(parsed, 'right', parsed.rightMs) };
    return {
      elapsed,
      runningSide,
      startedAt: runningSide ? startedAt : null,
      // 持たせる前に控えた分には入っていない。そのときは無いものとして扱う。
      sessionStartedAt: toMs(parsed.sessionStartedAt) || null,
      stoppedAt: toMs(parsed.stoppedAt) || null,
      lastSide: toSide(parsed.lastSide),
      // すでに過ぎた5分は鳴らし済みとして始める（更新の直後に鳴り直さない）。
      notified: {
        left: Math.floor(elapsed.left / NURSING_ALARM_MS),
        right: Math.floor(elapsed.right / NURSING_ALARM_MS),
      },
    };
  } catch (err) {
    console.error('Failed to read active nursing:', err);
    return EMPTY;
  }
};

/** どちらかの側に時間が入っているか。 */
const hasElapsed = (values: NursingSideValues): boolean =>
  NURSING_SIDES.some((side) => values[side] > 0);

/** 記録前の内容が残っているか（計測中・測った時間のいずれか）。 */
const hasSession = (active: ActiveNursing): boolean =>
  active.runningSide !== null || hasElapsed(active.elapsed);

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

const store = (next: ActiveNursing, notifySink = true) => {
  cached = next;
  try {
    if (!hasSession(next)) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch (err) {
    console.error('Failed to save active nursing:', err);
  }
  emit();
  syncAlarmWatcher();
  // サーバー側のお知らせに反映する。Service Worker から知らされた分は
  // サーバーが既に把握しているので、書き戻さない。
  if (notifySink) sink?.(alarmTarget(next));
};

/** その側の合計時間(ミリ秒)。計測中ならその分も含む（上限は超えない）。 */
const sideElapsed = (active: ActiveNursing, side: BreastSide, at: number): number =>
  Math.min(
    NURSING_MAX_MS,
    active.elapsed[side] +
      (active.runningSide === side && active.startedAt ? Math.max(0, at - active.startedAt) : 0),
  );

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
// 授乳中は手が離せないため、5分たつごとに音とバイブで知らせる。
// 鳴る回数は経過時間で変わる（5分=1回、10分=2回…。規則は alarm.ts の buildAlarmPattern）。
//
// 鳴らす時刻は間隔の長さそのもの(NURSING_ALARM_MINUTES)で決まるため、
// 端末に控えるのは音とバイブを鳴らすかどうかだけにしている。

interface NursingAlarmSettings {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

const DEFAULT_ALARM: NursingAlarmSettings = {
  soundEnabled: true,
  vibrationEnabled: true,
};

const loadAlarm = (): NursingAlarmSettings => {
  try {
    const raw = window.localStorage.getItem(ALARM_STORAGE_KEY);
    if (!raw) return DEFAULT_ALARM;
    const parsed = JSON.parse(raw) as Partial<NursingAlarmSettings>;
    return {
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

// --- サーバー側のお知らせとの連携 ---
// ブラウザは画面が消える・裏に回るとタイマーを間引くため、端末内の見張りだけでは
// お知らせが遅れる/鳴らない。そこで「いつ・何分ごとに鳴らすか」をサーバーにも預け、
// 端末が鳴らせなかった分を Web Push で鳴らしてもらう。
// 預ける処理そのものは Supabase を触るため、ここでは受け口だけ持つ。

/**
 * 計測を止めてから記録するまでを「授乳中」として預けておく上限。
 * サーバー側の打ち切り(send-nursing-alarms の MAX_PENDING_MINUTES)と合わせている。
 */
const PENDING_MAX_MS = 60 * 60_000;

export interface NursingAlarmTarget {
  /** 計測中の側（nursing_alarms.side に入る）。 */
  side: BreastSide;
  /** 計測中の側の合計時間が0だった時刻。経過分数 = now - baselineAt。 */
  baselineAt: number;
  /** 何分ごとにお知らせを鳴らすか。 */
  intervalMinutes: number;
  /** 何回目のお知らせまで鳴らし終えたか。 */
  notifiedStep: number;
  /**
   * 計測を止めた時刻。まだ記録していない間だけ入る（計測中は null）。
   * この間は経過時間のお知らせは鳴らさないが、「授乳は済んだが記録はまだ」と
   * 家族に分かるよう預けたままにする（「そろそろ次の授乳」を止めるため）。
   */
  stoppedAt: number | null;
}

/**
 * サーバーへ預ける内容。計測中も、止めたあと記録するまでの間も預ける。
 * 記録・リセットして計測が残っていなければ null（＝サーバー側の予約も消す）。
 */
const alarmTarget = (active: ActiveNursing): NursingAlarmTarget | null => {
  const running = active.runningSide;
  if (running && active.startedAt) {
    return {
      side: running,
      // 左右を行き来してもその側の経過時間で数えるので、
      // 累積ぶんさかのぼった時刻を基準にする。
      baselineAt: active.startedAt - active.elapsed[running],
      intervalMinutes: NURSING_ALARM_MINUTES,
      notifiedStep: active.notified[running],
      stoppedAt: null,
    };
  }

  // 計測は止まっているが、まだ記録していない。授乳は済んでいるので、
  // この間に「そろそろ次の授乳」が飛ばないよう、預けたままにしておく。
  const side = active.lastSide;
  if (!side || !active.stoppedAt) return null;
  if (!hasElapsed(active.elapsed)) return null;
  // 記録されないまま置き去りになった分は預けない（サーバー側の打ち切りと同じ長さ）。
  if (Date.now() - active.stoppedAt > PENDING_MAX_MS) return null;
  return {
    side,
    baselineAt: active.stoppedAt - active.elapsed[side],
    intervalMinutes: NURSING_ALARM_MINUTES,
    notifiedStep: active.notified[side],
    stoppedAt: active.stoppedAt,
  };
};

type NursingAlarmSink = (target: NursingAlarmTarget | null) => void;

let sink: NursingAlarmSink | null = null;

/** サーバーへ預ける処理を差し込む。渡した時点の状態も一度流す。 */
export const setNursingAlarmSink = (next: NursingAlarmSink | null): void => {
  sink = next;
  next?.(alarmTarget(getSnapshot()));
};

/**
 * Service Worker が代わりに鳴らした分を、端末側の「何回目まで鳴らしたか」に反映する。
 * これをしないと、裏に回っている間に鳴った分をアプリに戻ってきたときに鳴らし直してしまう。
 */
export const markNursingAlarmNotified = (side: BreastSide, step: number): void => {
  if (!Number.isFinite(step)) return;
  const active = getSnapshot();
  // 通知が届くまでに左右を切り替えていたら、その数えは今の側のものではない
  if (active.runningSide !== side) return;
  if (step <= active.notified[side]) return;
  // サーバーは自分が送った分を既に把握しているので、書き戻さない。
  store({ ...active, notified: withSide(active.notified, side, step) }, false);
};

const fireAlarm = (pattern: AlarmPattern, settings: NursingAlarmSettings) => {
  // 振動を先に出す。ユーザー操作起点で呼ばれたとき、音の準備を待つ間に
  // 「操作の直後」という扱いから外れて端末に無視されるのを避けるため。
  if (settings.vibrationEnabled) vibrateAlarmPattern(pattern);
  if (settings.soundEnabled) playAlarmPattern(pattern);
};

/**
 * 計測中の側が5分たつごとに鳴らす。経過時間そのものを回数で伝える（5分=1回、10分=2回…）。
 *
 * 1つの側が上限(60分)に達したら、そのまま計測も止める。授乳が終わったあと
 * 止め忘れて数えっぱなしになると、記録の時間も画面の点けっぱなしも無駄になるため。
 */
const checkAlarm = () => {
  const active = getSnapshot();
  const side = active.runningSide;
  if (!side || !active.startedAt) return;
  const at = Date.now();
  const elapsed = sideElapsed(active, side, at);
  const step = Math.floor(elapsed / NURSING_ALARM_MS);

  // 裏に回っている間にサーバーが鳴らしてくれた分は、鳴らし直さない。
  const alreadyNotified = step <= active.notified[side];
  if (!alreadyNotified) {
    fireAlarm(buildAlarmPattern(step * NURSING_ALARM_MINUTES), getAlarmSnapshot());
  }
  const notified = alreadyNotified ? active.notified : withSide(active.notified, side, step);

  if (elapsed < NURSING_MAX_MS) {
    if (!alreadyNotified) store({ ...active, notified });
    return;
  }
  // 上限まで測り終えたら計測を止める。止めた時刻は「授乳は済んだが記録はまだ」の印になる。
  store({
    ...active,
    elapsed: withSide(active.elapsed, side, NURSING_MAX_MS),
    notified,
    runningSide: null,
    startedAt: null,
    stoppedAt: at,
  });
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

/**
 * 記録前の授乳が残っているか（計測中・計測後の記録待ちを含む）。
 * 授乳のお知らせを消してよいかの判断に使う（notificationCleanup.ts）。
 */
export function useHasNursingSession(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasSession(getSnapshot()),
    () => false,
  );
}

export interface NursingTimer {
  /** 左右それぞれの時間(ミリ秒)。計測中の分を含む。 */
  elapsed: NursingSideValues;
  runningSide: BreastSide | null;
  /**
   * この授乳を測り始めた時刻(epoch ms)。測っていなければ null。
   * 記録の日時の初期値に使う（保存した時刻ではなく、飲ませ始めた時刻を入れるため）。
   */
  sessionStartedAt: number | null;
  /** 最後に計測した側。まだ一度も測っていなければ null。 */
  lastSide: BreastSide | null;
  /** 計測中、または止めたあと記録前の内容が残っている。 */
  hasSession: boolean;
  /**
   * 押した側の計測を始める。計測中の側をもう一度押すと停止、
   * 反対側を押すと切り替え（同時には測らない）。
   * 記録に入る合計を返すので、そのまま分数の入力欄へ反映できる。
   */
  toggleSide: (side: BreastSide) => NursingSideValues;
  reset: () => void;
}

export function useNursingTimer(): NursingTimer {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = useSyncExternalStore(
    active.runningSide ? subscribeClock : subscribeNothing,
    getClockSnapshot,
    getClockServerSnapshot,
  );

  const elapsed: NursingSideValues = {
    left: sideElapsed(active, 'left', now),
    right: sideElapsed(active, 'right', now),
  };

  const toggleSide = useCallback((side: BreastSide) => {
    // iOS/Chromeは「タップの処理の中」でしか音の再生を許可しないため、ここで解除しておく。
    void unlockAudio();
    stopVibration();
    const at = Date.now();
    clockNow = at;
    const prev = getSnapshot();
    const running = prev.runningSide;
    const settled: NursingSideValues =
      running && prev.startedAt
        ? withSide(prev.elapsed, running, sideElapsed(prev, running, at))
        : prev.elapsed;
    const stopping = running === side;
    // 上限まで測り終えた側は、もう測れない（押しても何も起きない）。
    if (!stopping && settled[side] >= NURSING_MAX_MS) return settled;
    const next: ActiveNursing = {
      ...prev,
      elapsed: settled,
      runningSide: stopping ? null : side,
      startedAt: stopping ? null : at,
      // 1回目に押した時刻。続きを測ったり止めたりしても動かさない。
      sessionStartedAt: prev.sessionStartedAt ?? at,
      // 止めた時刻は「授乳は済んだが記録はまだ」の印になる。測り直したら消す。
      stoppedAt: stopping ? at : null,
      lastSide: side,
    };
    store(next);
    return next.elapsed;
  }, []);

  const reset = useCallback(() => {
    stopVibration();
    store(EMPTY);
  }, []);

  return {
    elapsed,
    runningSide: active.runningSide,
    sessionStartedAt: active.sessionStartedAt,
    lastSide: active.lastSide,
    hasSession: hasSession(active) || hasElapsed(elapsed),
    toggleSide,
    reset,
  };
}

/** 計測した時間を記録用の分数に。1分に満たない計測も0分にはしない。 */
export const nursingMinutes = (ms: number): number =>
  ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60000));
