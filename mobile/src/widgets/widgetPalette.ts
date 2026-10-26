import { colors } from '@/lib/theme';

// ホーム画面のウィジェットの配色（docs/widgets.md §2.6）。ライト（既定）とダークを、設定で切り替える。
// アプリの画面はライトだけだが、ウィジェットはホーム画面の壁紙の上に置くので、ダークも選べるようにした（2026-10-26）。
// ライトはアプリの配色（src/lib/theme.ts）そのまま。ダークは同じ役割の色を暗い地に置き換えたもの。
// このファイルはウィジェットの部品（react-native-android-widget）を読み込まないので、設定画面からも使える。

export type WidgetThemeMode = 'light' | 'dark';

export const WIDGET_THEME_MODES: WidgetThemeMode[] = ['light', 'dark'];

export const DEFAULT_WIDGET_THEME_MODE: WidgetThemeMode = 'light';

export interface WidgetPalette {
  /** まとまりごとの地と枠（タブ・育児・家計）。 */
  tones: Record<'tabs' | 'care' | 'money', { surface: string; border: string }>;
  /** 育児・家計の地の上に置くボタンの四角。 */
  tile: string;
  /** タブのアイコンと名前（四角を持たない）。 */
  tabs: { icon: string };
  care: {
    /** 記録の種類ごとのアイコンの色。 */
    milk: string;
    diaper: string;
    temperature: string;
    /** ボタンの名前。 */
    label: string;
    /** 次の目安の文字と更新のアイコン。 */
    text: string;
  };
  money: { icon: string; label: string };
}

const LIGHT: WidgetPalette = {
  tones: {
    tabs: { surface: colors.surface, border: colors.border },
    // 白いボタンが浮いて見え、隣の段と見分けがつく濃さ（100番台）にする。
    care: { surface: colors.milkBadge, border: colors.milkBorder },
    money: { surface: colors.moneySoft, border: colors.diaperBorder },
  },
  tile: colors.surface,
  tabs: { icon: colors.textSubtle },
  care: {
    milk: colors.milk,
    diaper: colors.diaper,
    temperature: colors.temperature,
    label: colors.textSubtle,
    text: colors.milkText,
  },
  money: { icon: colors.money, label: colors.moneyText },
};

// ダークは、ライトの「淡い地に濃い文字」を「濃い地（950番台）に淡い文字（300〜400番台）」へ置き換える。
// 育児（琥珀）と家計（青）の地の見分けと、四角のボタンが地より明るく浮く関係はライトと同じ。
const DARK: WidgetPalette = {
  tones: {
    tabs: { surface: '#111827', border: '#374151' }, // gray-900 / gray-700
    care: { surface: '#451a03', border: '#78350f' }, // amber-950 / amber-900
    money: { surface: '#172554', border: '#1e3a8a' }, // blue-950 / blue-900
  },
  tile: '#1f2937', // gray-800
  tabs: { icon: '#d1d5db' }, // gray-300
  care: {
    milk: '#fbbf24', // amber-400
    diaper: '#60a5fa', // blue-400
    temperature: '#fb923c', // orange-400
    label: '#d1d5db', // gray-300
    text: '#fcd34d', // amber-300
  },
  money: { icon: '#60a5fa', label: '#93c5fd' }, // blue-400 / blue-300
};

export const widgetPalette = (mode: WidgetThemeMode): WidgetPalette => (mode === 'dark' ? DARK : LIGHT);
