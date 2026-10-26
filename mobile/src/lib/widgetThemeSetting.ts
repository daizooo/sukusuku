import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_WIDGET_THEME_MODE,
  WIDGET_THEME_MODES,
  type WidgetThemeMode,
} from '@/widgets/widgetPalette';

// ホーム画面のウィジェットの配色（ライト・ダーク）の設定（docs/widgets.md §2.6）。
//
// **この端末だけの設定**で、家族では共有しない（ホーム画面は端末ごとのため）。DB には置かず端末に控える。
// ウィジェットは裏（ヘッドレスJS）で描くが、同じ端末の保存（AsyncStorage）を読めるので、
// アプリで保存した値がそのまま次の描き直しに使われる。既定はライト。

const STORAGE_KEY = 'sukusuku.widget.themeMode';

/** 控えを読む。壊れていたり無かったりしたら既定値（ライト）。 */
export async function loadWidgetThemeMode(): Promise<WidgetThemeMode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return WIDGET_THEME_MODES.find((mode) => mode === raw) ?? DEFAULT_WIDGET_THEME_MODE;
  } catch {
    return DEFAULT_WIDGET_THEME_MODE;
  }
}

export async function saveWidgetThemeMode(mode: WidgetThemeMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode);
}

/** 設定画面用。読み込み前は null。 */
export function useWidgetThemeMode(): {
  mode: WidgetThemeMode | null;
  update: (next: WidgetThemeMode) => Promise<void>;
} {
  const [mode, setMode] = useState<WidgetThemeMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWidgetThemeMode().then((loaded) => {
      if (!cancelled) setMode(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (next: WidgetThemeMode) => {
    await saveWidgetThemeMode(next);
    setMode(next);
  }, []);
  return { mode, update };
}
