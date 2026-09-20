// 繰り返し設定（Recurrence）まわりのユーティリティ。
// 型定義自体は @/types/app に置き、ここには選択肢と表示用の変換だけを持つ。
//
// スコープの注意: ここにあるのは「ルールの入力・表示」の補助だけで、
// ルールから実際の日付一覧を計算する処理（繰り返しの展開）は持たない。

import type { Recurrence, RecurrenceEnd, RecurrenceFreq } from '@/types/app';
import { WEEKDAY_LABELS, formatDateWithWeekday, parseDateString } from '@/lib/dateUtils';

export const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: 'daily', label: '日ごと' },
  { value: 'weekly', label: '週間ごと' },
  { value: 'monthly', label: 'か月ごと' },
  { value: 'yearly', label: '年ごと' },
];

export const FREQ_LABEL: Record<RecurrenceFreq, string> = {
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  yearly: '毎年',
};

export type EndType = RecurrenceEnd['type'];

export const END_TYPE_OPTIONS: { value: EndType; label: string }[] = [
  { value: 'never', label: 'なし' },
  { value: 'until', label: '終了日' },
  { value: 'count', label: '繰り返し' },
];

// 新規に「繰り返す」をオンにしたときの初期値。
// 週間ごとのときは、選択中の日付の曜日をあらかじめ選んでおく
// （Googleカレンダーの「カスタムの繰り返し」と同じふるまい）。
export const defaultRecurrence = (startDate: string | null): Recurrence => {
  const parsed = startDate ? parseDateString(startDate) : null;
  return {
    freq: 'weekly',
    interval: 1,
    byWeekday: parsed ? [parsed.getDay()] : [],
    end: { type: 'never' },
  };
};

const joinWeekdays = (byWeekday: number[] | undefined): string => {
  if (!byWeekday || byWeekday.length === 0) return '';
  return [...byWeekday]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day])
    .join('・');
};

const summarizeEnd = (end: RecurrenceEnd): string => {
  switch (end.type) {
    case 'never':
      return '';
    case 'until': {
      const date = parseDateString(end.date);
      return date ? `、${formatDateWithWeekday(date)}まで` : '';
    }
    case 'count':
      return `、${end.count}回で終了`;
  }
};

// 詳細画面などに出す1行の要約（例:「毎週 日・水 繰り返し」「毎月1か月ごと、2026年12月20日まで」）。
export const summarizeRecurrence = (recurrence: Recurrence | null): string => {
  if (!recurrence) return '繰り返さない';

  const { freq, interval, byWeekday, end } = recurrence;
  const unit = FREQ_OPTIONS.find((o) => o.value === freq)?.label ?? '';

  let head: string;
  if (freq === 'weekly' && byWeekday && byWeekday.length > 0) {
    head = interval === 1 ? `毎週 ${joinWeekdays(byWeekday)}` : `${interval}週間ごと ${joinWeekdays(byWeekday)}`;
  } else {
    head = interval === 1 ? FREQ_LABEL[freq] : `${interval}${unit}`;
  }

  return `${head}繰り返し${summarizeEnd(end)}`;
};
