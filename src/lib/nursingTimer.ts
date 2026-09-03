'use client';

// 授乳を「左5分 → 右5分 → ゲップ5分」の1セットとして計測するストップウォッチ。
// 授乳中は入力画面を閉じたり他のタブへ移ったりするため、計測中の値は端末内に
// 控えておき、戻ってきたときに続きから測れるようにする。
// （記録として保存する前の値なので、DBには持たせない）
//
// 区切りが5分に達するとお知らせ（音・バイブ）が1回鳴るので、画面を見ていなくても
// 次の区切りへ移るタイミングが分かる。ゲップの5分まで終われば1セット完了として
// 計測も止まる。ゲップは飲ませた時間ではないため、計測とお知らせにだけ使い、
// 記録には残さない（記録に入るのはこれまでどおり左右の分数だけ）。

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { BreastSide, NursingPhase } from '@/types/app';
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

/** 1セットに含まれる区切り。並べる順番は画面側で決める（前回の続きから始めるため）。 */
export const NURSING_PHASES: NursingPhase[] = ['left', 'right', 'burp'];

/** 1区切りの長さ（分）。ここに達するとお知らせが鳴る。 */
export const NURSING_PHASE_MINUTES = 5;

/** 1区切りの長さ(ミリ秒)。 */
export const NURSING_PHASE_MS = NURSING_PHASE_MINUTES * 60_000;

/** 区切りごとの時間(ミリ秒)や「何回目まで鳴らしたか」を持つ入れ物。 */
export type NursingPhaseValues = Record<NursingPhase, number>;

const ZERO: NursingPhaseValues = { left: 0, right: 0, burp: 0 };

/** 1つの区切りだけを差し替えた入れ物を作る。 */
const withPhase = (
  values: NursingPhaseValues,
  phase: NursingPhase,
  value: number,
): NursingPhaseValues => ({
  left: phase === 'left' ? value : values.left,
  right: phase === 'right' ? value : values.right,
  burp: phase === 'burp' ? value : values.burp,
});

/** 測っていないセット1つを、記録では左右それぞれ何分とみなすか。 */
const UNTRACKED_SET_MS = NURSING_PHASE_MS;

/** 測っていないセットとして数えられる上限。押し間違いで極端な値にならないようにする。 */
const MAX_UNTRACKED_SETS = 20;

interface ActiveNursing {
  /** いま測っているセットの、区切りごとの停止済み時間(ミリ秒)。 */
  elapsed: NursingPhaseValues;
  /** 前のセットまでに測った時間の合計(ミリ秒)。 */
  carried: NursingPhaseValues;
  /** 測り終えたセットの数。 */
  measuredSets: number;
  /**
   * 測る前に済ませてしまったセットの数。
   * 急いで飲ませ始めて途中から記録するときに、その分を記録へ足すためのもの
   * （1セット＝左右それぞれ5分の目安として扱う）。
   */
  untrackedSets: number;
  /** 計測中の区切りと、その計測を始めた時刻。停止中は null。 */
  runningPhase: NursingPhase | null;
  startedAt: number | null;
  /**
   * 計測を止めた時刻。まだ記録していない計測が残っている間だけ入る。
   * 計測中と、記録・リセットしたあとは null。
   */
  stoppedAt: number | null;
  /** 最後に計測した側。記録の「最後に飲ませた側」に使う（ゲップでは変わらない）。 */
  lastSide: BreastSide | null;
  /**
   * いま測っているセットで「区切りごとに鳴らし終えたか」。
   * 画面を開き直したり区切りを行き来したりしても鳴り直さないよう控えておく。
   * セットが変わるとまた鳴るよう、次のセットへ移るときに0へ戻す。
   */
  notified: NursingPhaseValues;
}

const EMPTY: ActiveNursing = {
  elapsed: ZERO,
  carried: ZERO,
  measuredSets: 0,
  untrackedSets: 0,
  runningPhase: null,
  startedAt: null,
  stoppedAt: null,
  lastSide: null,
  notified: ZERO,
};

/** 記録に入る合計。前のセット・いまのセット・測っていないセットぶんを足す。 */
const totalValues = (
  active: ActiveNursing,
  elapsed: NursingPhaseValues,
): NursingPhaseValues => ({
  left: active.carried.left + elapsed.left + active.untrackedSets * UNTRACKED_SET_MS,
  right: active.carried.right + elapsed.right + active.untrackedSets * UNTRACKED_SET_MS,
  // ゲップは記録に残さないので、測っていないセットぶんは足さない。
  burp: active.carried.burp + elapsed.burp,
});

/** いまのセットを締めて次のセットへ。測った分は合計へ送り、お知らせも鳴り直せるようにする。 */
const rollOverSet = (active: ActiveNursing, settled: NursingPhaseValues): ActiveNursing => ({
  ...active,
  carried: {
    left: active.carried.left + settled.left,
    right: active.carried.right + settled.right,
    burp: active.carried.burp + settled.burp,
  },
  elapsed: ZERO,
  notified: ZERO,
  measuredSets: active.measuredSets + 1,
});

const toMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const toSide = (value: unknown): BreastSide | null =>
  value === 'left' || value === 'right' ? value : null;

const toPhase = (value: unknown): NursingPhase | null =>
  NURSING_PHASES.includes(value as NursingPhase) ? (value as NursingPhase) : null;

const toCount = (value: unknown, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(max, Math.floor(value))
    : 0;

/** 控えから読み出す。ゲップを含む形にする前の控え(legacy)からも拾えるようにする。 */
const toPhaseValues = (
  value: unknown,
  legacy: { left: unknown; right: unknown },
): NursingPhaseValues => {
  const record = (value ?? {}) as Partial<Record<NursingPhase, unknown>>;
  return {
    left: toMs(record.left ?? legacy.left),
    right: toMs(record.right ?? legacy.right),
    burp: toMs(record.burp),
  };
};

/** ゲップを含む形にする前の控え。計測の途中で更新されても続きから測れるようにする。 */
interface StoredNursing extends Partial<ActiveNursing> {
  leftMs?: unknown;
  rightMs?: unknown;
  notifiedLeft?: unknown;
  notifiedRight?: unknown;
  runningSide?: unknown;
}

const load = (): ActiveNursing => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as StoredNursing;
    const startedAt = toMs(parsed.startedAt) || null;
    return {
      elapsed: toPhaseValues(parsed.elapsed, { left: parsed.leftMs, right: parsed.rightMs }),
      carried: toPhaseValues(parsed.carried, { left: 0, right: 0 }),
      measuredSets: toCount(parsed.measuredSets, Number.MAX_SAFE_INTEGER),
      untrackedSets: toCount(parsed.untrackedSets, MAX_UNTRACKED_SETS),
      // 開始時刻が失われていると経過時間を復元できないので、計測中とは扱わない。
      runningPhase: startedAt ? toPhase(parsed.runningPhase ?? parsed.runningSide) : null,
      startedAt,
      stoppedAt: toMs(parsed.stoppedAt) || null,
      lastSide: toSide(parsed.lastSide),
      notified: toPhaseValues(parsed.notified, {
        left: parsed.notifiedLeft,
        right: parsed.notifiedRight,
      }),
    };
  } catch (err) {
    console.error('Failed to read active nursing:', err);
    return EMPTY;
  }
};

/** どこかの区切りに時間が入っているか。 */
const hasElapsed = (values: NursingPhaseValues): boolean =>
  NURSING_PHASES.some((phase) => values[phase] > 0);

/** 記録前の内容が残っているか（計測中・測った時間・測っていないセットのいずれか）。 */
const hasSession = (active: ActiveNursing): boolean =>
  active.runningPhase !== null ||
  hasElapsed(active.elapsed) ||
  hasElapsed(active.carried) ||
  active.untrackedSets > 0;

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

/** その区切りの合計時間(ミリ秒)。計測中ならその分も含む。 */
const phaseElapsed = (active: ActiveNursing, phase: NursingPhase, at: number): number =>
  active.elapsed[phase] +
  (active.runningPhase === phase && active.startedAt ? Math.max(0, at - active.startedAt) : 0);

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
// 授乳中は手が離せないため、区切りが5分に達したら音とバイブで知らせる。
// 鳴るのは区切りごとに1回だけ。「次へ移る合図」がほしいだけなので、
// 鳴らし続けると赤ちゃんも親も休めない。
//
// 鳴らす時刻は区切りの長さそのもの(NURSING_PHASE_MINUTES)で決まるため、
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
  /** 計測中の区切り。ゲップも含む（nursing_alarms.side に入る）。 */
  side: NursingPhase;
  /** 計測中の区切りの合計時間が0だった時刻。経過分数 = now - baselineAt。 */
  baselineAt: number;
  /** 何分でお知らせを鳴らすか。区切りの長さそのもの。 */
  intervalMinutes: number;
  /** お知らせを鳴らし終えていれば1。区切りごとに1回しか鳴らさない。 */
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
  const running = active.runningPhase;
  if (running && active.startedAt) {
    return {
      side: running,
      // 区切りを行き来してもその区切りの経過時間で数えるので、
      // 累積ぶんさかのぼった時刻を基準にする。
      baselineAt: active.startedAt - active.elapsed[running],
      intervalMinutes: NURSING_PHASE_MINUTES,
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
    intervalMinutes: NURSING_PHASE_MINUTES,
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
export const markNursingAlarmNotified = (phase: NursingPhase, step: number): void => {
  if (!Number.isFinite(step)) return;
  const active = getSnapshot();
  // 通知が届くまでに区切りを切り替えていたら、その数えは今の区切りのものではない
  if (active.runningPhase !== phase) return;
  if (step <= active.notified[phase]) return;
  // サーバーは自分が送った分を既に把握しているので、書き戻さない。
  store({ ...active, notified: withPhase(active.notified, phase, step) }, false);
};

const fireAlarm = (pattern: AlarmPattern, settings: NursingAlarmSettings) => {
  // 振動を先に出す。ユーザー操作起点で呼ばれたとき、音の準備を待つ間に
  // 「操作の直後」という扱いから外れて端末に無視されるのを避けるため。
  if (settings.vibrationEnabled) vibrateAlarmPattern(pattern);
  if (settings.soundEnabled) playAlarmPattern(pattern);
};

/**
 * 計測中の区切りが5分に達していたら鳴らす。鳴らすのは区切りごとに1回だけ。
 *
 * 1セットの最後（ゲップ）まで終わったら、そのまま計測も止める。授乳が終わったあと
 * 止め忘れて数えっぱなしになると、記録の時間も画面の点けっぱなしも無駄になるため。
 */
const checkAlarm = () => {
  const active = getSnapshot();
  const phase = active.runningPhase;
  if (!phase || !active.startedAt) return;
  const at = Date.now();
  const elapsed = phaseElapsed(active, phase, at);
  if (elapsed < NURSING_PHASE_MS) return;

  // 裏に回っている間にサーバーが鳴らしてくれた分は、鳴らし直さない。
  // ただしゲップの締めはここでしか行えないので、鳴らし済みでも下へ進む。
  const notifiedAlready = active.notified[phase] >= 1;
  if (notifiedAlready && phase !== 'burp') return;
  if (!notifiedAlready) fireAlarm(buildAlarmPattern(NURSING_PHASE_MINUTES), getAlarmSnapshot());

  const notified = withPhase(active.notified, phase, 1);
  if (phase !== 'burp') {
    store({ ...active, notified });
    return;
  }
  // ゲップまで終われば1セット完了。止めた時刻は「授乳は済んだが記録はまだ」の印になる。
  store({
    ...active,
    elapsed: withPhase(active.elapsed, 'burp', elapsed),
    notified,
    runningPhase: null,
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
  if (getSnapshot().runningPhase === null) {
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
  const running = getSnapshot().runningPhase !== null;
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
  /** いま測っているセットの、区切りごとの時間(ミリ秒)。計測中の分を含む。 */
  elapsed: NursingPhaseValues;
  /**
   * 記録に入る合計(ミリ秒)。前のセットで測った分と、
   * 「測る前に済ませたセット」ぶんの目安も含む。
   */
  total: NursingPhaseValues;
  /** いま何セット目か（1始まり）。測っていないセットも数に入れる。 */
  setNumber: number;
  /** 測る前に済ませたセットの数。 */
  untrackedSets: number;
  runningPhase: NursingPhase | null;
  /** 最後に計測した側。まだ一度も測っていなければ null（ゲップでは変わらない）。 */
  lastSide: BreastSide | null;
  /** 計測中、または止めたあと記録前の内容が残っている。 */
  hasSession: boolean;
  /**
   * 押した区切りの計測を始める。計測中の区切りをもう一度押すと停止、
   * 別の区切りを押すと切り替え（同時には測らない）。
   * 止まっているときに5分まで測り終えた区切りを押すと、次のセットとして測り直す。
   * 記録に入る合計を返すので、そのまま分数の入力欄へ反映できる。
   */
  togglePhase: (phase: NursingPhase) => NursingPhaseValues;
  /**
   * 測る前に済ませたセットの数を決める。急いで飲ませ始めて2セット目から
   * 記録したときなど、測れなかった分を記録へ足すために使う。
   * 記録に入る合計を返す。
   */
  setUntrackedSets: (count: number) => NursingPhaseValues;
  reset: () => void;
}

export function useNursingTimer(): NursingTimer {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = useSyncExternalStore(
    active.runningPhase ? subscribeClock : subscribeNothing,
    getClockSnapshot,
    getClockServerSnapshot,
  );

  const runningMs =
    active.runningPhase && active.startedAt ? Math.max(0, now - active.startedAt) : 0;
  const elapsed = {
    left: active.elapsed.left + (active.runningPhase === 'left' ? runningMs : 0),
    right: active.elapsed.right + (active.runningPhase === 'right' ? runningMs : 0),
    burp: active.elapsed.burp + (active.runningPhase === 'burp' ? runningMs : 0),
  };

  const togglePhase = useCallback((phase: NursingPhase) => {
    // iOS/Chromeは「タップの処理の中」でしか音の再生を許可しないため、ここで解除しておく。
    void unlockAudio();
    stopVibration();
    const at = Date.now();
    clockNow = at;
    const prev = getSnapshot();
    const running = prev.runningPhase;
    const runningElapsed = running && prev.startedAt ? Math.max(0, at - prev.startedAt) : 0;
    const settled: NursingPhaseValues = running
      ? withPhase(prev.elapsed, running, prev.elapsed[running] + runningElapsed)
      : prev.elapsed;
    const stopping = running === phase;
    // 5分まで測り終えた区切りをもう一度押したのは、次のセットに入ったということ。
    // いまのセットを締めてから測り直す（表示は0から、お知らせもまた鳴る）。
    const startsNextSet = !stopping && settled[phase] >= NURSING_PHASE_MS;
    const base = startsNextSet
      ? rollOverSet(prev, settled)
      : { ...prev, elapsed: settled };
    const next: ActiveNursing = {
      ...base,
      runningPhase: stopping ? null : phase,
      startedAt: stopping ? null : at,
      // 止めた時刻は「授乳は済んだが記録はまだ」の印になる。測り直したら消す。
      stoppedAt: stopping ? at : null,
      // ゲップは飲ませていないので「最後に飲ませた側」は変えない。
      lastSide: phase === 'burp' ? prev.lastSide : phase,
    };
    store(next);
    return totalValues(next, next.elapsed);
  }, []);

  const setUntrackedSets = useCallback((count: number) => {
    const prev = getSnapshot();
    const next: ActiveNursing = {
      ...prev,
      untrackedSets: Math.max(0, Math.min(MAX_UNTRACKED_SETS, Math.floor(count))),
    };
    store(next);
    // 計測中なら、その分も足した合計を返す（入力欄に出す値と合わせる）。
    const running =
      next.runningPhase && next.startedAt ? Math.max(0, Date.now() - next.startedAt) : 0;
    return totalValues(
      next,
      next.runningPhase
        ? withPhase(next.elapsed, next.runningPhase, next.elapsed[next.runningPhase] + running)
        : next.elapsed,
    );
  }, []);

  const reset = useCallback(() => {
    stopVibration();
    store(EMPTY);
  }, []);

  return {
    elapsed,
    total: totalValues(active, elapsed),
    setNumber: active.untrackedSets + active.measuredSets + 1,
    untrackedSets: active.untrackedSets,
    runningPhase: active.runningPhase,
    lastSide: active.lastSide,
    hasSession: hasSession(active) || hasElapsed(elapsed),
    togglePhase,
    setUntrackedSets,
    reset,
  };
}

/** 計測した時間を記録用の分数に。1分に満たない計測も0分にはしない。 */
export const nursingMinutes = (ms: number): number =>
  ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60000));
