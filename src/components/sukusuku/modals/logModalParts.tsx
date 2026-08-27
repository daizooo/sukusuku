'use client';

// 育児記録の入力モーダルで共通して使う部品。
// 記録の種類ごとにモーダルは分かれるが、枠・選択ボタン・時刻欄の見た目は揃える。

import type { ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import type { FeedingMethod } from '@/types/app';

export type LogAccent = 'milk' | 'diaper' | 'pumping' | 'temperature';

const ACCENT_SELECTED: Record<LogAccent, string> = {
  milk: 'bg-amber-600 border-amber-600 text-white',
  diaper: 'bg-blue-600 border-blue-600 text-white',
  pumping: 'bg-rose-600 border-rose-600 text-white',
  temperature: 'bg-orange-600 border-orange-600 text-white',
};

const ACCENT_BUTTON: Record<LogAccent, string> = {
  milk: 'bg-amber-600 hover:bg-amber-700',
  diaper: 'bg-blue-600 hover:bg-blue-700',
  pumping: 'bg-rose-600 hover:bg-rose-700',
  temperature: 'bg-orange-600 hover:bg-orange-700',
};

const ACCENT_TEXT: Record<LogAccent, string> = {
  milk: 'text-amber-700',
  diaper: 'text-blue-700',
  pumping: 'text-rose-700',
  temperature: 'text-orange-700',
};

/**
 * 記録の入力モーダルの高さ。どの記録でも同じ大きさで開くよう、ここでまとめて決める。
 * 画面の高さが足りない端末では、はみ出さないよう枠のほうを縮める（中身はスクロールする）。
 */
const LOG_MODAL_HEIGHT = 'h-[640px] max-h-full';

interface LogModalShellProps {
  title: string;
  onClose: () => void;
  /** 記録の種類の切り替えなど、スクロールさせずに上に固定して出すもの。 */
  subheader?: ReactNode;
  /** 保存・削除など、下に固定して出すボタン。 */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * 記録の入力モーダルの枠。
 *
 * 高さは中身の量にかかわらず一定にする。母乳/搾乳/ミルクのように同じモーダルの中で
 * 入力項目が入れ替わるとき、枠まで伸び縮みすると画面が落ち着かず、保存ボタンの位置も
 * 毎回変わって押しづらいため。見出し・切り替え・保存ボタンは固定し、スクロールは
 * 入力欄の部分だけに閉じ込める。
 */
export function LogModalShell({ title, onClose, subheader, footer, children }: LogModalShellProps) {
  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className={`bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col ${LOG_MODAL_HEIGHT}`}
      >
        <div className="shrink-0 flex justify-between items-center border-b px-5 py-3">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
        {subheader && <div className="shrink-0 px-5 pt-4">{subheader}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="shrink-0 border-t px-5 pt-3 pb-6 sm:pb-4 space-y-1">{footer}</div>}
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-medium text-gray-700 mb-1.5">{children}</span>;
}

/** 授乳の記録で「飲ませた」と「搾った」を切り替える。両方の入力画面の一番上に出す。 */
export type FeedingEntryMode = 'feed' | 'pump';

export const FEEDING_ENTRY_MODE_OPTIONS: { value: FeedingEntryMode; label: string }[] = [
  { value: 'feed', label: '飲ませた' },
  { value: 'pump', label: '搾った' },
];

/** 授乳の記録の種類。授乳・搾乳どちらの入力画面でも同じ並びで一番上に出す。 */
export const FEEDING_METHOD_OPTIONS: { value: FeedingMethod; label: string }[] = [
  { value: 'breast', label: '母乳' },
  { value: 'pumped', label: '搾乳' },
  { value: 'formula', label: 'ミルク' },
];

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** 母乳/搾乳/ミルク、おしっこ/うんち など、まず選ぶ切り替え。 */
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

interface DateTimeFieldProps {
  label: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' */
  time: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
}

/**
 * 記録の日時。時刻だけでなく日付も直せるようにして、日をまたいだ記録や
 * 日を間違えて保存した記録をあとから正せるようにする。
 */
export function DateTimeField({ label, date, time, onChangeDate, onChangeTime }: DateTimeFieldProps) {
  const inputClass =
    'border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 tabular-nums';
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label={`${label}（日付）`}
          value={date}
          onChange={(e) => onChangeDate(e.target.value)}
          className={`flex-1 min-w-0 ${inputClass}`}
        />
        <input
          type="time"
          aria-label={`${label}（時刻）`}
          value={time}
          onChange={(e) => onChangeTime(e.target.value)}
          className={`w-28 shrink-0 ${inputClass}`}
        />
      </div>
    </div>
  );
}

interface SubmitButtonProps {
  accent: LogAccent;
  onClick: () => void;
  /** 必須の入力が埋まっていないときに押せなくする。 */
  disabled?: boolean;
  children: ReactNode;
}

export function SubmitButton({ accent, onClick, disabled, children }: SubmitButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-white font-bold py-3 rounded-xl transition active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100 ${ACCENT_BUTTON[accent]}`}
    >
      {children}
    </button>
  );
}

/** 既存の記録を編集しているときだけ出す削除ボタン。 */
export function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2 hover:text-red-600"
    >
      <Trash2 size={14} className="mr-1" /> 削除する
    </button>
  );
}

const ACCENT_BANNER: Record<LogAccent, string> = {
  milk: 'bg-amber-50 border-amber-200',
  diaper: 'bg-blue-50 border-blue-200',
  pumping: 'bg-rose-50 border-rose-200',
  temperature: 'bg-orange-50 border-orange-200',
};

export function HintBanner({ accent, children }: { accent: LogAccent; children: ReactNode }) {
  const background = ACCENT_BANNER[accent];
  return (
    <p className={`border rounded-xl px-3 py-2 text-xs font-medium ${background} ${ACCENT_TEXT[accent]}`}>
      {children}
    </p>
  );
}

/**
 * 保存する前に、その場での判断を出す枠（体温）。
 * 受診の目安にあたるときは alert にして、記録の種類の色ではなく赤で出す。
 */
export function AdviceBanner({
  accent,
  alert,
  children,
}: {
  accent: LogAccent;
  alert?: boolean;
  children: ReactNode;
}) {
  const tone = alert
    ? 'bg-red-50 border-red-300 text-red-700'
    : `${ACCENT_BANNER[accent]} ${ACCENT_TEXT[accent]}`;
  return <p className={`border rounded-xl px-3 py-2 text-xs leading-relaxed ${tone}`}>{children}</p>;
}

/** 入力欄の下に出す補足。保存できない理由は problem にして赤で出す。 */
export function FieldNote({ problem, children }: { problem?: boolean; children: ReactNode }) {
  return (
    <p className={`text-[11px] mt-1.5 ${problem ? 'text-red-500' : 'text-gray-400'}`}>{children}</p>
  );
}
