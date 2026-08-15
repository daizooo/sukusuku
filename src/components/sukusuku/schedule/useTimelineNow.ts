'use client';

import { useEffect, useState } from 'react';
import type { CareLog } from '@/types/app';

/**
 * 24時間の帯で計測中の睡眠を「今」まで伸ばして描くための時刻。
 *
 * 最初の描画では null を返す（サーバー側の描画と食い違わせないため）。
 * 計測中の睡眠がない間は時計を動かさない。
 */
export function useTimelineNow(logs: CareLog[]): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  const hasActiveSleep = logs.some((log) => log.type === 'sleep' && log.endedAt === null);

  useEffect(() => {
    if (!hasActiveSleep) return;
    const update = () => setNow(new Date());
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [hasActiveSleep]);

  return now;
}
