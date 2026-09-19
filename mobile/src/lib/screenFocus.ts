import { useCallback, useEffect, useRef } from 'react';
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

/**
 * そのタブへ「戻ってきた」ときに読み直す。
 *
 * 初めてそのタブを出したときは動かさない。画面自身の読み込みと重なって二重になるため。
 *
 * @param refresh 読み直す処理。毎回の描画で作り直してもよい（呼ぶのは戻ってきた時点の分）。
 */
export function useRefreshOnFocus(refresh: () => void): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  // 一度離れたかどうか。離れずに済んでいる間は読み直す必要がない。
  const hasLeft = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasLeft.current) {
        hasLeft.current = false;
        latest.current();
      }
      return () => {
        hasLeft.current = true;
      };
    }, []),
  );
}
