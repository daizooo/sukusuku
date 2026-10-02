// 繰り返し設定（Recurrence）まわりのユーティリティ。
// 型定義自体は @/types/app に置き、ここには選択肢と表示用の変換だけを持つ。
// 選択肢の出し方はGoogleカレンダーと同じ（開始日から決まる「毎週 金曜日」などの
// 定番の選択肢 ＋ 「カスタム…」）。
//
// スコープの注意: ここにあるのは「ルールの入力・表示」の補助だけで、
// ルールから実際の日付一覧を計算する処理（繰り返しの展開）は持たない。

import type { Recurrence, RecurrenceEnd, RecurrenceFreq } from '@/types/app';
import { WEEKDAY_LABELS, formatDateString, parseDateString } from '@/lib/dateUtils';

export const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: 'daily', label: '日ごと' },
  { value: 'weekly', label: '週間ごと' },
  { value: 'monthly', label: 'か月ごと' },
  { value: 'yearly', label: '年ごと' },
];

export type EndType = RecurrenceEnd['type'];

export const END_TYPE_OPTIONS: { value: EndType; label: string }[] = [
  { value: 'never', label: 'なし' },
  { value: 'until', label: '終了日' },
  { value: 'count', label: '繰り返し' },
];

// 月〜金（平日）
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

type NthWeekday = NonNullable<Recurrence['byNthWeekday']>;

const nthLabel = (nth: number): string => (nth === -1 ? '最終' : `第${nth}`);

const daysInMonth = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

// その日が月の第何週の何曜日か。第5週は「最終」(-1)として数える（Googleカレンダーと同じ）。
const nthWeekdayOf = (date: Date): NthWeekday => {
  const nth = Math.ceil(date.getDate() / 7);
  return { nth: nth >= 5 ? -1 : nth, weekday: date.getDay() };
};

// 第4週でも、その曜日が月内にもう来ないなら「最終」とも数えられる。
const isLastWeekdayOfMonth = (date: Date): boolean => date.getDate() + 7 > daysInMonth(date);

const nthWeekdayText = ({ nth, weekday }: NthWeekday): string =>
  `${nthLabel(nth)}${WEEKDAY_LABELS[weekday]}曜日`;

// --- 「繰り返し」欄の選択肢（Googleカレンダーの定番の選択肢） ---

export type RecurrencePresetKey = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays';

export interface RecurrencePreset {
  key: RecurrencePresetKey;
  label: string;
  recurrence: Recurrence | null;
}

// 開始日から決まる定番の選択肢。「毎週 金曜日」「毎月 第1金曜日」「毎年 10月2日」は
// 開始日の曜日・日付で中身が変わる。
export const recurrencePresets = (date: Date): RecurrencePreset[] => {
  const never: RecurrenceEnd = { type: 'never' };
  return [
    { key: 'none', label: '繰り返さない', recurrence: null },
    { key: 'daily', label: '毎日', recurrence: { freq: 'daily', interval: 1, end: never } },
    {
      key: 'weekly',
      label: `毎週 ${WEEKDAY_LABELS[date.getDay()]}曜日`,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [date.getDay()], end: never },
    },
    {
      key: 'monthly',
      label: `毎月 ${nthWeekdayText(nthWeekdayOf(date))}`,
      recurrence: { freq: 'monthly', interval: 1, byNthWeekday: nthWeekdayOf(date), end: never },
    },
    {
      key: 'yearly',
      label: `毎年 ${date.getMonth() + 1}月${date.getDate()}日`,
      recurrence: { freq: 'yearly', interval: 1, end: never },
    },
    {
      key: 'weekdays',
      label: '毎週平日（月〜金）',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: WEEKDAYS_MON_FRI, end: never },
    },
  ];
};

const sortedWeekdays = (byWeekday: number[] | undefined): string =>
  [...(byWeekday ?? [])].sort((a, b) => a - b).join(',');

const sameRule = (a: Recurrence, b: Recurrence): boolean =>
  a.freq === b.freq &&
  a.interval === b.interval &&
  a.end.type === b.end.type &&
  sortedWeekdays(a.byWeekday) === sortedWeekdays(b.byWeekday) &&
  a.byNthWeekday?.nth === b.byNthWeekday?.nth &&
  a.byNthWeekday?.weekday === b.byNthWeekday?.weekday;

// いまの設定が、定番の選択肢のどれに当たるか（当たらなければ null ＝ カスタム）。
export const findPresetKey = (
  recurrence: Recurrence | null,
  date: Date,
): RecurrencePresetKey | null => {
  const preset = recurrencePresets(date).find((p) =>
    p.recurrence === null || recurrence === null
      ? p.recurrence === recurrence
      : sameRule(p.recurrence, recurrence),
  );
  return preset?.key ?? null;
};

// --- カスタムの繰り返し ---

// 新規に「カスタム…」を開いたときの初期値。Googleカレンダーと同じく、
// 開始日の曜日を選んだ「1週間ごと」から始める。
export const defaultRecurrence = (startDate: string | null): Recurrence => {
  const parsed = startDate ? parseDateString(startDate) : null;
  return {
    freq: 'weekly',
    interval: 1,
    byWeekday: parsed ? [parsed.getDay()] : [],
    end: { type: 'never' },
  };
};

// 毎月の数え方の選択肢（「毎月 2日」「毎月 第1金曜日」「毎月 最終金曜日」）。
// value は 'day'（その日）か 'nth:1' 〜 'nth:4'・'nth:-1'（第n・最終）。
export interface MonthlyOption {
  value: string;
  label: string;
}

export const monthlyOptions = (date: Date): MonthlyOption[] => {
  const base = nthWeekdayOf(date);
  const options: MonthlyOption[] = [
    { value: 'day', label: `毎月 ${date.getDate()}日` },
    { value: `nth:${base.nth}`, label: `毎月 ${nthWeekdayText(base)}` },
  ];
  if (base.nth !== -1 && isLastWeekdayOfMonth(date)) {
    options.push({
      value: 'nth:-1',
      label: `毎月 ${nthWeekdayText({ nth: -1, weekday: date.getDay() })}`,
    });
  }
  return options;
};

export const monthlyValueOf = (recurrence: Recurrence): string =>
  recurrence.byNthWeekday ? `nth:${recurrence.byNthWeekday.nth}` : 'day';

export const withMonthlyValue = (recurrence: Recurrence, value: string, date: Date): Recurrence => {
  if (value === 'day') return { ...recurrence, byNthWeekday: undefined };
  return {
    ...recurrence,
    byNthWeekday: { nth: Number(value.slice('nth:'.length)), weekday: date.getDay() },
  };
};

// 単位を切り替えたときの中身の整え方。単位ごとに持つ項目が違う
// （曜日は「週間ごと」だけ、第n曜日は「か月ごと」だけ）。
export const withFreq = (recurrence: Recurrence, freq: RecurrenceFreq, date: Date | null): Recurrence => {
  const byWeekday =
    freq === 'weekly'
      ? recurrence.byWeekday && recurrence.byWeekday.length > 0
        ? recurrence.byWeekday
        : date
          ? [date.getDay()]
          : []
      : undefined;
  return {
    ...recurrence,
    freq,
    byWeekday,
    byNthWeekday: freq === 'monthly' ? recurrence.byNthWeekday : undefined,
  };
};

// 保存前の整え。間隔・回数は1以上の整数に、曜日は並べ替えて重複を除く。
// 「週間ごと」で曜日が1つも選ばれていなければ開始日の曜日にする（Googleカレンダーと同じ）。
export const normalizeRecurrence = (recurrence: Recurrence, date: Date | null): Recurrence => {
  const interval = Math.max(1, Math.floor(recurrence.interval) || 1);
  const weekdays = [...new Set(recurrence.byWeekday ?? [])].sort((a, b) => a - b);
  const end: RecurrenceEnd =
    recurrence.end.type === 'count'
      ? { type: 'count', count: Math.max(1, Math.floor(recurrence.end.count) || 1) }
      : recurrence.end;
  const result: Recurrence = { freq: recurrence.freq, interval, end };
  if (recurrence.freq === 'weekly') {
    result.byWeekday = weekdays.length > 0 ? weekdays : date ? [date.getDay()] : [];
  }
  if (recurrence.freq === 'monthly' && recurrence.byNthWeekday) {
    result.byNthWeekday = recurrence.byNthWeekday;
  }
  return result;
};

// --- 表示 ---

const joinWeekdays = (byWeekday: number[] | undefined): string =>
  [...(byWeekday ?? [])]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day])
    .join('・');

const summarizeEnd = (end: RecurrenceEnd): string => {
  switch (end.type) {
    case 'never':
      return '';
    case 'until': {
      const date = parseDateString(end.date);
      return date ? `、${formatDateString(date)}まで` : '';
    }
    case 'count':
      return `、${end.count}回`;
  }
};

// 「繰り返し」欄や詳細に出す1行の要約（例:「毎週 金曜日」「毎月 第1金曜日」
// 「2週間ごと 月・水曜日、2027年1月1日まで」）。startDate があれば毎月・毎年の日付も出す。
export const summarizeRecurrence = (
  recurrence: Recurrence | null,
  startDate?: string | null,
): string => {
  if (!recurrence) return '繰り返さない';

  const { freq, interval, byWeekday, byNthWeekday, end } = recurrence;
  const date = startDate ? parseDateString(startDate) : null;
  const unit = FREQ_OPTIONS.find((o) => o.value === freq)?.label ?? '';

  let head: string;
  switch (freq) {
    case 'daily':
      head = interval === 1 ? '毎日' : `${interval}日ごと`;
      break;
    case 'weekly': {
      const days = [...(byWeekday ?? [])].sort((a, b) => a - b);
      if (interval === 1 && days.join(',') === WEEKDAYS_MON_FRI.join(',')) {
        head = '毎週平日（月〜金）';
      } else {
        const lead = interval === 1 ? '毎週' : `${interval}${unit}`;
        head = days.length > 0 ? `${lead} ${joinWeekdays(days)}曜日` : lead;
      }
      break;
    }
    case 'monthly': {
      const lead = interval === 1 ? '毎月' : `${interval}${unit}`;
      if (byNthWeekday) head = `${lead} ${nthWeekdayText(byNthWeekday)}`;
      else head = date ? `${lead} ${date.getDate()}日` : lead;
      break;
    }
    case 'yearly': {
      const lead = interval === 1 ? '毎年' : `${interval}${unit}`;
      head = date ? `${lead} ${date.getMonth() + 1}月${date.getDate()}日` : lead;
      break;
    }
  }

  return `${head}${summarizeEnd(end)}`;
};
