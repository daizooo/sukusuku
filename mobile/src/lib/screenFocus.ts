import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// 画面を見ている間だけ動かすもの。
//
// 他の端末・他のタブでの変更を画面へ届ける仕組みは familySync.tsx（useFamilyRefresh）。
// ここにあるのは、変更が無くても時間がたてば変わるもの（古くなった印を画面から落とすなど）を
// 再評価するための定期的な読み直しだけ。

/**
 * そのタブを見ている間だけ、一定の間隔で読み直す。
 *
 * 「いま授乳中」の印のように、こちらが何もしなくても時間で変わるものだけに使う
 * （他の端末での変更は台帳で届く。familySync.tsx）。
 *
 * 見ていない間は動かさないので、裏で通信し続けることはない。
 *
 * @param refresh 読み直す処理。毎回の描画で作り直してもよい。
 * @param intervalMs 読み直す間隔。
 */
export function useRefreshWhileFocused(refresh: () => void, intervalMs: number): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useFocusEffect(
    useCallback(() => {
      const tick = () => latest.current();
      const timerId = setInterval(tick, intervalMs);
      // 画面を消している間はタイマーが間引かれるので、前面に戻ったところで1回読む。
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') tick();
      });
      return () => {
        clearInterval(timerId);
        subscription.remove();
      };
    }, [intervalMs]),
  );
}
