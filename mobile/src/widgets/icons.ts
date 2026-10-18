// ホーム画面のウィジェットに出すアイコン（docs/widgets.md）。
//
// ウィジェットは画面とは別の描き方（react-native-android-widget の SvgWidget）なので、
// lucide-react-native の部品をそのまま使えない。画面と同じ形に見えるよう、
// lucide（とアプリ自前の哺乳瓶・円の硬貨）と同じ線（24×24・線幅2）を SVG の文字列で持つ。

export type WidgetIconName =
  | 'schedule'
  | 'list'
  | 'care'
  | 'money'
  | 'milk'
  | 'diaper'
  | 'temperature'
  | 'expense'
  | 'income'
  | 'transfer'
  | 'receipt'
  | 'refresh';

const SHAPES: Record<WidgetIconName, string> = {
  // lucide: CalendarDays（予定タブ）
  schedule:
    '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>' +
    '<path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  // lucide: ListTodo（リストタブ）
  list: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><rect x="3" y="4" width="6" height="6" rx="1"/>',
  // lucide: Baby（育児タブ）
  care:
    '<path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M15 12h.01"/><path d="M9 12h.01"/>' +
    '<path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
  // 円の硬貨（家計タブ。src/components/ui/YenCoinIcon.tsx）
  money: '<circle cx="12" cy="12" r="10"/><path d="m8.5 7 3.5 5.5L15.5 7M12 12.5V18M8.5 13.5h7M8.5 16h7"/>',
  // 哺乳瓶（授乳。src/components/ui/BabyBottleIcon.tsx）
  milk:
    '<g transform="rotate(-20 12 12)"><path d="M10.2 8V4.8a1.8 1.8 0 0 1 3.6 0V8"/>' +
    '<path d="M7 8h10v11a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z"/><path d="M7 12.5h10"/></g>',
  // lucide: Droplet（おむつ。育児タブの一覧と同じ）
  diaper:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  // lucide: Thermometer（体温）
  temperature: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  // lucide: CircleMinus / CirclePlus / ArrowLeftRight / Camera（家計の入力）
  expense: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  income: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  transfer: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  receipt:
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/>' +
    '<circle cx="12" cy="13" r="3"/>',
  // lucide: RotateCw（育児の次の目安の更新）
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
};

/** そのアイコンの SVG。色は線の色。 */
export const widgetIcon = (name: WidgetIconName, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SHAPES[name]}</svg>`;
