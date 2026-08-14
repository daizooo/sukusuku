'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DiaperKind, PoopColor, PoopConsistency } from '@/types/app';
import {
  ATTENTION_POOP_COLORS,
  DIAPER_KIND_OPTIONS,
  NORMAL_POOP_COLORS,
  POOP_CONSISTENCY_OPTIONS,
  needsMedicalAttention,
  type PoopColorOption,
} from '@/lib/careLogUtils';
import { parseTimeInput, toTimeInputValue } from '@/lib/dateUtils';
import {
  FieldLabel,
  LogModalShell,
  NoteField,
  OptionGrid,
  Segmented,
  SubmitButton,
  TimeField,
} from './logModalParts';

export interface DiaperLogInput {
  kind: DiaperKind;
  poopColor?: PoopColor;
  poopConsistency?: PoopConsistency;
  time: Date;
  note: string;
}

interface DiaperLogModalProps {
  onClose: () => void;
  onSubmit: (input: DiaperLogInput) => void;
}

const KIND_OPTIONS = DIAPER_KIND_OPTIONS.map(({ value, label }) => ({ value, label }));
const CONSISTENCY_OPTIONS = POOP_CONSISTENCY_OPTIONS;

interface ColorSwatchesProps {
  options: PoopColorOption[];
  value?: PoopColor;
  onChange: (value: PoopColor) => void;
}

/** 色名の文字だけでは迷うため、実際の色の丸と一緒に選ぶ。 */
function ColorSwatches({ options, value, onChange }: ColorSwatchesProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((option) => {
        const selected = value === option.value;
        const selectedRing = option.needsAttention ? 'border-red-500 text-red-700' : 'border-blue-500 text-blue-700';
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition ${
              selected ? `border-2 ${selectedRing}` : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span
              className="w-5 h-5 rounded-full border border-black/10"
              style={{ backgroundColor: option.swatch }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 開くたびに入力内容を初期状態へ戻したいので、閉じている間は中身ごと外す。 */
export default function DiaperLogModal({ show, ...props }: DiaperLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <DiaperLogModalBody {...props} />;
}

function DiaperLogModalBody({ onClose, onSubmit }: DiaperLogModalProps) {
  const [kind, setKind] = useState<DiaperKind>('pee');
  const [poopColor, setPoopColor] = useState<PoopColor | undefined>(undefined);
  const [poopConsistency, setPoopConsistency] = useState<PoopConsistency | undefined>('normal');
  const [time, setTime] = useState(() => toTimeInputValue(new Date()));
  const [note, setNote] = useState('');

  const hasPoop = DIAPER_KIND_OPTIONS.find((option) => option.value === kind)?.hasPoop ?? false;

  const handleSubmit = () => {
    onSubmit({
      kind,
      // おしっこだけのときは、うんちの項目を持たせない。
      poopColor: hasPoop ? poopColor : undefined,
      poopConsistency: hasPoop ? poopConsistency : undefined,
      time: parseTimeInput(time),
      note,
    });
  };

  return (
    <LogModalShell title="おむつを記録" onClose={onClose}>
      <div>
        <FieldLabel>種類</FieldLabel>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </div>

      {hasPoop && (
        <>
          <div>
            <FieldLabel>色</FieldLabel>
            <p className="text-[10px] font-bold text-gray-500 mb-1.5">よくある色</p>
            <ColorSwatches options={NORMAL_POOP_COLORS} value={poopColor} onChange={setPoopColor} />
            <p className="text-[10px] font-bold text-red-600 mt-3 mb-1.5 flex items-center">
              <AlertTriangle size={11} className="mr-1" />
              気になる色（受診の目安）
            </p>
            <ColorSwatches options={ATTENTION_POOP_COLORS} value={poopColor} onChange={setPoopColor} />
            {needsMedicalAttention(poopColor) && (
              <p className="mt-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-xs leading-relaxed">
                白・赤・黒の便は受診の目安です。可能なら<span className="font-bold">写真を撮って</span>、
                小児科でこの記録と一緒に見せてください。
              </p>
            )}
            <p className="text-[10px] text-gray-400 mt-1.5">わからないときは選ばずに保存できます。</p>
          </div>
          <div>
            <FieldLabel>状態</FieldLabel>
            <OptionGrid
              options={CONSISTENCY_OPTIONS}
              value={poopConsistency}
              onChange={setPoopConsistency}
              columns={3}
              accent="diaper"
            />
          </div>
        </>
      )}

      <TimeField label="時刻" value={time} onChange={setTime} />
      <NoteField value={note} onChange={setNote} placeholder="色が気になる など" />
      <SubmitButton accent="diaper" onClick={handleSubmit}>
        保存する
      </SubmitButton>
    </LogModalShell>
  );
}
