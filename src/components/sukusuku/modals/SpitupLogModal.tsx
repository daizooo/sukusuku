'use client';

import { useMemo, useState } from 'react';
import type { CareLog, SpitupAmount, SpitupLog } from '@/types/app';
import {
  SPITUP_AMOUNT_OPTIONS,
  SPITUP_REPEAT_COUNT,
  findMilkBefore,
  formatMinutesAfterMilk,
  getLogTitle,
  needsSpitupAttention,
} from '@/lib/careLogUtils';
import { formatTimeString, parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  AdviceBanner,
  DateTimeField,
  DeleteButton,
  FieldLabel,
  FieldNote,
  LogModalShell,
  NoteField,
  SubmitButton,
} from './logModalParts';

// 吐き戻しの記録。メモ欄にいちばん多く書かれていた中身を形にしたもの
// （docs/what-to-record.md §11-3）。
//
// 入れるのは量の3択ひとつだけ。3つのうち1つを押すことが「吐き戻しがあった」の入力を
// 兼ねているので、選ばずに保存はできない（既定値を置くと、押されないまま保存されて
// うんちのかたさ3択と同じことになる）。
//
// 直前の授乳との間隔は、こちらで数えて添える。ゲップや抱き方を変えた効きめを
// 見るときの手がかりになる。

export interface SpitupLogInput {
  amount: SpitupAmount;
  minutesAfterMilk?: number;
  time: Date;
  note: string;
}

interface SpitupLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: SpitupLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 表示中の日の記録。直前の授乳と、その日の何回目かを数えるのに使う。 */
  dayLogs: CareLog[];
  onClose: () => void;
  onSubmit: (input: SpitupLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function SpitupLogModal({ show, ...props }: SpitupLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <SpitupLogModalBody {...props} />;
}

function SpitupLogModalBody({
  log,
  baseDate,
  dayLogs,
  onClose,
  onSubmit,
  onDelete,
}: SpitupLogModalProps) {
  // 新規は選ばれていない状態から始める（押すこと自体が「吐き戻しがあった」の入力）。
  const [amount, setAmount] = useState<SpitupAmount | null>(log?.amount ?? null);
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => toTimeInputValue(log?.time ?? new Date()));
  const [note, setNote] = useState(log?.note ?? '');

  const at = useMemo(
    () => parseDateTimeInput(date, time, log?.time ?? baseDate),
    [date, time, log, baseDate],
  );

  // 時刻を動かせば結び付く授乳も変わるので、そのつど探し直す。
  const candidate = useMemo(() => findMilkBefore(dayLogs, at), [dayLogs, at]);
  const [linked, setLinked] = useState(log ? log.minutesAfterMilk !== undefined : candidate !== null);
  // 編集で、結び付いていた授乳が表示中の日に見つからないとき（日をまたいだ授乳）は、
  // 保存されている間隔をそのまま残す。
  const storedMinutes = log?.minutesAfterMilk;
  const minutesAfterMilk = linked ? (candidate?.minutesAfter ?? storedMinutes) : undefined;
  const showLink = candidate !== null || storedMinutes !== undefined;

  // この記録がその日の何回目になるか。時刻を動かせば順番も変わるので、そのつど数え直す。
  const ordinal = useMemo(
    () =>
      dayLogs.filter(
        (other) =>
          other.type === 'spitup' && other.id !== log?.id && other.time.getTime() <= at.getTime(),
      ).length + 1,
    [dayLogs, log, at],
  );

  const handleSubmit = () => {
    if (amount === null) return;
    onSubmit({ amount, minutesAfterMilk, time: at, note });
  };

  return (
    <LogModalShell title={log ? '吐き戻しの記録を編集' : '吐き戻しを記録'} onClose={onClose}>
      <div>
        <FieldLabel>どれくらい吐いたか</FieldLabel>
        <div className="space-y-2">
          {SPITUP_AMOUNT_OPTIONS.map((option) => {
            const selected = option.value === amount;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setAmount(option.value)}
                className={`w-full text-left border rounded-xl px-3.5 py-3 transition ${
                  selected
                    ? 'border-violet-600 bg-violet-50'
                    : 'border-gray-300 bg-white hover:bg-gray-50'
                }`}
              >
                <span className={`block text-[15px] font-bold ${selected ? 'text-violet-700' : 'text-gray-800'}`}>
                  {option.label}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">{option.description}</span>
              </button>
            );
          })}
        </div>
        {amount === null && <FieldNote>どれか1つを選ぶと保存できます。</FieldNote>}
      </div>

      {showLink && (
        <div>
          <FieldLabel>直前の授乳</FieldLabel>
          <label
            className={`flex items-center gap-2.5 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
              linked ? 'border-violet-600 bg-violet-50' : 'border-gray-300 bg-white'
            }`}
          >
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => setLinked(e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
            <span className={`text-[13px] ${linked ? 'font-bold text-violet-700' : 'text-gray-600'}`}>
              {candidate
                ? `${formatTimeString(candidate.log.time)} の${getLogTitle(candidate.log)}のあと（${candidate.minutesAfter}分後）`
                : `${formatMinutesAfterMilk(storedMinutes ?? 0)}として記録されています`}
            </span>
          </label>
          <FieldNote>授乳と関係なく吐いたときは、外して保存します。</FieldNote>
        </div>
      )}

      {amount !== null && <Advice amount={amount} ordinal={ordinal} />}

      <DateTimeField label="日時" date={date} time={time} onChangeDate={setDate} onChangeTime={setTime} />
      <NoteField value={note} onChange={setNote} placeholder="ゲップは出ていた / 縦抱きにしていた など" />
      <SubmitButton accent="spitup" onClick={handleSubmit} disabled={amount === null}>
        保存する
      </SubmitButton>
      {log && <DeleteButton onDelete={onDelete} />}
    </LogModalShell>
  );
}

/**
 * 吐いたその場で「様子見か、連れて行くか」まで出す。体温と同じ扱い
 * （docs/what-to-record.md §4-1・§11-3）。
 */
function Advice({ amount, ordinal }: { amount: SpitupAmount; ordinal: number }) {
  if (needsSpitupAttention(amount)) {
    return (
      <AdviceBanner accent="spitup" alert>
        勢いよく飛ぶような吐き方は、1回だけでも受診の目安です。
        小児科の連絡先は情報タブにあります。
      </AdviceBanner>
    );
  }
  if (ordinal >= SPITUP_REPEAT_COUNT) {
    return (
      <AdviceBanner accent="spitup" alert>
        この日{ordinal}回目です。おしっこの回数が減っていないか見てください。
        足りているかはそこで分かります。減っていれば受診の目安です。
      </AdviceBanner>
    );
  }
  if (amount === 'lot') {
    return (
      <AdviceBanner accent="spitup">
        飲んだあと10〜15分は縦に抱いて、ゲップを待ってから寝かせます。
        機嫌がよくて体重が増えていれば、量が多くても心配は要りません。
      </AdviceBanner>
    );
  }
  return null;
}
