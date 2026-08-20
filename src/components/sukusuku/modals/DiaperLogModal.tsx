'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DiaperKind, DiaperLog, PoopColor, PoopConsistency } from '@/types/app';
import {
  ATTENTION_POOP_COLORS,
  DIAPER_KIND_OPTIONS,
  NORMAL_POOP_COLORS,
  POOP_CONSISTENCY_OPTIONS,
  needsMedicalAttention,
  type PoopColorOption,
} from '@/lib/careLogUtils';
import { parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  DateTimeField,
  DeleteButton,
  FieldLabel,
  LogModalShell,
  NoteField,
  OptionGrid,
  Segmented,
  SubmitButton,
} from './logModalParts';

export interface DiaperLogInput {
  kind: DiaperKind;
  poopColor?: PoopColor;
  poopConsistency?: PoopConsistency;
  time: Date;
  note: string;
}

interface DiaperLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: DiaperLog | null;
  /** 新規追加時に記録する日。 */
  baseDate: Date;
  onClose: () => void;
  onSubmit: (input: DiaperLogInput) => void;
  onDelete: () => void;
}

const KIND_OPTIONS = DIAPER_KIND_OPTIONS.map(({ value, label }) => ({ value, label }));

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
            <span className="w-5 h-5 rounded-full border border-black/10" style={{ backgroundColor: option.swatch }} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function DiaperLogModal({ show, ...props }: DiaperLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <DiaperLogModalBody {...props} />;
}

function DiaperLogModalBody({ log, baseDate, onClose, onSubmit, onDelete }: DiaperLogModalProps) {
  const [kind, setKind] = useState<DiaperKind>(log?.kind ?? 'pee');
  const [poopColor, setPoopColor] = useState<PoopColor | undefined>(log?.poopColor);
  const [poopConsistency, setPoopConsistency] = useState<PoopConsistency | undefined>(
    log?.poopConsistency ?? 'normal',
  );
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => toTimeInputValue(log?.time ?? new Date()));
  const [note, setNote] = useState(log?.note ?? '');

  const hasPoop = DIAPER_KIND_OPTIONS.find((option) => option.value === kind)?.hasPoop ?? false;

  const handleSubmit = () => {
    onSubmit({
      kind,
      // おしっこだけのときは、うんちの項目を持たせない。
      poopColor: hasPoop ? poopColor : undefined,
      poopConsistency: hasPoop ? poopConsistency : undefined,
      time: parseDateTimeInput(date, time, log?.time ?? baseDate),
      note,
    });
  };

  return (
    <LogModalShell title={log ? 'おむつの記録を編集' : 'おむつを記録'} onClose={onClose}>
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
              options={POOP_CONSISTENCY_OPTIONS}
              value={poopConsistency}
              onChange={setPoopConsistency}
              columns={3}
              accent="diaper"
            />
          </div>
        </>
      )}

      <DateTimeField
        label="日時"
        date={date}
        time={time}
        onChangeDate={setDate}
        onChangeTime={setTime}
      />
      <NoteField value={note} onChange={setNote} placeholder="色が気になる など" />
      <SubmitButton accent="diaper" onClick={handleSubmit}>
        保存する
      </SubmitButton>
      {log && <DeleteButton onDelete={onDelete} />}
    </LogModalShell>
  );
}
