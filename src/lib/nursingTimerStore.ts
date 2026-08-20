// 授乳タイマーの状態を保持する外部ストア。
//
// Reactのstateではなくモジュール側で持つ理由:
//  - localStorageという「外部の状態」が本体で、リロードや別タブからの復帰でも
//    計測を継続したいため（useSyncExternalStoreで購読する）。
//  - サーバー描画時は必ず初期値を返せるので、ハイドレーションのズレが起きない。

export const ALARM_INTERVAL_OPTIONS = [3, 5, 10, 15] as const;
export type AlarmIntervalMinutes = (typeof ALARM_INTERVAL_OPTIONS)[number];

export const NURSING_SIDES = ['left', 'right', 'bottle'] as const;
export type NursingSide = (typeof NURSING_SIDES)[number];

export const NURSING_SIDE_LABELS: Record<NursingSide, string> = {
  left: '左',
  right: '右',
  bottle: 'ミルク',
};

export interface NursingTimerSettings {
  /** 何分ごとにお知らせするか。長音1回=30分で表すため、30の約数のみ選べる */
  intervalMinutes: AlarmIntervalMinutes;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export interface NursingTimerState {
  /** 計測中の開始時刻(epoch ms)。一時停止中・未開始はnull */
  runningSince: number | null;
  /** 一時停止までに積み上がった経過ミリ秒 */
  accumulatedMs: number;
  side: NursingSide;
  /** すでに鳴らした「n回目のお知らせ」。リロードしても鳴り直さないよう保持する */
  notifiedStep: number;
}

export interface NursingTimerSnapshot {
  state: NursingTimerState;
  settings: NursingTimerSettings;
}

const IDLE_STATE: NursingTimerState = {
  runningSince: null,
  accumulatedMs: 0,
  side: 'left',
  notifiedStep: 0,
};

const DEFAULT_SETTINGS: NursingTimerSettings = {
  intervalMinutes: 5,
  soundEnabled: true,
  vibrationEnabled: true,
};

const INITIAL_SNAPSHOT: NursingTimerSnapshot = {
  state: IDLE_STATE,
  settings: DEFAULT_SETTINGS,
};

const STATE_STORAGE_KEY = 'sukusuku:nursing-timer:v1';
const SETTINGS_STORAGE_KEY = 'sukusuku:nursing-timer-settings:v1';

let snapshot: NursingTimerSnapshot = INITIAL_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

const readStoredState = (): NursingTimerState => {
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return IDLE_STATE;
    const parsed = JSON.parse(raw) as Partial<NursingTimerState>;
    return {
      runningSince: typeof parsed.runningSince === 'number' ? parsed.runningSince : null,
      accumulatedMs: typeof parsed.accumulatedMs === 'number' ? parsed.accumulatedMs : 0,
      side: NURSING_SIDES.includes(parsed.side as NursingSide) ? (parsed.side as NursingSide) : 'left',
      notifiedStep: typeof parsed.notifiedStep === 'number' ? parsed.notifiedStep : 0,
    };
  } catch {
    return IDLE_STATE;
  }
};

const readStoredSettings = (): NursingTimerSettings => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NursingTimerSettings>;
    return {
      intervalMinutes: ALARM_INTERVAL_OPTIONS.includes(parsed.intervalMinutes as AlarmIntervalMinutes)
        ? (parsed.intervalMinutes as AlarmIntervalMinutes)
        : DEFAULT_SETTINGS.intervalMinutes,
      soundEnabled: parsed.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
      vibrationEnabled: parsed.vibrationEnabled ?? DEFAULT_SETTINGS.vibrationEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const persist = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートブラウジング等で保存できなくても、計測自体は続けられる
  }
};

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

const setState = (next: NursingTimerState): void => {
  snapshot = { ...snapshot, state: next };
  persist(STATE_STORAGE_KEY, next);
  emit();
};

/** 経過ミリ秒。計測中は実時刻から都度計算するため、タブが裏に回ってもズレない。 */
export const elapsedOf = (state: NursingTimerState, now: number): number =>
  state.accumulatedMs + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince));

export const subscribeNursingTimer = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getNursingTimerSnapshot = (): NursingTimerSnapshot => {
  // 初回のクライアント読み出し時にlocalStorageから復元する。
  // （ハイドレーション描画ではgetServerSnapshotが使われるため差分は出ない）
  if (!hydrated) {
    hydrated = true;
    snapshot = { state: readStoredState(), settings: readStoredSettings() };
  }
  return snapshot;
};

export const getNursingTimerServerSnapshot = (): NursingTimerSnapshot => INITIAL_SNAPSHOT;

export const startNursingTimer = (side?: NursingSide): void => {
  setState({
    runningSince: Date.now(),
    accumulatedMs: 0,
    side: side ?? snapshot.state.side,
    notifiedStep: 0,
  });
};

export const pauseNursingTimer = (): void => {
  const current = snapshot.state;
  if (current.runningSince === null) return;
  setState({ ...current, runningSince: null, accumulatedMs: elapsedOf(current, Date.now()) });
};

export const resumeNursingTimer = (): void => {
  const current = snapshot.state;
  if (current.runningSince !== null) return;
  setState({ ...current, runningSince: Date.now() });
};

export const resetNursingTimer = (): void => {
  setState({ ...IDLE_STATE, side: snapshot.state.side });
};

/** 計測を終了し、記録に残すための経過時間を返す。未計測ならnull。 */
export const finishNursingTimer = (): { durationMs: number; side: NursingSide } | null => {
  const current = snapshot.state;
  const durationMs = elapsedOf(current, Date.now());
  if (durationMs <= 0) return null;
  setState({ ...IDLE_STATE, side: current.side });
  return { durationMs, side: current.side };
};

export const setNursingSide = (side: NursingSide): void => {
  setState({ ...snapshot.state, side });
};

export const markNursingAlarmNotified = (step: number): void => {
  const current = snapshot.state;
  if (current.notifiedStep >= step) return;
  setState({ ...current, notifiedStep: step });
};

export const updateNursingTimerSettings = (patch: Partial<NursingTimerSettings>): void => {
  const settings = { ...snapshot.settings, ...patch };
  snapshot = { ...snapshot, settings };
  persist(SETTINGS_STORAGE_KEY, settings);

  // 間隔を変えたら「通知済み回数」を新しい間隔で数え直す。
  // そうしないと、間隔を縮めた直後に過去の分がまとめて鳴ってしまう。
  if (patch.intervalMinutes !== undefined) {
    const elapsed = elapsedOf(snapshot.state, Date.now());
    setState({ ...snapshot.state, notifiedStep: Math.floor(elapsed / (patch.intervalMinutes * 60_000)) });
    return;
  }
  emit();
};
