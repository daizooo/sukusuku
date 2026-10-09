import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// タブを行き来したときに、出ているものを他のタブでの変更に追いつかせるための決まりごと。
//
// PWA版は記録も予定も設定もアプリ全体で1つ持っていて（src/components/sukusuku/SukusukuApp.tsx）、
// どのタブで変えてもその場で全部の画面に出る。ネイティブ版はタブごとに読む作りなので、
// 一度開いたタブはそのまま残り、起動時に読んだきりになる。そのため他のタブでの変更が
// 出ないままになる（例: 記録タブで授乳を記録しても、ホームの「次の授乳の目安」が前のまま）。
//
// 画面に出る形はPWA版と同じにするのが第一なので（ルートの CLAUDE.md）、
// そのタブへ戻ってきたところで読み直して追いつかせる。

/** アプリが前面へ戻ったときに読み直す、最短の間隔（ミリ秒）。 */
const DEFAULT_RESUME_MIN_INTERVAL_MS = 30_000;

/**
 * そのタブへ「戻ってきた」ときと、アプリが「前面へ戻ってきた」ときに読み直す。
 *
 * タブは一度開くと残り、読み込みは起動時の1回きりなので、パートナーの端末での変更は
 * アプリを開き直さない限り出てこない。裏から前面へ戻っただけではタブは切り替わらないため、
 * タブへ戻ったとき（useFocusEffect）だけでは足りず、前面復帰も拾う。
 *
 * - 前面復帰で読み直すのは、いま見ているタブだけ（他のタブは、開いたときに読み直す）。
 * - 前面復帰は、前回の読み直しから間隔が空いたときだけ。すぐ戻っただけで読み込み直さない。
 *   タブへ戻ったときは、間隔にかかわらず読み直す。
 * - 初めてそのタブを出したときは動かさない。画面自身の読み込みと重なって二重になるため。
 *
 * @param refresh 読み直す処理。毎回の描画で作り直してもよい（呼ぶのは戻ってきた時点の分）。
 * @param resumeMinIntervalMs 前面復帰で読み直す、前回からの最短の間隔。重い画面は長くする。
 */
export function useRefreshOnFocus(
  refresh: () => void,
  resumeMinIntervalMs: number = DEFAULT_RESUME_MIN_INTERVAL_MS,
): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  // 一度離れたかどうか。離れずに済んでいる間は読み直す必要がない。
  const hasLeft = useRef(false);
  // 最後に読み直した（画面自身の読み込みを含めた）時刻。
  const lastRefreshedAt = useRef(Date.now());

  useFocusEffect(
    useCallback(() => {
      const run = () => {
        lastRefreshedAt.current = Date.now();
        latest.current();
      };
      if (hasLeft.current) {
        hasLeft.current = false;
        run();
      }
      // 見ている間だけ前面復帰を聞く（見ていないタブは、開いたときに上の処理で読み直す）。
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active' && Date.now() - lastRefreshedAt.current >= resumeMinIntervalMs) {
          run();
        }
      });
      return () => {
        subscription.remove();
        hasLeft.current = true;
      };
    }, [resumeMinIntervalMs]),
  );
}

/**
 * そのタブを見ている間だけ、一定の間隔で読み直す。
 *
 * 他のタブへ行って戻る（useRefreshOnFocus）だけでは、開きっぱなしのホームに
 * パートナーの端末の動きが出てこない。「いま授乳中」のように、こちらが何もしなくても
 * 変わるものだけに使う（記録や予定はタブを切り替えたときに追いつけば足りる）。
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
