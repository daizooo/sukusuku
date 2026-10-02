'use client';

import { useState } from 'react';
import type { Recurrence, RecurrenceFreq } from '@/types/app';
import { useBackLayer } from '@/lib/browserHistory';
import { WEEKDAY_LABELS, parseDateString, toDateString } from '@/lib/dateUtils';
import {
  END_TYPE_OPTIONS,
  FREQ_OPTIONS,
  type EndType,
  monthlyOptions,
  monthlyValueOf,
  normalizeRecurrence,
  withFreq,
  withMonthlyValue,
} from '@/lib/recurrence';

// 「カスタムの繰り返し」。Googleカレンダーの同名の画面と同じ並び:
// 繰り返す間隔（数＋単位）→ 曜日（週間ごと）／毎月の数え方（か月ごと）→ 終了日（なし／終了日／回数）。
// 開いている間の入力は手元の下書きで持ち、「完了」で初めて予定へ反映する
// （「キャンセル」なら何も変えない）。呼び出し側は開いているときだけこの部品を出す。
// 出す中身と並びはmobile版（mobile/src/components/schedule/RecurrenceModal.tsx）と同じ。

interface RecurrenceModalProps {
  /** いまの設定（「カスタム…」を開いた直後は defaultRecurrence の値）。 */
  initial: Recurrence;
  /** 開始日 'YYYY-MM-DD'。曜日や「毎月 2日」の既定になる。 */
  startDate: string | null;
  onCancel: () => void;
  onDone: (recurrence: Recurrence) => void;
}

// 終了日の初期値は開始日の1年後、回数の初期値は13回（Googleカレンダーと同じ）。
const DEFAULT_END_COUNT = 13;

const oneYearAfter = (date: Date): string =>
  toDateString(new Date(date.getFullYear() + 1, date.getMonth(), date.getDate()));

const NUMBER_INPUT =
  'w-16 border border-gray-300 rounded-lg p-2 text-sm text-center outline-none focus:border-blue-500 text-gray-800 bg-white disabled:bg-gray-50';
const FIELD =
  'border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white text-gray-800 disabled:bg-gray-50';

export default function RecurrenceModal({ initial, startDate, onCancel, onDone }: RecurrenceModalProps) {
  // 戻る操作（ブラウザ・スマホ）で閉じる。
  useBackLayer(onCancel);

  const start = parseDateString(startDate ?? '') ?? new Date();

  const [rule, setRule] = useState<Recurrence>(initial);
  const [intervalText, setIntervalText] = useState(String(initial.interval));
  const [endType, setEndType] = useState<EndType>(initial.end.type);
  const [endDate, setEndDate] = useState(initial.end.type === 'until' ? initial.end.date : oneYearAfter(start));
  const [countText, setCountText] = useState(
    String(initial.end.type === 'count' ? initial.end.count : DEFAULT_END_COUNT),
  );

  const toggleWeekday = (day: number) => {
    const current = rule.byWeekday ?? [];
    // 曜日が1つも無い「週間ごと」は成り立たないので、最後の1つは外せない。
    if (current.includes(day) && current.length === 1) return;
    setRule({
      ...rule,
      byWeekday: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    });
  };

  const done = () => {
    const end: Recurrence['end'] =
      endType === 'never'
        ? { type: 'never' }
        : endType === 'until'
          ? { type: 'until', date: endDate }
          : { type: 'count', count: Number(countText) };
    onDone(normalizeRecurrence({ ...rule, interval: Number(intervalText), end }, start));
  };

  return (
    <div className="absolute inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-label="カスタムの繰り返し"
        className="bg-white w-full max-w-md rounded-2xl shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex-1 overflow-y-auto px-5 pt-5 space-y-4">
          <h3 className="text-lg font-bold text-gray-900">カスタムの繰り返し</h3>

          {/* 繰り返す間隔 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">繰り返す間隔:</span>
            <input
              type="number"
              min={1}
              value={intervalText}
              onChange={(e) => setIntervalText(e.target.value)}
              aria-label="繰り返す間隔"
              className={NUMBER_INPUT}
            />
            <select
              value={rule.freq}
              onChange={(e) => setRule(withFreq(rule, e.target.value as RecurrenceFreq, start))}
              aria-label="繰り返しの単位"
              className={`flex-1 ${FIELD}`}
            >
              {FREQ_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* 曜日（週間ごと。複数選べる） */}
          {rule.freq === 'weekly' && (
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">曜日:</span>
              <div className="flex gap-1">
                {WEEKDAY_LABELS.map((label, day) => {
                  const selected = (rule.byWeekday ?? []).includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${label}曜日`}
                      onClick={() => toggleWeekday(day)}
                      className={`flex-1 aspect-square max-w-9 rounded-full text-xs font-bold transition ${
                        selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 毎月の数え方（か月ごと）。「毎月 2日」か「毎月 第1金曜日」 */}
          {rule.freq === 'monthly' && (
            <select
              value={monthlyValueOf(rule)}
              onChange={(e) => setRule(withMonthlyValue(rule, e.target.value, start))}
              aria-label="毎月の繰り返し"
              className={`w-full ${FIELD}`}
            >
              {monthlyOptions(start).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {/* 終了日。なし／終了日を指定／回数を指定。選んでいない項目の入力欄は薄くして押せなくする。 */}
          <div>
            <span className="block text-sm font-bold text-gray-900 mb-1">終了日</span>
            {END_TYPE_OPTIONS.map((option) => {
              const selected = endType === option.value;
              return (
                <div key={option.value} className="flex items-center gap-3 min-h-11">
                  <label className="flex items-center gap-2.5 text-sm text-gray-700 min-w-24">
                    <input
                      type="radio"
                      name="recurrence-end"
                      checked={selected}
                      onChange={() => setEndType(option.value)}
                    />
                    {option.label}
                    {option.value === 'never' ? '' : ':'}
                  </label>
                  {option.value === 'until' && (
                    <input
                      type="date"
                      value={endDate}
                      disabled={!selected}
                      onChange={(e) => e.target.value && setEndDate(e.target.value)}
                      aria-label="終了日"
                      className={`flex-1 ${FIELD}`}
                    />
                  )}
                  {option.value === 'count' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={countText}
                        disabled={!selected}
                        onChange={(e) => setCountText(e.target.value)}
                        aria-label="繰り返す回数"
                        className={NUMBER_INPUT}
                      />
                      <span className="text-sm text-gray-500">回</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-none flex justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-full text-sm font-bold text-blue-600 hover:bg-blue-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={done}
            className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-blue-500 hover:bg-blue-600"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
}
