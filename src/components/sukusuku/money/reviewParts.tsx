'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatYen } from '@/lib/moneyUtils';

// 年間予算と振り返りの部品（docs/kakei.md §0.7。2026-10-22）。mobile版の `mobile/src/components/money/reviewParts.tsx` と同じ並び・文言。
//
// - BalanceCard: いちばん上の収支。収支を大きく、その下に「収入 − 支出」。収入と支出を切り替えて、内訳の割合を帯で出す
//   （収入は緑系、支出は青系。開いたときは支出）
// - SectionCard: 変動費・予備費・固定費などの、押すと折りたためる枠。見出しの右に要点を1つ（丸い札）
// - AmountRow: 枠の中の1行（名前・額・右に残り〔超過は赤〕・細い棒）。棒は青1色、超過は赤

const INCOME_COLORS = ['#0f766e', '#34a37f', '#7cc9a6', '#c4e8d5'];
const EXPENSE_COLORS = ['#1e4fae', '#4f7fd6', '#9bb8ea', '#d3e0f7'];
export const INCOME_TEXT = '#0f766e';
export const EXPENSE_TEXT = '#1e4fae';
export const OVER_TEXT = '#b91c1c';
const BAR = '#4f7fd6';
const OVER_BAR = '#dc2626';
const TRACK = '#eef2f7';

/** 見出しの点の色。 */
export const SECTION_DOTS = { income: INCOME_TEXT, variable: '#1e4fae', reserve: '#4f7fd6', fixed: '#9bb8ea' } as const;

export interface BalancePart {
  name: string;
  amount: number;
  /** 名前の下の注釈（「変動費＋予備費」など）。 */
  note?: string;
}

/** 符号つきの額（収支）。 */
export const signedYen = (value: number) => `${value > 0 ? '＋' : value < 0 ? '−' : ''}${formatYen(value)}`;

const cardClass = 'overflow-hidden rounded-[20px] border border-gray-200 bg-white';

function Breakdown({ parts, palette }: { parts: BalancePart[]; palette: string[] }) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const color = (index: number) => palette[Math.min(index, palette.length - 1)];
  return (
    <div className="space-y-2 px-[18px] pt-3.5 pb-[18px]">
      <div className="mb-1 flex h-3 gap-0.5 overflow-hidden rounded-md">
        {total > 0 ? (
          parts
            .filter((part) => part.amount > 0)
            .map((part, index) => <div key={part.name} style={{ flex: part.amount, background: color(index) }} />)
        ) : (
          <div className="flex-1" style={{ background: TRACK }} />
        )}
      </div>
      {parts.map((part, index) => (
        <div key={part.name}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color(index) }} />
            <span className="flex-1 text-sm font-semibold text-gray-700">{part.name}</span>
            <span className="text-sm font-extrabold tabular-nums text-gray-900">{formatYen(part.amount)}</span>
            <span className="w-10 text-right text-xs font-bold tabular-nums text-gray-400">
              {total > 0 ? `${Math.round((part.amount / total) * 100)}%` : ''}
            </span>
          </div>
          {part.note && <p className="pl-[18px] text-[11px] font-semibold text-gray-400">{part.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function BalanceCard({
  label,
  incomeParts,
  expenseParts,
  children,
}: {
  label: string;
  incomeParts: BalancePart[];
  expenseParts: BalancePart[];
  /** 枠の下に足すもの（年末の着地見込み・月の締めなど）。 */
  children?: ReactNode;
}) {
  const [tab, setTab] = useState<'income' | 'expense'>('expense');
  const income = incomeParts.reduce((sum, part) => sum + part.amount, 0);
  const expense = expenseParts.reduce((sum, part) => sum + part.amount, 0);
  const balance = income - expense;
  return (
    <div className={cardClass}>
      <div className="space-y-1 px-[18px] pt-[18px]">
        <p className="text-[13px] font-bold text-gray-500">{label}</p>
        <p className="text-[32px] font-extrabold tabular-nums" style={{ color: balance < 0 ? OVER_TEXT : '#111827' }}>
          {signedYen(balance)}
        </p>
        <p className="text-[13px] font-bold tabular-nums text-gray-500">
          収入 <span style={{ color: INCOME_TEXT }}>{formatYen(income)}</span> − 支出 <span style={{ color: EXPENSE_TEXT }}>{formatYen(expense)}</span>
        </p>
      </div>
      <div role="tablist" className="mx-[18px] mt-3.5 grid grid-cols-2 gap-1 rounded-[10px] bg-gray-100 p-[3px]">
        {(['income', 'expense'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-2 text-sm font-bold ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            {key === 'income' ? '収入' : '支出'}
          </button>
        ))}
      </div>
      {tab === 'income' ? (
        incomeParts.length === 0 ? (
          <p className="px-[18px] py-[18px] text-[13px] text-gray-400">収入はまだありません</p>
        ) : (
          <Breakdown parts={incomeParts} palette={INCOME_COLORS} />
        )
      ) : (
        <Breakdown parts={expenseParts} palette={EXPENSE_COLORS} />
      )}
      {children}
    </div>
  );
}

export type ChipTone = 'good' | 'over' | 'neutral';

function Bar({ value, thick }: { value: number; thick?: boolean }) {
  const over = value > 1;
  return (
    <div className={`overflow-hidden ${thick ? 'h-2 rounded' : 'h-1.5 rounded-[3px]'}`} style={{ background: TRACK }}>
      <div className="h-full" style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, background: over ? OVER_BAR : BAR }} />
    </div>
  );
}

export function SectionCard({
  title,
  dot,
  chip,
  progress,
  open,
  onToggle,
  children,
}: {
  title: string;
  dot: string;
  /** 見出しの右の丸い札（無ければ出さない）。 */
  chip?: { text: string; tone: ChipTone } | null;
  /** 見出しの下の棒（0〜1。1 を超えたら超過で赤）。null は出さない。 */
  progress?: number | null;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={cardClass}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="block w-full space-y-2.5 px-[18px] py-4 text-left">
        <span className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
          <span className="flex-1 text-[17px] font-extrabold text-gray-900">{title}</span>
          {chip && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums"
              style={{
                color: chip.tone === 'good' ? INCOME_TEXT : chip.tone === 'over' ? OVER_TEXT : '#374151',
                background: chip.tone === 'over' ? '#fef2f2' : '#f3f4f6',
              }}
            >
              {chip.text}
            </span>
          )}
          {open ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
        </span>
        {progress != null && <Bar value={progress} thick />}
      </button>
      {open && children}
    </div>
  );
}

/** 残り（＋）は「¥1,000」、超過（−）は赤の「−¥1,000」。 */
export const remainingText = (value: number) => ({ text: value < 0 ? `−${formatYen(value)}` : formatYen(value), over: value < 0 });

export function AmountRow({
  name,
  amount,
  right,
  progress,
  sub,
  faint,
  onClick,
}: {
  name: string;
  amount: string;
  /** 右の数字（残り・超過・「/月」など）。over は赤。 */
  right?: { text: string; over?: boolean; muted?: boolean } | null;
  /** 細い棒（0〜1。1 を超えたら赤）。 */
  progress?: number | null;
  /** 名前の下の小さな文字（日付など）。 */
  sub?: string;
  faint?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-semibold ${faint ? 'text-gray-400' : 'text-gray-900'}`}>{name}</span>
          {sub && <span className="block text-xs text-gray-500">{sub}</span>}
        </span>
        <span className={`text-[15px] font-extrabold tabular-nums ${faint ? 'text-gray-400' : 'text-gray-900'}`}>{amount}</span>
        {right && (
          <span
            className={`text-right text-[13px] tabular-nums ${right.muted ? 'min-w-[40px] font-semibold text-gray-400' : 'min-w-[76px] font-extrabold'}`}
            style={right.muted ? undefined : { color: right.over ? OVER_TEXT : INCOME_TEXT }}
          >
            {right.text}
          </span>
        )}
      </span>
      {progress != null && <Bar value={progress} />}
    </>
  );
  const className = 'block w-full space-y-[7px] border-t border-gray-100 py-[11px] pr-[18px] pl-[38px] text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:bg-gray-50`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** 枠の中の小見出し（固定費の「確定」「見込み」）。 */
export function SubHeading({ title, amount }: { title: string; amount: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-gray-100 pt-3 pr-[18px] pb-1 pl-[38px]">
      <span className="text-xs font-extrabold text-gray-500">{title}</span>
      <span className="h-px flex-1 bg-gray-100" />
      <span className="text-xs font-extrabold tabular-nums text-gray-500">{amount}</span>
    </div>
  );
}
