import { useEffect, useState } from 'react';
import type { WakeAlarmEvaluation } from '@/lib/wakeAlarmPlan';

// 起床アラームの予約が「いまどうなっているか」。設定画面に出して、
// 鳴らないときにその理由を自分で確かめられるようにする（予約は端末の中だけで、見えないため）。

export type WakeAlarmStatus =
  /** 設定画面を開いた直後など、まだ判断していない。 */
  | { kind: 'pending' }
  /** 家族の情報が取れず、判断できなかった（まだ参加していない・圏外で控えも無い）。 */
  | { kind: 'no-family' }
  /** 判断の結果。nativeTriggerAt は端末の目覚ましに実際に入っている時刻（読み戻した値）。 */
  | { kind: 'evaluated'; evaluation: WakeAlarmEvaluation; nativeTriggerAt: number | null }
  /** 設定画面の「テスト鳴動」で予約した時刻。 */
  | { kind: 'test'; triggerAt: number }
  | { kind: 'error'; message: string };

let current: WakeAlarmStatus = { kind: 'pending' };
const listeners = new Set<(status: WakeAlarmStatus) => void>();

export const publishWakeAlarmStatus = (status: WakeAlarmStatus): void => {
  current = status;
  listeners.forEach((listener) => listener(status));
};

export function useWakeAlarmStatus(): WakeAlarmStatus {
  const [status, setStatus] = useState<WakeAlarmStatus>(current);
  useEffect(() => {
    listeners.add(setStatus);
    setStatus(current);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}
