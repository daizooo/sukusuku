'use client';

import { Delete } from 'lucide-react';

// 品目の金額を入れる電卓（docs/kakei.md §3.2。品目の画面で初めて出る）。＋−×÷ が使える。
// 押したキーを返すだけで、式の組み立ては moneyUtils の pressCalcKey。
// mobile版の `mobile/src/components/money/Calculator.tsx` と同じ並び。

const ROWS: { key: string; label: string; op?: boolean }[][] = [
  [{ key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '/', label: '÷', op: true }],
  [{ key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '*', label: '×', op: true }],
  [{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '-', label: '−', op: true }],
  [{ key: '00', label: '00' }, { key: '0', label: '0' }, { key: 'back', label: '' }, { key: '+', label: '+', op: true }],
];

export default function Calculator({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="shrink-0 grid grid-cols-4 gap-1.5 px-3 py-2">
      {ROWS.flat().map((entry) => (
        <button
          key={entry.key}
          type="button"
          aria-label={entry.key === 'back' ? '1文字消す' : entry.label}
          onClick={() => onKey(entry.key)}
          className={`flex h-12 items-center justify-center rounded-full active:bg-blue-50 ${
            entry.op ? 'mx-2 bg-gray-100 text-[22px] font-medium text-gray-700' : 'text-2xl font-semibold text-gray-900'
          }`}
        >
          {entry.key === 'back' ? <Delete size={24} /> : entry.label}
        </button>
      ))}
    </div>
  );
}
