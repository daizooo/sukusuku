// 夜間の起床アラームを、端末ごとに「いつ鳴らすか」を決める（docs/night-wake-alarm.md §3・§4）。
//
// アプリ側の判断（mobile/src/lib/wakeAlarmPlan.ts の evaluateWakeAlarm）と同じ規則。
// 端末は自分で組み直せるが、PWAなど別の端末での記録には気づけない。サーバーが同じ規則で
// 毎分求め直し、前回伝えた内容と違えば端末へ伝える。2か所の規則を揃えること
// （テスト: npm run test:wake-plan）。

import { isWithinQuietHours } from './quietHours.ts';

/** 目安の時刻の何分前に鳴らすか。仕様で15分に固定。 */
export const WAKE_LEAD_MINUTES = 15;

export interface WakePlan {
  /** 鳴らす時刻(epoch ms)。 */
  triggerAt: number;
  /** 次の授乳の目安の時刻(epoch ms)。 */
  dueAt: number;
}

export interface WakePlanInput {
  enabled: boolean;
  /** 家族の次の授乳の目安の時刻(epoch ms)。まだ記録が無ければ null。 */
  dueAt: number | null;
  /** いま授乳中（母乳を計測中・記録待ち）か。 */
  nursing: boolean;
  quietStart: number | null;
  quietEnd: number | null;
  now: number;
}

/**
 * 予約するべき起床アラーム。予約しないときは null。
 *
 * - 目安の時刻がおやすみ時間のなかにあるときだけ（鳴らす時刻がはみ出ても鳴らす）。
 * - 授乳中は予約しない。記録が入ってから、次の目安で予約する。
 * - 鳴らす時刻がすでに過ぎているときは、いきなり鳴らさない（目安の時刻の通知が拾う）。
 */
export function planWake({
  enabled,
  dueAt,
  nursing,
  quietStart,
  quietEnd,
  now,
}: WakePlanInput): WakePlan | null {
  if (!enabled || nursing || dueAt === null) return null;
  if (!isWithinQuietHours(dueAt, quietStart, quietEnd)) return null;
  const triggerAt = dueAt - WAKE_LEAD_MINUTES * 60_000;
  if (triggerAt <= now) return null;
  return { triggerAt, dueAt };
}

/**
 * 端末へ何を伝えるか。
 *
 * - schedule: 求めた時刻が、前回伝えた時刻と違う（端末は目覚ましを入れ替える）
 * - cancel: 予約が要らなくなり、前回伝えた時刻がまだ先にある（端末は目覚ましを外す）
 * - clear: 予約が要らなくなったが、前回伝えた時刻はもう過ぎている。**端末へは送らず**、
 *   控えだけ消す。鳴ったあとに端末が入れる「5分後の再鳴動」を、取り消してしまわないため。
 * - none: 何もしない（伝えるべき変化が無い）
 */
export type WakeSyncAction = 'schedule' | 'cancel' | 'clear' | 'none';

export function decideWakeSync(
  plan: WakePlan | null,
  syncedTriggerAt: number | null,
  now: number,
): WakeSyncAction {
  if (plan) return plan.triggerAt === syncedTriggerAt ? 'none' : 'schedule';
  if (syncedTriggerAt === null) return 'none';
  return syncedTriggerAt > now ? 'cancel' : 'clear';
}
