import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BreastSide, NursingPhase } from '@/types/app';
import { applyNursingAlarm, type NursingAlarmTarget } from '@/lib/nursingAlarm';

// 授乳を「左5分 → 右5分 → ゲップ5分」の1セットとして計測するストップウォッチ。
//
// 授乳中は入力画面を閉じたり他の画面へ移ったりするため、計測中の値は端末内に控えておき、
// 戻ってきたときに続きから測れるようにする（記録として保存する前の値なので、DBには持たせない）。
//
// 区切りが5分に達するとお知らせが1回鳴るので、画面を見ていなくても次の区切りへ移る
// タイミングが分かる。ゲップの5分まで終われば1セット完了として計測も止まる。
// ゲップは飲ませた時間ではないため、計測とお知らせにだけ使い、記録には残さない
// （記録に入るのはこれまでどおり左右の分数だけ）。
//
// PWA版(src/lib/nursingTimer.ts)と同じ数え方。持ち方が違うのは次の2つ。
// - 控え先が localStorage から AsyncStorage へ。読み書きが非同期なので、
//   起動直後は空から始めて読み終えた時点で差し替える
// - 「鳴らし終えたか」を持たない。鳴らすのも数えるのも前面サービスの側で、
//   こちらは「いまどの区切りを何時から測っているか」だけを預ける（src/lib/nursingAlarm.ts）。
//   預け直しのたびにサービスがいまの経過ぶんから数え直すので、鳴り直さない

const STORAGE_KEY = 'sukusuku:activeNursing';

/** 1セットに含まれる区切り。並べる順番は画面側で決める（前回の続きから始めるため）。 */
export const NURSING_PHASES: NursingPhase[] = ['left', 'right', 'burp'];

/** 1区切りの長さ（分）。ここに達するとお知らせが鳴る。 */
export const NURSING_PHASE_MINUTES = 5;

/** 1区切りの長さ(ミリ秒)。 */
export const NURSING_PHASE_MS = NURSING_PHASE_MINUTES * 60_000;

/** 区切りごとの時間(ミリ秒)を持つ入れ物。 */
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

/**
 * 5分まで測り終えた区切りをもう一度押したとき、それが「次のセット」かどうか。
 *
 * そのセットで他の区切りをまだ一度も測っていなければ、次のセットではなく
 * 同じ区切りの続き。5分たったところで一旦やめて、また飲み始めたときに
 * 2セット目にされてしまうと（続く右も2セット目になり）セット数が合わなくなる。
 * 他の区切りを測ったあとで戻ってきたのなら、ひと回りしたということなので
 * 次のセットとして0から測り直す。
 */
const isNextSetTap = (settled: NursingPhaseValues, phase: NursingPhase): boolean =>
  settled[phase] >= NURSING_PHASE_MS &&
  NURSING_PHASES.some((other) => other !== phase && settled[other] > 0);

/** いまのセットを締めて次のセットへ。測った分は合計へ送る。 */
const rollOverSet = (active: ActiveNursing, settled: NursingPhaseValues): ActiveNursing => ({
  ...active,
  carried: {
    left: active.carried.left + settled.left,
    right: active.carried.right + settled.right,
    burp: active.carried.burp + settled.burp,
  },
  elapsed: ZERO,
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

/** 控えから読み出す。セット制にする前の控え(legacy)からも拾えるようにする。 */
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

/** セット制にする前の控え。入れ替わりの途中で開いても計測が消えないようにする。 */
interface StoredNursing extends Partial<ActiveNursing> {
  leftMs?: unknown;
  rightMs?: unknown;
  runningSide?: unknown;
}

const parse = (raw: string | null): ActiveNursing => {
  if (!raw) return EMPTY;
  try {
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
    };
  } catch {
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
  const phase = active.runningPhase;
  if (!phase || !active.startedAt) return null;
  return {
    phase,
    // 区切りを行き来してもその区切りの経過時間で数えるので、
    // 累積ぶんさかのぼった時刻を基準にする。
    baselineAt: active.startedAt - active.elapsed[phase],
    phaseMinutes: NURSING_PHASE_MINUTES,
  };
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
};

/** その区切りの合計時間(ミリ秒)。計測中ならその分も含む。 */
const phaseElapsed = (active: ActiveNursing, phase: NursingPhase, at: number): number =>
  active.elapsed[phase] +
  (active.runningPhase === phase && active.startedAt ? Math.max(0, at - active.startedAt) : 0);

/**
 * ゲップの5分まで終わっていたら、1セット完了として計測を止める。
 *
 * 授乳が終わったあと止め忘れて数えっぱなしになると、記録の時間も常駐通知も無駄になる。
 * 鳴らすのは前面サービスの側なので、ここでやるのは「止める」ことだけ。
 * アプリを閉じている間に5分を過ぎていた場合も、開き直したこの確認で締まる。
 */
const settleFinishedSet = () => {
  const active = getSnapshot();
  if (active.runningPhase !== 'burp' || !active.startedAt) return;
  const at = Date.now();
  const elapsed = phaseElapsed(active, 'burp', at);
  if (elapsed < NURSING_PHASE_MS) return;
  // 止めた時刻は「授乳は済んだが記録はまだ」の印になる。
  // 閉じている間に過ぎていた分は数えず、5分で止まったものとして締める。
  store({
    ...active,
    elapsed: withPhase(active.elapsed, 'burp', NURSING_PHASE_MS),
    runningPhase: null,
    startedAt: null,
    stoppedAt: active.startedAt + (NURSING_PHASE_MS - active.elapsed.burp),
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
// どの画面を開いていてもセットの締めが効くよう、Reactの外で動かす。

let watcherId: ReturnType<typeof setInterval> | null = null;

const syncWatcher = () => {
  const running = getSnapshot().runningPhase !== null;
  if (running && watcherId === null) {
    watcherId = setInterval(settleFinishedSet, 1000);
  } else if (!running && watcherId !== null) {
    clearInterval(watcherId);
    watcherId = null;
  }
};

/**
 * 端末に控えた計測を読み戻し、前面サービスへ預け直す。アプリ全体で1回だけ動かす。
 *
 * 前面サービスは機種によっては落とされることがあるので、前面に戻るたびに預け直す。
 * 預け直しても、サービスはいまの経過ぶんまで鳴らし済みとして数え始めるので鳴り直さない。
 * 閉じている間にゲップの5分を過ぎていた場合は、ここで締める。
 */
export function useNursingAlarmWatcher(): void {
  useEffect(() => {
    const resume = () => {
      settleFinishedSet();
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
  const active = useSyncExternalStore(subscribe, getSnapshot);
  const now = useSyncExternalStore(
    active.runningPhase ? subscribeClock : subscribeNothing,
    getClockSnapshot,
  );

  const runningMs =
    active.runningPhase && active.startedAt ? Math.max(0, now - active.startedAt) : 0;
  const elapsed: NursingPhaseValues = {
    left: active.elapsed.left + (active.runningPhase === 'left' ? runningMs : 0),
    right: active.elapsed.right + (active.runningPhase === 'right' ? runningMs : 0),
    burp: active.elapsed.burp + (active.runningPhase === 'burp' ? runningMs : 0),
  };

  const togglePhase = useCallback((phase: NursingPhase) => {
    const at = Date.now();
    clockNow = at;
    const prev = getSnapshot();
    const running = prev.runningPhase;
    const runningElapsed = running && prev.startedAt ? Math.max(0, at - prev.startedAt) : 0;
    const settled: NursingPhaseValues = running
      ? withPhase(prev.elapsed, running, prev.elapsed[running] + runningElapsed)
      : prev.elapsed;
    const stopping = running === phase;
    const startsNextSet = !stopping && isNextSetTap(settled, phase);
    const base = startsNextSet ? rollOverSet(prev, settled) : { ...prev, elapsed: settled };
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

  const reset = useCallback(() => store(EMPTY), []);

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
