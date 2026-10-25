import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BreastSide } from '@/types/app';
import { applyNursingAlarm, type NursingAlarmTarget } from '@/lib/nursingAlarm';
import type { PendingNursing } from '@/lib/feedingSchedule';
import { requestNotificationCleanup } from '@/lib/notificationCleanupTrigger';

// 授乳を左右別に測るストップウォッチ。左か右のボタンをタップして測り、もう一度押すと止まり、
// 反対側を押すと切り替わる（同時には測らない）。
//
// 授乳中は入力画面を閉じたり他の画面へ移ったりするため、計測中の値は端末内に控えておき、
// 戻ってきたときに続きから測れるようにする（記録として保存する前の値なので、DBには持たせない）。
//
// 測っている間は5分たつごとにお知らせが鳴り（5分=1回、10分=2回…と、経過時間が回数で分かる。
// 鳴り方の規則は src/lib/alarmPattern.ts）、画面を見ていなくても経過が分かる。
// 止め忘れて数えっぱなしにならないよう、1つの側が60分に達したところで計測を止める。
//
// 以前は「左5分 → 右5分 → ゲップ5分」の1セットとして測っていたが、セットの仕組み
// （ゲップ・セット数・測る前に済ませたセット）はやめた。端末に控えてある旧形式の計測は
// 読み込むときに左右の合計へ畳む。
//
// PWA版(src/lib/nursingTimer.ts)と同じ数え方。持ち方が違うのは次の2つ。
// - 控え先が localStorage から AsyncStorage へ。読み書きが非同期なので、
//   起動直後は空から始めて読み終えた時点で差し替える
// - 「鳴らし終えたか」を持たない。鳴らすのも数えるのも前面サービスで、
//   こちらは「いまどちら側を何時から測っているか」だけを預ける（src/lib/nursingAlarm.ts）。
//   預け直しのたびにサービスがいまの経過ぶんから数え直すので、鳴り直さない

const STORAGE_KEY = 'sukusuku:activeNursing';

/** 測る側。並べる順番は画面側で決める。 */
export const NURSING_SIDES: BreastSide[] = ['left', 'right'];

/** お知らせを鳴らす間隔（分）。 */
export const NURSING_ALARM_MINUTES = 5;

/** 1つの側を測れる上限(ミリ秒)。ここに達したら計測を止める。 */
export const NURSING_MAX_MS = 60 * 60_000;

/** 左右ごとの時間(ミリ秒)を持つ入れ物。 */
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
}

const EMPTY: ActiveNursing = {
  elapsed: ZERO,
  runningSide: null,
  startedAt: null,
  sessionStartedAt: null,
  stoppedAt: null,
  lastSide: null,
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

const UNTRACKED_SET_MS = NURSING_ALARM_MINUTES * 60_000;

const foldSide = (parsed: StoredNursing, side: BreastSide, legacy: unknown): number => {
  const untracked = toMs(parsed.untrackedSets);
  const total =
    toMs(parsed.elapsed?.[side] ?? legacy) +
    toMs(parsed.carried?.[side]) +
    Math.floor(untracked) * UNTRACKED_SET_MS;
  return Math.min(total, NURSING_MAX_MS);
};

const parse = (raw: string | null): ActiveNursing => {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as StoredNursing;
    const startedAt = toMs(parsed.startedAt) || null;
    // 開始時刻が失われていると経過時間を復元できないので、計測中とは扱わない。
    // 旧形式でゲップを測っていた場合も、続きは無いので停止扱いにする。
    const runningSide = startedAt ? toSide(parsed.runningPhase ?? parsed.runningSide) : null;
    return {
      elapsed: {
        left: foldSide(parsed, 'left', parsed.leftMs),
        right: foldSide(parsed, 'right', parsed.rightMs),
      },
      runningSide,
      startedAt: runningSide ? startedAt : null,
      // 持たせる前に控えた分には入っていない。そのときは無いものとして扱う。
      sessionStartedAt: toMs(parsed.sessionStartedAt) || null,
      stoppedAt: toMs(parsed.stoppedAt) || null,
      lastSide: toSide(parsed.lastSide),
    };
  } catch {
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
    phase: side,
    // 左右を行き来してもその側の経過時間で数えるので、
    // 累積ぶんさかのぼった時刻を基準にする。
    baselineAt: active.startedAt - active.elapsed[side],
    phaseMinutes: NURSING_ALARM_MINUTES,
  };
};

/**
 * 計測を止めてから記録するまでを「授乳中」として預けておく上限。
 * サーバー側の打ち切り(send-nursing-alarms の MAX_PENDING_MINUTES)と合わせている。
 */
const PENDING_MAX_MS = 60 * 60_000;

/** サーバーへ預ける「いま授乳中」の内容。 */
export interface NursingStateTarget {
  /** 計測中の側（nursing_alarms.side に入る）。 */
  side: BreastSide;
  /** その側の合計時間が0だった時刻。 */
  baselineAt: number;
  intervalMinutes: number;
  /** 計測を止めた時刻。まだ記録していない間だけ入る（計測中は null）。 */
  stoppedAt: number | null;
}

/**
 * サーバーへ預ける内容。PWA版(src/lib/nursingTimer.ts の alarmTarget)と同じ形にしてある。
 *
 * ネイティブ版では鳴らすのは前面サービスなので、これはお知らせの予約ではなく
 * 「そろそろ次の授乳」を止めるための印（src/lib/api/nursingAlarms.ts）。
 * 計測中も、止めたあと記録するまでの間も預ける。記録・リセットすれば null。
 */
const stateTarget = (active: ActiveNursing): NursingStateTarget | null => {
  const running = active.runningSide;
  if (running && active.startedAt) {
    return {
      side: running,
      baselineAt: active.startedAt - active.elapsed[running],
      intervalMinutes: NURSING_ALARM_MINUTES,
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
    stoppedAt: active.stoppedAt,
  };
};

type NursingStateSink = (target: NursingStateTarget | null) => void;

let stateSink: NursingStateSink | null = null;

/** サーバーへ預ける処理を差し込む。渡した時点の状態も一度流す。 */
export const setNursingStateSink = (next: NursingStateSink | null): void => {
  stateSink = next;
  next?.(stateTarget(getSnapshot()));
};

const store = (next: ActiveNursing) => {
  cached = next;
  // 控えの書き込みを待たせると、押した手応えが遅れる。結果は待たない。
  void (hasSession(next)
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    : AsyncStorage.removeItem(STORAGE_KEY)
  ).catch(() => {
    // 控えられなくても計測そのものは続く（アプリを閉じたときに失われるだけ）。
  });
  emit();
  applyNursingAlarm(alarmTarget(next));
  stateSink?.(stateTarget(next));
  // 測り始めた・記録した・リセットした直後に、出ているお知らせを見直す。
  requestNotificationCleanup();
};

/** その側の合計時間(ミリ秒)。計測中ならその分も含み、上限を超えない。 */
const sideElapsed = (active: ActiveNursing, side: BreastSide, at: number): number =>
  Math.min(
    NURSING_MAX_MS,
    active.elapsed[side] +
      (active.runningSide === side && active.startedAt ? Math.max(0, at - active.startedAt) : 0),
  );

/**
 * 計測中の側が上限(60分)に達していたら計測を止める。
 *
 * 授乳が終わったあと止め忘れて数えっぱなしになると、記録の時間も常駐通知も無駄になる。
 * 鳴らすのは前面サービスの側なので、ここでやるのは「止める」ことだけ。
 * アプリを閉じている間に上限を過ぎていた場合も、開き直したこの確認で締まる。
 */
const settleOverrun = () => {
  const active = getSnapshot();
  const side = active.runningSide;
  if (!side || !active.startedAt) return;
  const at = Date.now();
  if (active.elapsed[side] + Math.max(0, at - active.startedAt) < NURSING_MAX_MS) return;
  // 止めた時刻は「授乳は済んだが記録はまだ」の印になる。
  // 閉じている間に過ぎていた分は数えず、上限で止まったものとして締める。
  store({
    ...active,
    elapsed: withSide(active.elapsed, side, NURSING_MAX_MS),
    runningSide: null,
    startedAt: null,
    stoppedAt: active.startedAt + (NURSING_MAX_MS - active.elapsed[side]),
  });
};

let hydration: Promise<void> | null = null;

/** 端末に控えた計測を読み戻し、続きから測れるようにする。 */
const hydrate = (): Promise<void> => {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        cached = parse(raw);
        emit();
        // 読み戻した内容もサーバーへ預け直す。アプリを開き直したときに
        // 「授乳中」の印が消えたままにならないようにするため。
        stateSink?.(stateTarget(cached));
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

// --- 計測中の見張り ---
// どの画面を開いていても上限での締めが効くよう、Reactの外で動かす。

let watcherId: ReturnType<typeof setInterval> | null = null;

const syncWatcher = () => {
  const running = getSnapshot().runningSide !== null;
  if (running && watcherId === null) {
    watcherId = setInterval(settleOverrun, 1000);
  } else if (!running && watcherId !== null) {
    clearInterval(watcherId);
    watcherId = null;
  }
};

/**
 * 記録前の授乳が端末に残っているか（計測中・測った時間のいずれか）。
 *
 * PWA版の useHasNursingSession と同じ判断だが、こちらは描画とは関係なく
 * 「いまどうか」を1度だけ知りたい側（notificationCleanup.ts）から呼ぶのでフックにしない。
 * 控えの読み戻しが済んでいなければ待つ。まだなら「計測なし」と答えてしまい、
 * 出ている授乳のお知らせを誤って消すことになる。
 */
export const hasNursingSession = async (): Promise<boolean> => {
  await hydrate();
  return hasSession(getSnapshot());
};

/**
 * この端末で測っている（測り終えて記録待ちの）授乳。無ければ null。
 *
 * サーバーへ預ける印（nursing_alarms）は通知をオフにした端末や圏外では届かないので、
 * 「そろそろ次の授乳」を消すかの判断にはこの端末の控えを直接使う（notificationCleanup.ts）。
 * 古さの上限は呼ぶ側（activePendingNursing）が見る。
 */
export const localPendingNursing = async (): Promise<PendingNursing | null> => {
  await hydrate();
  const active = getSnapshot();
  if (!hasSession(active)) return null;
  const startedAt = active.sessionStartedAt ?? active.startedAt ?? active.stoppedAt ?? Date.now();
  const stopped = !active.runningSide && active.stoppedAt;
  return {
    startedAt: new Date(startedAt),
    stoppedAt: stopped ? new Date(active.stoppedAt as number) : null,
  };
};

/**
 * 端末に控えた計測を読み戻し、前面サービスへ預け直す。アプリ全体で1回だけ動かす。
 *
 * 前面サービスは機種によっては落とされることがあるので、前面に戻るたびに預け直す。
 * 預け直しても、サービスはいまの経過ぶんまで鳴らし済みとして数え始めるので鳴り直さない。
 * 閉じている間に上限(60分)を過ぎていた場合は、ここで締める。
 */
export function useNursingAlarmWatcher(): void {
  useEffect(() => {
    const resume = () => {
      settleOverrun();
      applyNursingAlarm(alarmTarget(getSnapshot()));
      syncWatcher();
    };

    void hydrate().then(resume);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
    });
    // 計測の開始・停止に合わせて見張りを掛け外しする。
    const unsubscribe = subscribe(syncWatcher);
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);
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
  const active = useSyncExternalStore(subscribe, getSnapshot);
  const now = useSyncExternalStore(
    active.runningSide ? subscribeClock : subscribeNothing,
    getClockSnapshot,
  );

  const elapsed: NursingSideValues = {
    left: sideElapsed(active, 'left', now),
    right: sideElapsed(active, 'right', now),
  };

  const toggleSide = useCallback((side: BreastSide) => {
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

  const reset = useCallback(() => store(EMPTY), []);

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
