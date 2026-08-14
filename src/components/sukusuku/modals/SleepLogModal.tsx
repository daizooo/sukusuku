'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { SleepLog } from '@/types/app';
import { formatStopwatch } from '@/lib/careLogUtils';
import { isSleepNotificationSupported, sleepNotificationPermission } from '@/lib/sleepNotification';
import { parseTimeInput, toTimeInputValue } from '@/lib/dateUtils';
import { FieldLabel, HintBanner, LogModalShell, NoteField, TimeField } from './logModalParts';

export interface ManualSleepInput {
  startedAt: Date;
  endedAt: Date;
  note: string;
}

interface SleepLogModalProps {
  /** 計測中の睡眠。なければ null。 */
  activeSleep: SleepLog | null;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onSubmitManual: (input: ManualSleepInput) => void;
}

/** 開くたびに入力内容を初期状態へ戻したいので、閉じている間は中身ごと外す。 */
export default function SleepLogModal({ show, ...props }: SleepLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <SleepLogModalBody {...props} />;
}

function SleepLogModalBody({ activeSleep, onClose, onStart, onEnd, onSubmitManual }: SleepLogModalProps) {
  const [startTime, setStartTime] = useState(() => toTimeInputValue(new Date()));
  const [endTime, setEndTime] = useState(() => toTimeInputValue(new Date()));
  const [note, setNote] = useState('');
  const [elapsed, setElapsed] = useState(() =>
    activeSleep ? Date.now() - activeSleep.startedAt.getTime() : 0,
  );

  // 通知に未対応・すでに許可/拒否済みの場合は案内を出さない。
  const showNotificationHint =
    isSleepNotificationSupported() && sleepNotificationPermission() === 'default';

  // 計測中は経過時間を毎秒更新する。
  useEffect(() => {
    if (!activeSleep) return;
    const timer = setInterval(() => setElapsed(Date.now() - activeSleep.startedAt.getTime()), 1000);
    return () => clearInterval(timer);
  }, [activeSleep]);

  const handleManualSubmit = () => {
    const startedAt = parseTimeInput(startTime);
    let endedAt = parseTimeInput(endTime);
    // 22:00 → 06:00 のように日をまたぐ場合は翌日として扱う。
    if (endedAt.getTime() < startedAt.getTime()) {
      endedAt = new Date(endedAt.getTime() + 24 * 60 * 60 * 1000);
    }
    onSubmitManual({ startedAt, endedAt, note });
  };

  return (
    <LogModalShell title="睡眠を記録" onClose={onClose}>
      {activeSleep ? (
        <>
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 text-center">
            <p className="text-xs font-bold text-indigo-700 flex items-center justify-center mb-1">
              <Moon size={13} className="mr-1" />
              {toTimeInputValue(activeSleep.startedAt)} から計測中
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
            起きた
          </button>
          <p className="text-[10px] text-gray-400 text-center">
            この画面を閉じても計測は続きます。記録タブ上部のバーからも終了できます。
          </p>
        </>
      ) : (
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

          <div className="pt-1 border-t border-gray-100">
            <FieldLabel>あとから記録する</FieldLabel>
            <div className="grid grid-cols-2 gap-3">
              <TimeField label="寝た時刻" value={startTime} onChange={setStartTime} />
              <TimeField label="起きた時刻" value={endTime} onChange={setEndTime} />
            </div>
          </div>
          <NoteField value={note} onChange={setNote} placeholder="お昼寝 / 寝つきが悪かった など" />
          <button
            type="button"
            onClick={handleManualSubmit}
            className="w-full bg-white border border-gray-300 text-gray-600 font-bold py-3 rounded-xl transition hover:bg-gray-50 active:scale-[0.99]"
          >
            時刻を指定して保存
          </button>
        </>
      )}
    </LogModalShell>
  );
}
