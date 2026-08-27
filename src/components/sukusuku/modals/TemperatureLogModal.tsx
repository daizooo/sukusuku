'use client';

import { useState } from 'react';
import type { TemperatureLog } from '@/types/app';
import {
  CELSIUS_STEP,
  DEFAULT_CELSIUS,
  LOW_CELSIUS,
  MAX_CELSIUS,
  MIN_CELSIUS,
  URGENT_FEVER_CELSIUS,
  formatCelsius,
  isFever,
  roundCelsius,
} from '@/lib/careLogUtils';
import { formatTimeString, parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  AdviceBanner,
  DateTimeField,
  DeleteButton,
  FieldLabel,
  FieldNote,
  HintBanner,
  LogModalShell,
  NoteField,
  SubmitButton,
} from './logModalParts';

// 体温の記録（docs/what-to-record.md §4-1）。
//
// 入れるのは体温計に出た数字ひとつだけなので、入力もその1つに絞る。
// 熱があるときは何度も測ることになるため、前回の値から始められるようにしてある。

export interface TemperatureLogInput {
  celsius: number;
  time: Date;
  note: string;
}

interface TemperatureLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: TemperatureLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 表示中の日でいちばん新しい体温。新規追加のときの初期値と、比べる相手に使う。 */
  previous: TemperatureLog | null;
  onClose: () => void;
  onSubmit: (input: TemperatureLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function TemperatureLogModal({
  show,
  ...props
}: TemperatureLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <TemperatureLogModalBody {...props} />;
}

function TemperatureLogModalBody({
  log,
  baseDate,
  previous,
  onClose,
  onSubmit,
  onDelete,
}: TemperatureLogModalProps) {
  // 値は入力欄の文字列だけで持つ（ボタンでの上げ下げもこの文字列を書き換える）。
  // 数値と文字列を別々に持つと、打ちかけの「37.」のような状態でずれるため。
  const [input, setInput] = useState(() =>
    (log?.celsius ?? previous?.celsius ?? DEFAULT_CELSIUS).toFixed(1),
  );
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => toTimeInputValue(log?.time ?? new Date()));
  const [note, setNote] = useState(log?.note ?? '');

  const parsed = Number(input);
  const celsius = input !== '' && Number.isFinite(parsed) ? roundCelsius(parsed) : null;
  const outOfRange = celsius !== null && (celsius < MIN_CELSIUS || celsius > MAX_CELSIUS);
  // 保存できない理由は、押せないボタンの代わりに欄の下へ出す。
  const problem =
    celsius === null
      ? '数字で入れてください（例: 37.2）。'
      : outOfRange
        ? `${MIN_CELSIUS.toFixed(1)}〜${MAX_CELSIUS.toFixed(1)}℃ の間で入れてください。`
        : null;

  // 上げ下げは、読めない値を入れている途中なら初期値から始める。
  const step = (diff: number) => {
    const from = celsius ?? previous?.celsius ?? DEFAULT_CELSIUS;
    const next = Math.min(MAX_CELSIUS, Math.max(MIN_CELSIUS, roundCelsius(from + diff)));
    setInput(next.toFixed(1));
  };

  const handleSubmit = () => {
    if (celsius === null || problem !== null) return;
    onSubmit({ celsius, time: parseDateTimeInput(date, time, log?.time ?? baseDate), note });
  };

  const stepButtonClass =
    'w-16 shrink-0 rounded-xl border border-orange-200 bg-orange-50 text-2xl font-bold text-orange-700 transition hover:bg-orange-100 active:scale-95';

  return (
    <LogModalShell title={log ? '体温の記録を編集' : '体温を記録'} onClose={onClose}>
      {!log && previous && (
        <HintBanner accent="temperature">
          前回は {formatCelsius(previous.celsius)}（{formatTimeString(previous.time)}）。
          その値から始めています。
        </HintBanner>
      )}

      <div>
        <FieldLabel>体温（℃）</FieldLabel>
        <div className="flex items-stretch gap-2">
          <button type="button" aria-label="0.1℃下げる" onClick={() => step(-CELSIUS_STEP)} className={stepButtonClass}>
            −
          </button>
          <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 border border-gray-300 rounded-xl py-2">
            <input
              type="number"
              inputMode="decimal"
              step={CELSIUS_STEP}
              aria-label="体温"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-32 text-center text-3xl font-bold text-gray-800 tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-sm text-gray-500">℃</span>
          </div>
          <button type="button" aria-label="0.1℃上げる" onClick={() => step(CELSIUS_STEP)} className={stepButtonClass}>
            ＋
          </button>
        </div>
        <FieldNote problem={problem !== null}>
          {problem ?? '体温計に出た数字をそのまま入れます。'}
        </FieldNote>
      </div>

      {celsius !== null && problem === null && <Advice celsius={celsius} />}

      <DateTimeField label="日時" date={date} time={time} onChangeDate={setDate} onChangeTime={setTime} />
      <NoteField value={note} onChange={setNote} placeholder="ぐったりしている / 厚着していた など" />
      <SubmitButton accent="temperature" onClick={handleSubmit} disabled={problem !== null}>
        保存する
      </SubmitButton>
      {log && <DeleteButton onDelete={onDelete} />}
    </LogModalShell>
  );
}

/**
 * 測ったその場で「様子見か、連れて行くか」まで出す。
 * 低月齢の発熱は、それ自体が受診の判断につながるため（docs/what-to-record.md §4-1）。
 */
function Advice({ celsius }: { celsius: number }) {
  if (celsius >= URGENT_FEVER_CELSIUS) {
    return (
      <AdviceBanner accent="temperature" alert>
        {formatCelsius(celsius)}。生後3か月未満の 38.0℃ 以上は、それだけで受診の目安です。
        小児科の連絡先は情報タブにあります。
      </AdviceBanner>
    );
  }
  if (celsius < LOW_CELSIUS) {
    return (
      <AdviceBanner accent="temperature" alert>
        {formatCelsius(celsius)}。測り方が浅かった可能性もあるので測り直して、
        それでも低ければ受診の目安です。
      </AdviceBanner>
    );
  }
  if (isFever(celsius)) {
    return (
      <AdviceBanner accent="temperature">
        {formatCelsius(celsius)}。厚着や部屋の暑さを取ってから、30分ほどあけてもう一度測ります。
      </AdviceBanner>
    );
  }
  return null;
}
