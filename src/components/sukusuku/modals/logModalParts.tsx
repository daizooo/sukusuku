'use client';

// 育児記録の入力モーダルで共通して使う部品。
// 記録の種類ごとにモーダルは分かれるが、枠・選択ボタン・時刻欄の見た目は揃える。

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export type LogAccent = 'milk' | 'diaper' | 'sleep';

const ACCENT_SELECTED: Record<LogAccent, string> = {
  milk: 'bg-amber-600 border-amber-600 text-white',
  diaper: 'bg-blue-600 border-blue-600 text-white',
  sleep: 'bg-indigo-600 border-indigo-600 text-white',
};

const ACCENT_BUTTON: Record<LogAccent, string> = {
  milk: 'bg-amber-600 hover:bg-amber-700',
  diaper: 'bg-blue-600 hover:bg-blue-700',
  sleep: 'bg-indigo-600 hover:bg-indigo-700',
};

const ACCENT_TEXT: Record<LogAccent, string> = {
  milk: 'text-amber-700',
  diaper: 'text-blue-700',
  sleep: 'text-indigo-700',
};

interface LogModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function LogModalShell({ title, onClose, children }: LogModalShellProps) {
  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-medium text-gray-700 mb-1.5">{children}</span>;
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** 母乳/ミルク、おしっこ/うんち など、まず選ぶ切り替え。 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex bg-gray-200 p-1 rounded-lg">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 py-2 text-xs font-bold rounded-md transition ${
            value === option.value ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface OptionGridProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns: number;
  accent: LogAccent;
}

/** 量や分数のボタン。押しやすさを揃えるため、すべて同じ幅・高さのグリッドで並べる。 */
export function OptionGrid<T extends string | number>({
  options,
  value,
  onChange,
  columns,
  accent,
}: OptionGridProps<T>) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-10 rounded-lg border text-xs font-bold tabular-nums transition ${
            value === option.value
              ? ACCENT_SELECTED[accent]
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface NoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function NoteField({ value, onChange, placeholder }: NoteFieldProps) {
  return (
    <label className="block">
      <FieldLabel>メモ</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
        placeholder={placeholder}
      />
    </label>
  );
}

interface TimeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function TimeField({ label, value, onChange }: TimeFieldProps) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 tabular-nums"
      />
    </label>
  );
}

interface SubmitButtonProps {
  accent: LogAccent;
  onClick: () => void;
  children: ReactNode;
}

export function SubmitButton({ accent, onClick, children }: SubmitButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-white font-bold py-3 rounded-xl transition active:scale-[0.99] ${ACCENT_BUTTON[accent]}`}
    >
      {children}
    </button>
  );
}

export function HintBanner({ accent, children }: { accent: LogAccent; children: ReactNode }) {
  const background = accent === 'sleep' ? 'bg-indigo-50 border-indigo-200' : 'bg-amber-50 border-amber-200';
  return (
    <p className={`border rounded-xl px-3 py-2 text-xs font-medium ${background} ${ACCENT_TEXT[accent]}`}>
      {children}
    </p>
  );
}
