import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

// 画面の状態（家計の面・月・年、リストの開いている1枚など）を、ブラウザの「更新」をしても今の画面のまま戻すためのフック（2026-10-16）。
// タブ（ブラウザの1つのタブ）ごとに sessionStorage へ持つので、閉じれば消える。読めない・書けないときは、ふつうの useState と同じ。
// サーバーで描いた画面と最初の描画がずれないよう、最初は initial で描き、描いたあとに前の値へ戻す。
// 戻すのは**ページを読み込んだあとの最初の1回だけ**（更新したとき）。アプリのタブを切り替えて戻ってきたときは、これまでどおり、そのタブの最初の画面から始まる。

const NAMESPACE = 'sukusuku:';

/** このページの読み込みで、もう前の値へ戻した key（タブを切り替えて作り直したときに、また戻さないため）。 */
const consumed = new Set<string>();

/** JSON にできない値（Date など）を保存するときの変換。 */
export interface SessionCodec<T> {
  encode: (value: T) => unknown;
  decode: (raw: unknown) => T;
}

/** Date を ISO の文字列で保存する。 */
export const dateCodec: SessionCodec<Date> = {
  encode: (value) => value.toISOString(),
  decode: (raw) => {
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) throw new Error('invalid date');
    return date;
  },
};

export function useSessionState<T>(key: string, initial: T, codec?: SessionCodec<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const restored = useRef(false);

  // 書く（最初の描画では、前の値を上書きしないよう、読み戻すまで書かない）。
  useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(NAMESPACE + key, JSON.stringify(codec ? codec.encode(value) : value));
    } catch {
      // 保存できない環境では、保存しないだけ。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  // 読み戻す（最初の1回だけ）。
  useEffect(() => {
    try {
      const raw = consumed.has(key) ? null : window.sessionStorage.getItem(NAMESPACE + key);
      consumed.add(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        setValue(codec ? codec.decode(parsed) : (parsed as T));
      }
    } catch {
      // 読めなければ、初期値のまま。
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue];
}
