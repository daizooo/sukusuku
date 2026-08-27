'use client';

import { useState } from 'react';
import type { FeedingMethod, PumpedBatch, PumpingLog } from '@/types/app';
import { pumpedStockMl } from '@/lib/careLogUtils';
import { parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  DateTimeField,
  DeleteButton,
  FEEDING_ENTRY_MODE_OPTIONS,
  FEEDING_METHOD_OPTIONS,
  FieldLabel,
  HintBanner,
  LogModalShell,
  NoteField,
  Segmented,
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
  /**
   * 授乳の入力画面へ戻る（新規追加のときだけ出す）。「飲ませた」に切り替えたときと、
   * 種類を母乳・ミルクに変えたときに呼ぶ。戻った先で選んでおく種類を渡す。
   */
  onSwitchToFeeding: (method: FeedingMethod) => void;
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
 * 搾乳してためた母乳の記録。1件が搾乳ストックの1パック（母乳パック1つぶん）にあたる。
 *
 * 搾れる量は毎回まちまちで、決まった刻みのボタンでは当てはまらないため、
 * 量は数値の直接入力だけにしている。飲ませるときは授乳の記録で「搾乳」を選び、
 * ここでためたパックの中から使うものを選ぶ（入力画面は「飲ませた／搾った」で行き来する）。
 */
function PumpingLogModalBody({
  log,
  baseDate,
  pumpedBatches,
  onSwitchToFeeding,
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
    <LogModalShell
      title={log ? '搾乳の記録を編集' : '搾乳を記録'}
      onClose={onClose}
      // 授乳の入力画面で「搾乳」を選んだときと同じ並び・同じ位置に出す。行き来しても
      // 切り替えが動かないので、そのまま下の欄に入力できる。
      subheader={
        !log && (
          <div className="space-y-3">
            <div>
              <FieldLabel>種類</FieldLabel>
              <Segmented
                options={FEEDING_METHOD_OPTIONS}
                value="pumped"
                onChange={(next) => {
                  // 母乳・ミルクは飲ませた分の記録なので、その種類で授乳の入力画面へ戻る。
                  if (next !== 'pumped') onSwitchToFeeding(next);
                }}
              />
            </div>
            <div>
              <FieldLabel>搾乳を</FieldLabel>
              <Segmented
                options={FEEDING_ENTRY_MODE_OPTIONS}
                value="pump"
                onChange={(next) => {
                  if (next === 'feed') onSwitchToFeeding('pumped');
                }}
              />
            </div>
          </div>
        )
      }
      footer={
        <>
          <SubmitButton accent="pumping" onClick={handleSubmit} disabled={amountMl === null}>
            保存する
          </SubmitButton>
          {log && <DeleteButton onDelete={onDelete} />}
        </>
      }
    >
      <HintBanner accent="pumping">
        {isUsed ? (
          <>この搾乳は授乳の記録ですでに飲ませた分です。量を直すと、その記録の量とずれます。</>
        ) : (
          <>
            搾乳ストックの残りは<span className="font-bold">{pumpedStockMl(pumpedBatches)}ml</span>
            。飲ませるときは上の「飲ませた」に切り替えて、ここで記録した分から選びます。
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
    </LogModalShell>
  );
}
