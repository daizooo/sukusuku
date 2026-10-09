'use client';

import { useEffect, useRef } from 'react';

/** アプリへ戻ってきたときに読み直す、前回からの最短の間隔（ミリ秒）。 */
const DEFAULT_MIN_INTERVAL_MS = 30_000;

/**
 * アプリ（ブラウザのタブ・ホーム画面のアプリ）へ戻ってきたときに読み直す。
 * mobile版の useRefreshOnFocus（mobile/src/lib/screenFocus.ts）の前面復帰と同じ役目。
 *
 * 起動時に読んだきりだと、パートナーの端末での変更は開き直すまで出てこない。
 * 前回の読み直しから間隔が空いたときだけ呼ぶので、すぐ戻っただけでは読み直さない。
 *
 * @param refresh 読み直す処理。毎回の描画で作り直してもよい。
 * @param minIntervalMs 前回からの最短の間隔。読むのに時間がかかる画面は長くする。
 */
export function useRefreshOnResume(
  refresh: () => void,
  minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    // 画面自身の読み込みが済んだ時刻として、出した時点を起点にする。
    let lastRefreshedAt = Date.now();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshedAt < minIntervalMs) return;
      lastRefreshedAt = Date.now();
      latest.current();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [minIntervalMs]);
}
