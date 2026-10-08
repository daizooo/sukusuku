'use client';

import { ChevronRight, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import {
  editorLineAmount,
  evaluateCalc,
  formatCalc,
  formatYen,
  isBlankLine,
  pressCalcKey,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from './Calculator';
import { CategoryIcon, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 品目の画面（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 1つの種類の品目を何行でもまとめて記録する。行＝品名・個数（−＋）・単価・金額。
// 一覧のいちばん下に空の行を置き、押すとそこに新しく入力する（入れると次の空の行が出る）。
// 選んだ行（青）の単価を下の電卓で直す（＋−×÷）。電卓はこの画面で初めて出る。
// 種類は見出しの下に1行で小さく出す（押すと変えられる）。「日用品から選ぶ」は見出しの右に、
// 日用品の台帳から選ぶ種類（食費・日用品など）のときだけ出す。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 直している種類のまとまり。新しい種類なら null。 */
  groupKey: string | null;
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  lines: EditorLine[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
  /** 品名の欄を開いたままにする行（空の行を押した直後）。 */
  focusKey: string | null;
}

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  productId: null,
  memo: '',
});

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  title: string;
  /** 種類のアイコン。 */
  iconKey: string;
  subtitle: string;
  canPickProducts: boolean;
  onChangeCategory: () => void;
  onPickProducts: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ItemsScreen({
  work,
  onChange,
  title,
  iconKey,
  subtitle,
  canPickProducts,
  onChangeCategory,
  onPickProducts,
  onSave,
  onDelete,
  onClose,
}: ItemsScreenProps) {
  const filled = work.lines.filter((line) => !isBlankLine(line));
  const subtotal = work.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, lines: work.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  const select = (line: EditorLine) =>
    onChange({ ...work, selected: line.key, expr: line.unitPrice > 0 ? String(line.unitPrice) : '', focusKey: null });

  const addLine = () => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    const line = blankLine();
    onChange({
      ...work,
      lines: [...work.lines.filter((entry) => !isBlankLine(entry)), line],
      selected: line.key,
      expr: '',
      focusKey: line.key,
    });
  };

  const pressKey = (key: string) => {
    let current = work;
    if (current.selected === null || !current.lines.some((line) => line.key === current.selected)) {
      const line = blankLine();
      current = { ...current, lines: [...current.lines, line], selected: line.key, expr: '' };
    }
    const expr = pressCalcKey(current.expr, key);
    const unitPrice = evaluateCalc(expr) ?? 0;
    onChange({
      ...current,
      expr,
      focusKey: null,
      lines: current.lines.map((line) => (line.key === current.selected ? { ...line, unitPrice } : line)),
    });
  };

  const removeSelected = () =>
    onChange({ ...work, lines: work.lines.filter((line) => line.key !== work.selected), selected: null, expr: '' });

  const showExpr = /[+\-*/]/.test(work.expr);
  const stepClass = 'flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader
        title="品目"
        onClose={onClose}
        right={
          <span className="flex items-center gap-3.5">
            {canPickProducts && (
              <button
                type="button"
                onClick={onPickProducts}
                className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 hover:bg-blue-200"
              >
                <ShoppingBasket size={15} />
                日用品から選ぶ
              </button>
            )}
            {onDelete && (
              <button type="button" aria-label="この種類の品目を消す" onClick={onDelete} className="text-gray-500">
                <Trash2 size={20} />
              </button>
            )}
          </span>
        }
      />
      <button
        type="button"
        aria-label="種類を変える"
        onClick={onChangeCategory}
        className="shrink-0 flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-1.5 text-left hover:bg-gray-100"
      >
        <CategoryIcon iconKey={iconKey} size={20} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-700">{title}</span>
        {subtitle !== '' && <span className="text-[11px] text-gray-500 tabular-nums">{subtitle}</span>}
        <ChevronRight size={16} className="text-gray-400" />
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {work.lines.map((line) => {
          const selected = line.key === work.selected;
          return (
            <div
              key={line.key}
              onClick={() => (selected ? undefined : select(line))}
              className={`flex items-center gap-2 border-b border-gray-200 px-4 py-1.5 ${selected ? 'bg-blue-50' : ''}`}
            >
              <input
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] focus:outline-none"
                value={line.name}
                onChange={(event) => updateLine(line.key, { name: event.target.value })}
                onFocus={() => (selected ? undefined : select(line))}
                placeholder="品名"
                autoFocus={line.key === work.focusKey}
              />
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="1つ減らす"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) });
                  }}
                  className={stepClass}
                >
                  <Minus size={13} />
                </button>
                <span className="min-w-4 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  aria-label="1つ増やす"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateLine(line.key, { quantity: Math.min(9999, line.quantity + 1) });
                  }}
                  className={stepClass}
                >
                  <Plus size={13} />
                </button>
              </span>
              <span className="w-14 text-right text-xs text-gray-400 tabular-nums">@{line.unitPrice.toLocaleString('ja-JP')}</span>
              <span className="w-[72px] text-right text-[15px] font-bold text-gray-900 tabular-nums">
                {formatYen(editorLineAmount(line))}
              </span>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addLine}
          className="flex w-full items-center border-b border-dashed border-gray-300 px-4 py-3.5 text-left hover:bg-gray-50"
        >
          <span className="flex-1 text-sm text-gray-400">品名（押すと新しい行に入力）</span>
          <span className="text-[15px] font-semibold text-gray-300">¥0</span>
        </button>
        <div className="flex items-baseline gap-1.5 px-4 pt-2.5">
          {work.selected !== null && (
            <button type="button" onClick={removeSelected} className="text-xs font-semibold text-red-500">
              選んだ行を消す
            </button>
          )}
          <span className="flex-1" />
          {showExpr && <span className="text-[13px] text-gray-500 tabular-nums">{formatCalc(work.expr)} =</span>}
          <span className="text-[13px] font-semibold text-gray-700">小計</span>
          <span className="text-[22px] font-bold text-gray-900 tabular-nums">{formatYen(subtotal)}</span>
        </div>
      </div>

      <Calculator onKey={pressKey} />
      <div className="shrink-0 px-4 pt-1 pb-4">
        <PrimaryButton
          label={filled.length === 0 ? '金額を入れてください' : `この種類を保存（${filled.length}行 ${formatYen(subtotal)}）`}
          disabled={filled.length === 0}
          onClick={onSave}
        />
      </div>
    </StackedScreen>
  );
}
