'use client';

import { useState } from 'react';
import type { BreastSide, FeedingMethod } from '@/types/app';
import {
  BREAST_MINUTE_OPTIONS,
  MILK_AMOUNT_OPTIONS,
  getSideLabel,
} from '@/lib/careLogUtils';
import { parseTimeInput, toTimeInputValue } from '@/lib/dateUtils';
import {
  FieldLabel,
  HintBanner,
  LogModalShell,
  NoteField,
  OptionGrid,
  Segmented,
  SubmitButton,
  TimeField,
} from './logModalParts';

export interface MilkLogInput {
  method: FeedingMethod;
  amountMl?: number;
  leftMinutes?: number;
  rightMinutes?: number;
  lastSide?: BreastSide;
  time: Date;
  note: string;
}

interface MilkLogModalProps {
  /** 直近の授乳から割り出した「次に飲ませる側」。判断材料がなければ null。 */
  nextSide: BreastSide | null;
  onClose: () => void;
  onSubmit: (input: MilkLogInput) => void;
}

const METHOD_OPTIONS: { value: FeedingMethod; label: string }[] = [
  { value: 'breast', label: '母乳' },
  { value: 'formula', label: 'ミルク' },
];

const SIDE_OPTIONS: { value: BreastSide; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
];

const AMOUNT_OPTIONS = MILK_AMOUNT_OPTIONS.map((ml) => ({ value: ml, label: String(ml) }));
const MINUTE_OPTIONS = BREAST_MINUTE_OPTIONS.map((min) => ({ value: min, label: String(min) }));

/** 開くたびに入力内容を初期状態へ戻したいので、閉じている間は中身ごと外す。 */
export default function MilkLogModal({ show, ...props }: MilkLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <MilkLogModalBody {...props} />;
}

function MilkLogModalBody({ nextSide, onClose, onSubmit }: MilkLogModalProps) {
  const [method, setMethod] = useState<FeedingMethod>('breast');
  const [amountMl, setAmountMl] = useState<number>(100);
  const [customAmount, setCustomAmount] = useState('');
  // 未選択と「0分」を区別するため、初期値は undefined にしておく。
  const [leftMinutes, setLeftMinutes] = useState<number | undefined>(undefined);
  const [rightMinutes, setRightMinutes] = useState<number | undefined>(undefined);
  const [lastSide, setLastSide] = useState<BreastSide | undefined>(undefined);
  const [time, setTime] = useState(() => toTimeInputValue(new Date()));
  const [note, setNote] = useState('');

  const handleCustomAmount = (value: string) => {
    setCustomAmount(value);
    const parsed = Number(value);
    if (value !== '' && Number.isFinite(parsed) && parsed > 0) setAmountMl(parsed);
  };

  const handleSubmit = () => {
    const base: Pick<MilkLogInput, 'time' | 'note' | 'method'> = {
      method,
      time: parseTimeInput(time),
      note,
    };
    if (method === 'formula') {
      onSubmit({ ...base, amountMl });
      return;
    }
    const left = leftMinutes ?? 0;
    const right = rightMinutes ?? 0;
    onSubmit({
      ...base,
      leftMinutes: left,
      rightMinutes: right,
      // どちらも0分のときは「最後に飲ませた側」も残さない。
      lastSide: left === 0 && right === 0 ? undefined : lastSide,
    });
  };

  return (
    <LogModalShell title="授乳・ミルクを記録" onClose={onClose}>
      <Segmented options={METHOD_OPTIONS} value={method} onChange={setMethod} />

      {method === 'breast' ? (
        <>
          {nextSide && (
            <HintBanner accent="milk">
              前回は{getSideLabel(nextSide === 'left' ? 'right' : 'left')}で終了 → 次は
              <span className="font-bold">{getSideLabel(nextSide)}</span>からがおすすめ
            </HintBanner>
          )}
          <div>
            <FieldLabel>左（分）</FieldLabel>
            <OptionGrid
              options={MINUTE_OPTIONS}
              value={leftMinutes}
              onChange={setLeftMinutes}
              columns={7}
              accent="milk"
            />
          </div>
          <div>
            <FieldLabel>右（分）</FieldLabel>
            <OptionGrid
              options={MINUTE_OPTIONS}
              value={rightMinutes}
              onChange={setRightMinutes}
              columns={7}
              accent="milk"
            />
          </div>
          <div>
            <FieldLabel>最後に飲ませた側</FieldLabel>
            <OptionGrid
              options={SIDE_OPTIONS}
              value={lastSide}
              onChange={setLastSide}
              columns={2}
              accent="milk"
            />
            <p className="text-[10px] text-gray-400 mt-1.5">次にどちらから授乳するかの目安になります。</p>
          </div>
        </>
      ) : (
        <>
          <div>
            <FieldLabel>量（ml）</FieldLabel>
            <OptionGrid
              options={AMOUNT_OPTIONS}
              value={customAmount === '' ? amountMl : undefined}
              onChange={(value) => {
                setAmountMl(value);
                setCustomAmount('');
              }}
              columns={5}
              accent="milk"
            />
          </div>
          <label className="block">
            <FieldLabel>上記以外の量</FieldLabel>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={customAmount}
              onChange={(e) => handleCustomAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="ml を直接入力"
            />
          </label>
        </>
      )}

      <TimeField label="時刻" value={time} onChange={setTime} />
      <NoteField value={note} onChange={setNote} placeholder="よく飲んだ / 途中で寝た など" />
      <SubmitButton accent="milk" onClick={handleSubmit}>
        保存する
      </SubmitButton>
    </LogModalShell>
  );
}
