'use client';

import { useEffect, useRef } from 'react';
import { ChevronRight, Minus, Plus, Trash2 } from 'lucide-react';
import {
  editorLineAmount,
  evaluateCalc,
  formatBalance,
  formatCalc,
  isBlankLine,
  pressCalcKey,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from './Calculator';
import { CategoryIcon, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 品目の画面（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 1つのカテゴリの品目を何行でもまとめて記録する。行＝品名・個数（−＋）・単価・金額。
// 一覧のいちばん下に空の行を置き、一覧の左端の「−」でその行を消し、いちばん下の「＋」で新しい行を足す（品名の欄は開かない。キーボードが立ち上がらないように。2026-10-15）。
// 選んだ行（青）の単価を下の電卓で直す（＋−×÷）。電卓はこの画面で初めて出る。
// 値引き・割引・返金は「マイナスにする」で、選んだ行の金額をマイナスにする（docs/kakei.md §10.5）。
// カテゴリは見出しの下に1行で小さく出す（押すと変えられる）。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 直しているカテゴリのまとまり。新しいカテゴリなら null。 */
  groupKey: string | null;
  categoryId: string | null;
  /** 削除したカテゴリの名前（categoryId が null のとき）。 */
  categoryName: string;
  lines: EditorLine[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
}

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  memo: '',
});

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  title: string;
  /** カテゴリのアイコン。 */
  iconKey: string;
  subtitle: string;
  onChangeCategory: () => void;
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
  onChangeCategory,
  onSave,
  onDelete,
  onClose,
}: ItemsScreenProps) {
  const filled = work.lines.filter((line) => !isBlankLine(line));
  const subtotal = work.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, lines: work.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  const select = (line: EditorLine) =>
    onChange({ ...work, selected: line.key, expr: line.unitPrice !== 0 ? String(Math.abs(line.unitPrice)) : '' });

  // 行を足したとき、新しい行が見える所まで一覧を送る（品名の欄は開かない）。
  const addButton = useRef<HTMLButtonElement>(null);
  const scrollToNew = useRef(false);
  useEffect(() => {
    if (!scrollToNew.current) return;
    scrollToNew.current = false;
    addButton.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [work.lines.length, work.selected]);

  const addLine = () => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    // 品名の欄は開かない（キーボードが立ち上がって電卓と一覧が隠れるため。品名は欄を押して入れる）。
    const line = blankLine();
    scrollToNew.current = true;
    onChange({
      ...work,
      lines: [...work.lines.filter((entry) => !isBlankLine(entry)), line],
      selected: line.key,
      expr: '',
    });
  };

  const pressKey = (key: string) => {
    let current = work;
    if (current.selected === null || !current.lines.some((line) => line.key === current.selected)) {
      const line = blankLine();
      current = { ...current, lines: [...current.lines, line], selected: line.key, expr: '' };
    }
    const expr = pressCalcKey(current.expr, key);
    const value = evaluateCalc(expr) ?? 0;
    onChange({
      ...current,
      expr,
      // 電卓は金額の大きさだけを扱い、マイナスの行はマイナスのまま。
      lines: current.lines.map((line) =>
        line.key === current.selected ? { ...line, unitPrice: line.unitPrice < 0 ? -value : value } : line,
      ),
    });
  };

  const selectedLine = work.lines.find((line) => line.key === work.selected) ?? null;

  const toggleSign = () => {
    if (!selectedLine) return;
    updateLine(selectedLine.key, { unitPrice: -selectedLine.unitPrice });
  };

  // 行の左の「−」で、その行をすぐ消す（選んでいる行なら選びも外す）。
  const removeLine = (key: string) =>
    onChange({
      ...work,
      lines: work.lines.filter((line) => line.key !== key),
      selected: work.selected === key ? null : work.selected,
      expr: work.selected === key ? '' : work.expr,
    });

  const showExpr = /[+\-*/]/.test(work.expr);
  const stepClass = 'flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader
        title="品目"
        onClose={onClose}
        closeAtEnd
        right={
          <span className="flex items-center gap-3.5">
            {onDelete && (
              <button type="button" aria-label="このカテゴリの品目を消す" onClick={onDelete} className="text-gray-500">
                <Trash2 size={20} />
              </button>
            )}
          </span>
        }
      />
      <button
        type="button"
        aria-label="カテゴリを変える"
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
              <button
                type="button"
                aria-label="この行を消す"
                onClick={(event) => {
                  event.stopPropagation();
                  removeLine(line.key);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
              >
                <Minus size={12} />
              </button>
              <input
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] focus:outline-none"
                value={line.name}
                onChange={(event) => updateLine(line.key, { name: event.target.value })}
                onFocus={() => (selected ? undefined : select(line))}
                placeholder="品名"
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
              {/* 入力した単価を主役に（太く大きく。選んでいる行は下線＝いま入力している数字）。
                  個数 × 単価 ＝ 金額は小さく添える（金額が目立って、入れた数字と食い違って見えないように）。 */}
              <span className="flex min-w-[92px] flex-col items-end gap-px">
                <span
                  className={`border-b-2 text-[17px] font-extrabold tabular-nums ${selected ? 'border-blue-600' : 'border-transparent'} ${
                    line.unitPrice < 0 ? 'text-red-500' : 'text-gray-900'
                  }`}
                >
                  {formatBalance(line.unitPrice)}
                </span>
                {line.quantity > 1 && (
                  <span className={`text-[11px] font-semibold tabular-nums ${line.unitPrice < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    × {line.quantity} ＝ {formatBalance(editorLineAmount(line))}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <button
          ref={addButton}
          type="button"
          onClick={addLine}
          aria-label="品目を追加する"
          className="flex w-full items-center border-b border-dashed border-gray-300 px-4 py-2.5 text-left hover:bg-gray-50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
            <Plus size={14} />
          </span>
        </button>
        <div className="flex items-baseline gap-1.5 px-4 pt-2.5">
          {selectedLine !== null && (
            <>
              {/* 金額を入れてから切り替える（0円の行には出さない）。 */}
              {selectedLine.unitPrice !== 0 && (
                <button type="button" onClick={toggleSign} className="text-xs font-semibold text-blue-600">
                  {selectedLine.unitPrice < 0 ? 'プラスに戻す' : 'マイナスにする'}
                </button>
              )}
            </>
          )}
          <span className="flex-1" />
          {showExpr && <span className="text-[13px] text-gray-500 tabular-nums">{formatCalc(work.expr)} =</span>}
          <span className="text-[13px] font-semibold text-gray-700">小計</span>
          <span className="text-xl font-bold text-gray-700 tabular-nums">{formatBalance(subtotal)}</span>
        </div>
      </div>

      <Calculator onKey={pressKey} />
      <div className="shrink-0 px-4 pt-1 pb-4">
        <PrimaryButton
          label={filled.length === 0 ? '金額を入れてください' : `このカテゴリを保存（${filled.length}行 ${formatBalance(subtotal)}）`}
          disabled={filled.length === 0}
          onClick={onSave}
        />
      </div>
    </StackedScreen>
  );
}
