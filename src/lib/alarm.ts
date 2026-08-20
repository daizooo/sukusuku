// 授乳タイマーのアラーム（音・バイブ・画面スリープ防止）ユーティリティ。
//
// - 音   : Web Audio APIでビープを合成する。音声ファイルを同梱せずに済み、
//          「長音=30分／短音=お知らせ間隔1つ分」を鳴らす回数で組み合わせることで、
//          画面を見なくても経過時間そのものが分かる。
// - バイブ: navigator.vibrate。Android Chrome等のみ対応（iOS Safariは非対応）。
// - 画面  : Screen Wake Lock APIで、タイマー稼働中は画面を消灯させない。
//          画面が消える（タブがバックグラウンドになる）とブラウザのタイマーが
//          間引かれ、アラームが遅れるため。

type AudioContextCtor = new () => AudioContext;

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) return null;
  if (!audioContext) audioContext = new ctor();
  return audioContext;
};

/**
 * iOS/Chromeでは「ユーザー操作のハンドラの中で」AudioContextをresumeしないと、
 * その後どれだけ鳴らそうとしても無音になる。タイマー開始ボタンのタップなど、
 * 必ずユーザー操作起点で呼ぶこと。
 * @returns 音を鳴らせる状態になったか
 */
export const unlockAudio = async (): Promise<boolean> => {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state !== 'running') await ctx.resume();
    // 長さ1サンプルの無音を再生してロック解除を確実にする
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
    return ctx.state === 'running';
  } catch {
    return false;
  }
};

export const isAudioReady = (): boolean => audioContext?.state === 'running';

const SHORT_BEEP_SEC = 0.18;
const LONG_BEEP_SEC = 0.6;
const GAP_SEC = 0.12;
const SHORT_BEEP_HZ = 880; // 高い「ピッ」= 区切り1つ分
const LONG_BEEP_HZ = 440; // 低い「ポーン」= 30分

/**
 * 鳴らし方のパターン。音（と振動）の回数だけで経過時間が分かるようにするため、
 * 30分を長音1回、それ未満の端数を「お知らせ間隔」ごとの短音1回で表す。
 * 例）5分間隔のとき: 5分=短1, 15分=短3, 30分=長1, 40分=長1+短2
 */
export interface AlarmPattern {
  long: number;
  short: number;
}

/** 経過分数を、長音（30分）と短音（intervalMinutes）の回数に分解する。 */
export const buildAlarmPattern = (
  elapsedMinutes: number,
  intervalMinutes: number,
): AlarmPattern => {
  const long = Math.floor(elapsedMinutes / 30);
  const remainder = elapsedMinutes - long * 30;
  return { long, short: intervalMinutes > 0 ? Math.round(remainder / intervalMinutes) : 0 };
};

/** パターンを「ポーン ピッピッ」のような表記にする（画面での凡例表示用）。 */
export const describeAlarmPattern = ({ long, short }: AlarmPattern): string => {
  const parts: string[] = [];
  if (long > 0) parts.push('ポーン'.repeat(long));
  if (short > 0) parts.push('ピッ'.repeat(short));
  return parts.join(' ') || '—';
};

const scheduleBeep = (
  ctx: AudioContext,
  at: number,
  frequency: number,
  duration: number,
): void => {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, at);
  // 立ち上がり・立ち下がりを鈍らせてプチッというノイズを防ぐ
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
};

/** 長音→短音の順に鳴らす。画面を見なくても回数を数えれば経過時間が分かる。 */
export const playAlarmPattern = ({ long, short }: AlarmPattern): void => {
  const ctx = getAudioContext();
  if (!ctx) return;
  // バックグラウンド復帰直後などにsuspendedへ戻ることがあるので都度復帰を試みる
  if (ctx.state !== 'running') void ctx.resume();

  let at = ctx.currentTime + 0.02;
  for (let i = 0; i < long; i += 1) {
    scheduleBeep(ctx, at, LONG_BEEP_HZ, LONG_BEEP_SEC);
    at += LONG_BEEP_SEC + GAP_SEC;
  }
  // 長音と短音の境目は少し長めに空けて、聞き分けやすくする
  if (long > 0 && short > 0) at += 0.25;
  for (let i = 0; i < short; i += 1) {
    scheduleBeep(ctx, at, SHORT_BEEP_HZ, SHORT_BEEP_SEC);
    at += SHORT_BEEP_SEC + GAP_SEC;
  }
};

export const isVibrationSupported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** 音と同じパターンで振動させる（長い振動=30分、短い振動=お知らせ間隔1つ分）。 */
export const vibrateAlarmPattern = ({ long, short }: AlarmPattern): void => {
  if (!isVibrationSupported()) return;
  // [振動, 停止, 振動, 停止, ...] の形式
  const pattern: number[] = [];
  for (let i = 0; i < long; i += 1) pattern.push(700, 250);
  // 長い振動と短い振動の境目は長めに空けて聞き分け（感じ分け）やすくする
  if (long > 0 && short > 0) pattern[pattern.length - 1] = 600;
  for (let i = 0; i < short; i += 1) pattern.push(250, 200);
  if (pattern.length === 0) return;
  pattern.pop(); // 末尾の停止時間は不要
  try {
    navigator.vibrate(pattern);
  } catch {
    // 端末が拒否した場合は黙って諦める（音側で気づけるため）
  }
};

export const stopVibration = (): void => {
  if (!isVibrationSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // noop
  }
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

/** 画面スリープを抑止する。非対応ブラウザではnullを返す。 */
export const requestScreenWakeLock = async (): Promise<WakeLockSentinelLike | null> => {
  if (typeof navigator === 'undefined') return null;
  const wakeLock = (navigator as WakeLockNavigator).wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request('screen');
  } catch {
    // 省電力モードなどで拒否されることがある
    return null;
  }
};
