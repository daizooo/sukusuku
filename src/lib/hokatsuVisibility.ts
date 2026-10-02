import { useSyncExternalStore } from 'react';

// 保活（見学チェック）の入口を設定タブに出すかどうか。mobile版は
// `mobile/src/lib/hokatsuVisibility.ts`。
//
// 保活は見学のときだけ開く機能で、見学が済んだら要らなくなる。日常の画面に置かず
// 設定タブへ移し、要らなくなったら入口ごと隠せるようにする。端末ごとの設定で、
// 家族では共有しない。未設定のときは出す。

const KEY = 'hokatsu.visible';

const listeners = new Set<() => void>();

export function readHokatsuVisible(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeHokatsuVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(KEY, visible ? 'true' : 'false');
  } catch {
    // 保存できなくてもこの場の表示は切り替わる。次に開いたときは元に戻るだけ。
  }
}

/** 画面に出す値。サーバー側の描画では常に「出す」で、描画のあとに端末の値へ切り替わる。 */
export function useHokatsuVisible(): [boolean, (visible: boolean) => void] {
  const visible = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readHokatsuVisible,
    () => true,
  );
  const setVisible = (next: boolean) => {
    writeHokatsuVisible(next);
    listeners.forEach((listener) => listener());
  };
  return [visible, setVisible];
}
