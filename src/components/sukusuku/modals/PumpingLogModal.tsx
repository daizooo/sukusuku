'use client';

import { useState } from 'react';
import type { PumpedBatch, PumpingLog } from '@/types/app';
import { pumpedStockMl } from '@/lib/careLogUtils';
import { parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  DateTimeField,
  DeleteButton,
  FieldLabel,
  HintBanner,
  LogModalShell,
  NoteField,
  SubmitButton,
} from './logModalParts';

export interface PumpingLogInput {
  amountMl: number;
  time: Date;
  note: string;
}

interface PumpingLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: PumpingLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 搾乳ストックの全量（使用済みも含む）。残りの表示に使う。 */
  pumpedBatches: PumpedBatch[];
  onClose: () => void;
  onSubmit: (input: PumpingLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function PumpingLogModal({ show, ...props }: PumpingLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <PumpingLogModalBody {...props} />;
}

/**
 * 搾乳してためた母乳の記録。1件が搾乳ストックの1本（哺乳瓶1本ぶん）にあたる。
 *
 * 搾れる量は毎回まちまちで、決まった刻みのボタンでは当てはまらないため、
 * 量は数値の直接入力だけにしている。飲ませるときは授乳・ミルクの記録で
 * 「搾乳」を選び、ここでためた本の中から使うものを選ぶ。
 */
function PumpingLogModalBody({
  log,
  baseDate,
  pumpedBatches,
  onClose,
  onSubmit,
  onDelete,
}: PumpingLogModalProps) {
  // 読めない値を入れている途中でも入力欄は書き換えられるよう、入力は文字列のまま持つ。
  const [amount, setAmount] = useState(() => (log ? String(log.amountMl) : ''));
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => toTimeInputValue(log?.time ?? new Date()));
  const [note, setNote] = useState(log?.note ?? '');

  // すでに授乳の記録で使われている搾乳は、量を直すとその記録の量とずれる。
  const isUsed = pumpedBatches.some((batch) => batch.id === log?.id && batch.usedBy !== null);

  const parsed = Number(amount);
  const amountMl = amount !== '' && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;

  const handleSubmit = () => {
    if (amountMl === null) return;
    onSubmit({
      amountMl,
      time: parseDateTimeInput(date, time, log?.time ?? baseDate),
      note,
    });
  };

  return (
    <LogModalShell title={log ? '搾乳の記録を編集' : '搾乳を記録'} onClose={onClose}>
      <HintBanner accent="pumping">
        {isUsed ? (
          <>この搾乳は授乳の記録ですでに飲ませた分です。量を直すと、その記録の量とずれます。</>
        ) : (
          <>
            搾乳ストックの残りは<span className="font-bold">{pumpedStockMl(pumpedBatches)}ml</span>
            。飲ませるときは授乳・ミルクの記録で「搾乳」を選び、ここで記録した分から選びます。
          </>
        )}
      </HintBanner>

      <label className="block">
        <FieldLabel>搾乳した量（ml）</FieldLabel>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 tabular-nums"
          placeholder="ml を直接入力"
        />
      </label>

      <DateTimeField
        label="日時"
        date={date}
        time={time}
        onChangeDate={setDate}
        onChangeTime={setTime}
      />
      <NoteField value={note} onChange={setNote} placeholder="よく出た / 冷凍した など" />
      <SubmitButton accent="pumping" onClick={handleSubmit} disabled={amountMl === null}>
        保存する
      </SubmitButton>
      {log && <DeleteButton onDelete={onDelete} />}
    </LogModalShell>
  );
}
