// 夜間の起床アラームを「いつ鳴らすか」を決める（docs/night-wake-alarm.md §3）。
//
// 予約そのものはネイティブ（modules/nursing-alarm）に預ける。ここは判断だけの純粋な関数で、
// 端末や通信には触れない（境界の取りこぼしを node のテストで確かめられるようにするため。
// テスト: npm run test:wake-alarm）。

import { nextFeedingSchedule, type LastFeeding } from './feedingSchedule.ts';

/** 目安の時刻の何分前に鳴らすか。仕様で15分に固定（選べない）。 */
export const WAKE_LEAD_MINUTES = 15;

/** 日本時間で数える（おやすみ時間は「日本の時計で何時」）。 */
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MINUTES = 24 * 60;

/** おやすみ時間。0:00からの分で持つ。開始 > 終了なら日をまたぐ（22:00〜6:00 など）。 */
export interface QuietHours {
  startMinutes: number;
  endMinutes: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { startMinutes: 22 * 60, endMinutes: 6 * 60 };

/** その時刻の、日本時間の0:00からの分(0〜1439)。 */
export const minutesOfDayJst = (at: number): number => {
  const minutes = Math.floor((at + JST_OFFSET_MS) / 60_000);
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
};

/** 開始〜終了のなかか。開始と終了が同じなら「おやすみ時間なし」として扱う。 */
export const isWithinQuietHours = (at: number, quiet: QuietHours): boolean => {
  const { startMinutes, endMinutes } = quiet;
  if (startMinutes === endMinutes) return false;
  const minutes = minutesOfDayJst(at);
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
};

/** 540 -> '09:00' */
export const formatMinutesOfDay = (minutes: number): string => {
  const safe = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

export interface WakeAlarmPlan {
  /** 鳴らす時刻(epoch ms)。 */
  triggerAt: number;
  /** 次の授乳の目安の時刻(epoch ms)。 */
  dueAt: number;
}

export interface WakeAlarmInput {
  enabled: boolean;
  quiet: QuietHours;
  /** 記録と、まだ記録に入っていない授乳から決めた前回の授乳（resolveLastFeeding の結果）。 */
  lastFeeding: LastFeeding;
  intervalMinutes: number;
  now: number;
}

/**
 * 予約するべき起床アラーム。予約しないときは null（すでにある予約は取り消す）。
 *
 * - 目安の時刻（dueAt）がおやすみ時間のなかにあるときだけ。鳴らす時刻が時間の外へはみ出ても鳴らす。
 * - 授乳中（母乳を計測中）は予約しない。記録待ちは止めた時刻から数える（resolveLastFeeding）。
 * - 記録が1件もなければ目安が出ないので予約しない。
 * - 鳴らす時刻がすでに過ぎているときは、いきなり鳴らさない。目安の時刻の通知が拾う。
 */
export const planWakeAlarm = ({
  enabled,
  quiet,
  lastFeeding,
  intervalMinutes,
  now,
}: WakeAlarmInput): WakeAlarmPlan | null => {
  if (!enabled || lastFeeding.isNursing) return null;
  const schedule = nextFeedingSchedule(lastFeeding.lastFedAt, intervalMinutes, now);
  if (!schedule) return null;

  const dueAt = schedule.dueAt.getTime();
  if (!isWithinQuietHours(dueAt, quiet)) return null;

  const triggerAt = dueAt - WAKE_LEAD_MINUTES * 60_000;
  if (triggerAt <= now) return null;
  return { triggerAt, dueAt };
};
