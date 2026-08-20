'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { SleepLog } from '@/types/app';
import { formatDuration, formatStopwatch } from '@/lib/careLogUtils';
import { isSleepNotificationSupported, sleepNotificationPermission } from '@/lib/sleepNotification';
import { parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  DateTimeField,
  DeleteButton,
  FieldLabel,
  HintBanner,
  LogModalShell,
  NoteField,
} from './logModalParts';

export interface ManualSleepInput {
  startedAt: Date;
  endedAt: Date;
  note: string;
}

interface SleepLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: SleepLog | null;
  /** 計測中の睡眠。なければ null。 */
  activeSleep: SleepLog | null;
  /** 新規追加時に記録する日。 */
  baseDate: Date;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onSubmitManual: (input: ManualSleepInput) => void;
  onDelete: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function SleepLogModal({ show, ...props }: SleepLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <SleepLogModalBody {...props} />;
}

function SleepLogModalBody({
  log,
  activeSleep,
  baseDate,
  onClose,
  onStart,
  onEnd,
  onSubmitManual,
  onDelete,
}: SleepLogModalProps) {
  // 計測中の睡眠を開いたときは、ストップウォッチを主にして見せる。
  const running = log ? (activeSleep?.id === log.id ? activeSleep : null) : activeSleep;

  // 入力欄の初期値。計測中なら開始時刻と「今」を入れて、そのまま直せるようにする。
  const initialStart = log?.startedAt ?? running?.startedAt ?? null;
  const initialEnd = log?.endedAt ?? null;

  const [startDate, setStartDate] = useState(() => toDateString(initialStart ?? baseDate));
  const [startTime, setStartTime] = useState(() => toTimeInputValue(initialStart ?? new Date()));
  // 計測を止め忘れた場合の起床は「今」、あとから手で入れる場合は表示中の日を初期値にする。
  const [endDate, setEndDate] = useState(() =>
    toDateString(initialEnd ?? (running ? new Date() : baseDate)),
  );
  const [endTime, setEndTime] = useState(() => toTimeInputValue(initialEnd ?? new Date()));
  const [note, setNote] = useState(log?.note ?? '');
  const [elapsed, setElapsed] = useState(() => (running ? Date.now() - running.startedAt.getTime() : 0));

  // 通知に未対応・すでに許可/拒否済みの場合は案内を出さない。
  const showNotificationHint =
    isSleepNotificationSupported() && sleepNotificationPermission() === 'default';

  // 計測中は経過時間を毎秒更新する。
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Date.now() - running.startedAt.getTime()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const startedAt = parseDateTimeInput(startDate, startTime, initialStart ?? baseDate);
  const endedAtInput = parseDateTimeInput(endDate, endTime, initialStart ?? baseDate);
  // 22:00 → 06:00 のように日付を変えずに日をまたぐ入力は、翌日として扱う。
  const endedAt =
    endDate === startDate && endedAtInput.getTime() < startedAt.getTime()
      ? new Date(endedAtInput.getTime() + DAY_MS)
      : endedAtInput;
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const isInvalidRange = durationMs < 0;

  const handleManualSubmit = () => {
    if (isInvalidRange) return;
    onSubmitManual({ startedAt, endedAt, note });
  };

  // 寝た日時・起きた日時の入力欄。計測中でも同じものを使って直せるようにする。
  const timeFields = (
    <div className="space-y-3">
      <DateTimeField
        label="寝た日時"
        date={startDate}
        time={startTime}
        onChangeDate={setStartDate}
        onChangeTime={setStartTime}
      />
      <DateTimeField
        label="起きた日時"
        date={endDate}
        time={endTime}
        onChangeDate={setEndDate}
        onChangeTime={setEndTime}
      />
      <p className={`text-[11px] font-medium ${isInvalidRange ? 'text-red-600' : 'text-gray-500'}`}>
        {isInvalidRange
          ? '起きた日時が寝た日時より前になっています。'
          : `この内容で ${formatDuration(durationMs)} として記録します。`}
      </p>
    </div>
  );

  const manualSubmitButton = (label: string, filled: boolean) => (
    <button
      type="button"
      onClick={handleManualSubmit}
      disabled={isInvalidRange}
      className={`w-full font-bold py-3 rounded-xl transition active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100 ${
        filled
          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
          : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <LogModalShell title={log || running ? '睡眠の記録を編集' : '睡眠を記録'} onClose={onClose}>
      {running ? (
        <>
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 text-center">
            <p className="text-xs font-bold text-indigo-700 flex items-center justify-center mb-1">
              <Moon size={13} className="mr-1" />
              {toTimeInputValue(running.startedAt)} から計測中
            </p>
            <p className="text-3xl font-bold text-indigo-700 tabular-nums tracking-wide">
              {formatStopwatch(elapsed)}
            </p>
          </div>
          <button
            type="button"
            onClick={onEnd}
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 rounded-xl transition active:scale-[0.99] flex items-center justify-center"
          >
            <Sun size={18} className="mr-2" />
            今すぐ「起きた」にする
          </button>
          <p className="text-[10px] text-gray-400 text-center">
            この画面を閉じても計測は続きます。記録タブ上部のバーからも終了できます。
          </p>

          {/* 止めるのを忘れたときのための逃げ道。実際の時刻を入れて計測を終わらせる。 */}
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <FieldLabel>時刻を直して終わる</FieldLabel>
            <HintBanner accent="sleep">
              計測を止めるのを忘れたときは、実際に寝た・起きた日時を入れて記録できます。
            </HintBanner>
            {timeFields}
            <NoteField value={note} onChange={setNote} placeholder="お昼寝 / 寝つきが悪かった など" />
            {manualSubmitButton('この日時で記録する', true)}
          </div>
          {log && <DeleteButton onDelete={onDelete} />}
        </>
      ) : (
        <>
          {!log && (
            <>
              <button
                type="button"
                onClick={onStart}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-5 rounded-2xl transition active:scale-[0.99] flex flex-col items-center"
              >
                <span className="text-xl font-bold flex items-center">
                  <Moon size={20} className="mr-2" />
                  ねんね開始
                </span>
                <span className="text-[11px] font-medium opacity-85 mt-1">タップした時刻から計測します</span>
              </button>
              {showNotificationHint && (
                <HintBanner accent="sleep">
                  計測中はスマホの通知欄にも表示できます。開始時に通知の許可を確認します（ねんね計測以外の通知は送りません）。
                </HintBanner>
              )}
            </>
          )}

          <div className={log ? '' : 'pt-1 border-t border-gray-100'}>
            {!log && <FieldLabel>あとから記録する</FieldLabel>}
            {timeFields}
          </div>
          <NoteField value={note} onChange={setNote} placeholder="お昼寝 / 寝つきが悪かった など" />
          {manualSubmitButton(log ? '保存する' : '日時を指定して保存', !!log)}
          {log && <DeleteButton onDelete={onDelete} />}
        </>
      )}
    </LogModalShell>
  );
}
