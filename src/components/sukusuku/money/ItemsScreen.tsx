'use client';

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { ChevronRight, GripVertical, Minus, Plus } from 'lucide-react';
import {
  editorGroupTotal,
  editorLineAmount,
  evaluateCalc,
  formatBalance,
  formatCalc,
  isBlankLine,
  pressCalcKey,
  sameGroupTarget,
  type EditorGroup,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from './Calculator';
import { CategoryIcon, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';
import { useBackLayer } from '@/lib/browserHistory';
import { useBackdropClose } from '../ui/useBackdropClose';
import { swipeBoundary } from '../ui/useSwipeNavigation';

// 品目の画面（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 記録の品目を、カテゴリごとのまとまりに分けて1つの画面でまとめて入れる（2026-10-20。カテゴリが分かれても、
// 保存して記録の編集に戻り、また追加して…と行き来しなくて済むように）。行＝品名・個数（−＋）・単価・金額。
// 見出しの下の中央に、全部の品目の合計を大きく出す（カテゴリごとの小計は出さない。2026-10-20）。
// まとまりの頭はカテゴリの見出し（太字。予算の残りは出さない。押すとカテゴリを変える）。まとまりの間は灰色の帯で区切り、品目は字下げして控えめに。
// 色は少なく（「−」「＋」は灰色・文字だけ。2026-10-20）。
// まとまりのいちばん下の「＋ 品目を追加」で新しい行を足し（品名の欄は開かない。キーボードが立ち上がらないように。2026-10-15）、
// 行の左の「−」でその行を消す（まとまりの最後の行を消すと、まとまりごと消える）。一覧のいちばん下の「＋ カテゴリを追加」で別のカテゴリのまとまりを足す。
// 電卓は行の金額を押したときだけ、画面の下に別枠で出す（暗い部分を押す・OK・戻る操作で閉じる。Zaim と同じ。2026-10-20）。
// 枠の上にその行の金額（式を打っているときは式も）、下に「マイナスにする」と OK。
// 値引き・割引・返金は「マイナスにする」で、選んだ行の金額をマイナスにする（docs/kakei.md §10.5）。
// 行の左端の持ち手をつかんで別のまとまりへ落とすと、その行をそのカテゴリへ移す（2026-10-21。自動で取り込んだ記録の品目を
// 打ち直さずに分けられるように）。「＋ カテゴリを追加」へ落とすとカテゴリの選択へ行き、選んだカテゴリへ移す。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 記録の品目のまとまり全部（保存すると記録の入力のまとまりと入れ替える）。 */
  groups: EditorGroup[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
  /** 開いたときに見せるまとまり（一覧をそこまで送る）。 */
  focus: string | null;
  /** 電卓を出しているか（行の金額を押したときだけ）。 */
  calc: boolean;
}

type GroupTarget = Pick<EditorGroup, 'categoryId' | 'categoryName'>;

/** 行のドラッグ。over は落とし先（まとまりの key か ADD_CATEGORY。つかんだまとまりの上なら null）。 */
type Drag = { groupKey: string; lineKey: string; dy: number; over: string | null };
const ADD_CATEGORY = 'add-category';

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  memo: '',
});

/** カテゴリのまとまりを足す（同じカテゴリがあれば、そこに空の行を足す）。足した行を選ぶ。 */
export function addWorkGroup(work: ItemsWork, target: GroupTarget, groupKey: string): ItemsWork {
  const line = blankLine();
  const existing = work.groups.find((group) => sameGroupTarget(group, target));
  const groups = existing
    ? work.groups.map((group) =>
        group.key === existing.key ? { ...group, lines: [...group.lines.filter((entry) => !isBlankLine(entry)), line] } : group,
      )
    : [...work.groups, { key: groupKey, ...target, lines: [line] }];
  return { ...work, groups, selected: line.key, expr: '', focus: existing?.key ?? groupKey, calc: false };
}

/** まとまりのカテゴリを変える（変えた先と同じカテゴリのまとまりがあれば、そこへ行をまとめる）。 */
export function changeWorkGroup(work: ItemsWork, groupKey: string, target: GroupTarget): ItemsWork {
  const moving = work.groups.find((group) => group.key === groupKey);
  if (!moving) return work;
  const same = work.groups.find((group) => group.key !== groupKey && sameGroupTarget(group, target));
  const groups = same
    ? work.groups
        .filter((group) => group.key !== groupKey)
        .map((group) => (group.key === same.key ? { ...group, lines: [...group.lines, ...moving.lines] } : group))
    : work.groups.map((group) => (group.key === groupKey ? { ...group, ...target } : group));
  return { ...work, groups };
}

/** 行を別のまとまりへ移す（左の持ち手でドラッグして落としたとき。2026-10-21）。移した先のいちばん下に足し、行の無くなったまとまりは消す。 */
export function moveWorkLine(work: ItemsWork, lineKey: string, toGroupKey: string): ItemsWork {
  const line = work.groups.flatMap((group) => group.lines).find((entry) => entry.key === lineKey);
  if (!line || !work.groups.some((group) => group.key === toGroupKey)) return work;
  const groups = work.groups
    .map((group) => {
      const lines = group.lines.filter((entry) => entry.key !== lineKey);
      return { ...group, lines: group.key === toGroupKey ? [...lines, line] : lines };
    })
    .filter((group) => group.lines.length > 0);
  return { ...work, groups };
}

/** 行を選んだカテゴリへ移す（「＋ カテゴリを追加」へ落としたとき）。同じカテゴリのまとまりがあればそこへ、無ければ新しいまとまりを足す。 */
export function moveWorkLineToCategory(work: ItemsWork, lineKey: string, target: GroupTarget, groupKey: string): ItemsWork {
  const existing = work.groups.find((group) => sameGroupTarget(group, target));
  if (existing) return moveWorkLine(work, lineKey, existing.key);
  return { ...moveWorkLine({ ...work, groups: [...work.groups, { key: groupKey, ...target, lines: [] }] }, lineKey, groupKey), focus: groupKey };
}

/** 保存する形にする（空の行と、行の無いまとまりは残さない）。 */
export const groupsFromWork = (work: ItemsWork): EditorGroup[] =>
  work.groups
    .map((group) => ({ ...group, lines: group.lines.filter((line) => !isBlankLine(line)) }))
    .filter((group) => group.lines.length > 0);

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  /** まとまりの見出し（「食費 › 食料品」）とアイコン。 */
  title: (group: EditorGroup) => string;
  iconKey: (group: EditorGroup) => string;
  onChangeCategory: (groupKey: string) => void;
  /** 「＋ カテゴリを追加」。行を落としたときはその行の key を渡す（選んだカテゴリへ移す）。 */
  onAddCategory: (moveLineKey?: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function ItemsScreen({
  work,
  onChange,
  title,
  iconKey,
  onChangeCategory,
  onAddCategory,
  onSave,
  onClose,
}: ItemsScreenProps) {
  const allLines = work.groups.flatMap((group) => group.lines);
  const filled = allLines.filter((line) => !isBlankLine(line));
  const total = work.groups.reduce((sum, group) => sum + editorGroupTotal(group), 0);

  const mapLines = (fn: (lines: EditorLine[], group: EditorGroup) => EditorLine[]) =>
    work.groups.map((group) => ({ ...group, lines: fn(group.lines, group) }));

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, groups: mapLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line))) });

  // 行を選ぶ。金額を押したときだけ電卓を出す（品名・行のほかの所なら閉じる）。
  // 電卓を出すときは品名の入力を外してキーボードを閉じる（両方が重なって画面が見えなくなるため。2026-10-21）。
  const select = (line: EditorLine, calc: boolean) => {
    if (calc && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onChange({ ...work, selected: line.key, expr: line.unitPrice !== 0 ? String(Math.abs(line.unitPrice)) : '', calc });
  };

  // 開いたまとまり・足したまとまりが見える所まで一覧を送る。行を足したときは、その行が見える所まで送る。
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const addButtons = useRef(new Map<string, HTMLButtonElement>());
  const focused = useRef<string | null>(null);
  const scrollToNew = useRef<string | null>(null);
  useEffect(() => {
    if (work.focus !== null && work.focus !== focused.current) {
      focused.current = work.focus;
      groupRefs.current.get(work.focus)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (scrollToNew.current === null) return;
    addButtons.current.get(scrollToNew.current)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    scrollToNew.current = null;
  });

  // 行のドラッグ（左端の持ち手を押すと持ち上がり、指に付いて上下に動く。落とした先のまとまりへ移す）。
  const addCategoryRef = useRef<HTMLButtonElement>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const dragOrigin = useRef(0);
  const dropTarget = (current: Drag, clientY: number): string | null => {
    const inside = (node: HTMLElement | null | undefined) => {
      const rect = node?.getBoundingClientRect();
      return rect !== undefined && clientY >= rect.top && clientY <= rect.bottom;
    };
    if (inside(addCategoryRef.current)) return ADD_CATEGORY;
    const over = work.groups.find((group) => inside(groupRefs.current.get(group.key)));
    return over && over.key !== current.groupKey ? over.key : null;
  };
  const gripHandlers = (groupKey: string, lineKey: string) => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      dragOrigin.current = event.clientY;
      navigator.vibrate?.(10);
      setDrag({ groupKey, lineKey, dy: 0, over: null });
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      const current = dragRef.current;
      if (!current) return;
      setDrag({ ...current, dy: event.clientY - dragOrigin.current, over: dropTarget(current, event.clientY) });
    },
    onPointerUp: () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current || current.over === null) return;
      if (current.over === ADD_CATEGORY) onAddCategory(current.lineKey);
      else onChange(moveWorkLine(work, current.lineKey, current.over));
    },
    onPointerCancel: () => setDrag(null),
    // 持ち手を押しただけでは行を選ばない。
    onClick: (event: MouseEvent<HTMLSpanElement>) => event.stopPropagation(),
  });

  const addLine = (groupKey: string) => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    // 品名の欄は開かない（キーボードが立ち上がって電卓と一覧が隠れるため。品名は欄を押して入れる）。
    const line = blankLine();
    scrollToNew.current = groupKey;
    onChange({
      ...work,
      groups: mapLines((lines, group) =>
        group.key === groupKey ? [...lines.filter((entry) => !isBlankLine(entry)), line] : lines.filter((entry) => !isBlankLine(entry)),
      ),
      selected: line.key,
      expr: '',
      calc: false,
    });
  };

  // 電卓は行を選んでいるときだけ出す。
  const pressKey = (key: string) => {
    if (work.selected === null) return;
    const expr = pressCalcKey(work.expr, key);
    const value = evaluateCalc(expr) ?? 0;
    onChange({
      ...work,
      expr,
      // 電卓は金額の大きさだけを扱い、マイナスの行はマイナスのまま。
      groups: mapLines((lines) =>
        lines.map((line) => (line.key === work.selected ? { ...line, unitPrice: line.unitPrice < 0 ? -value : value } : line)),
      ),
    });
  };

  const selectedLine = allLines.find((line) => line.key === work.selected) ?? null;

  const toggleSign = () => {
    if (!selectedLine) return;
    updateLine(selectedLine.key, { unitPrice: -selectedLine.unitPrice });
  };

  // 行の左の「−」で、その行をすぐ消す（選んでいる行なら選びも外す）。行の無くなったまとまりは消す。
  const removeLine = (key: string) =>
    onChange({
      ...work,
      groups: mapLines((lines) => lines.filter((line) => line.key !== key)).filter((group) => group.lines.length > 0),
      selected: work.selected === key ? null : work.selected,
      expr: work.selected === key ? '' : work.expr,
    });

  const showExpr = /[+\-*/]/.test(work.expr);
  const closeCalc = () => onChange({ ...work, calc: false });
  // 電卓の枠は、暗い部分を押す・戻る操作でも閉じる。
  useBackLayer(closeCalc, work.calc && selectedLine !== null);
  const backdropClose = useBackdropClose(closeCalc);
  const stepClass = 'flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader title="品目" onClose={onClose} closeAtEnd />
      <div className="shrink-0 border-b border-gray-200 py-2.5 text-center text-[28px] font-extrabold text-gray-900 tabular-nums">
        {formatBalance(total)}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 pb-2">
        {work.groups.map((group) => {
          return (
            <div
              key={group.key}
              ref={(node) => {
                if (node) groupRefs.current.set(group.key, node);
                else groupRefs.current.delete(group.key);
              }}
              className={drag?.groupKey === group.key ? 'relative z-20' : undefined}
            >
              <button
                type="button"
                aria-label="カテゴリを変える"
                onClick={() => onChangeCategory(group.key)}
                className={`mt-2 flex w-full items-center gap-2.5 border-b border-gray-200 px-4 py-2.5 text-left hover:bg-gray-50 ${
                  drag?.over === group.key ? 'bg-blue-50' : 'bg-white'
                }`}
              >
                <CategoryIcon iconKey={iconKey(group)} size={24} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[15px] font-bold text-gray-900">{title(group)}</span>
                </span>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
              {group.lines.map((line) => {
                const selected = line.key === work.selected;
                const dragging = drag?.lineKey === line.key;
                return (
                  <div
                    key={line.key}
                    onClick={() => (selected && !work.calc ? undefined : select(line, false))}
                    style={dragging ? { transform: `translateY(${drag?.dy ?? 0}px)` } : undefined}
                    className={`flex items-center gap-2 py-1 pl-1 pr-4 ${selected && work.calc ? 'bg-blue-50' : 'bg-white'} ${
                      dragging ? 'relative z-20 shadow-lg' : ''
                    }`}
                  >
                    <span
                      aria-label="ドラッグして別のカテゴリへ移す"
                      className="flex w-3.5 shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-gray-400"
                      {...gripHandlers(group.key, line.key)}
                    >
                      <GripVertical size={14} />
                    </span>
                    <button
                      type="button"
                      aria-label="この行を消す"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLine(line.key);
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-gray-700 focus:outline-none"
                      value={line.name}
                      onChange={(event) => updateLine(line.key, { name: event.target.value })}
                      onFocus={() => (selected && !work.calc ? undefined : select(line, false))}
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
                    {/* 入力した単価を主役に（太く大きく。電卓で入れている行は下線＝いま入力している数字）。
                        個数 × 単価 ＝ 金額は小さく添える（金額が目立って、入れた数字と食い違って見えないように）。押すと電卓を出す。 */}
                    <button
                      type="button"
                      aria-label="金額を入れる"
                      onClick={(event) => {
                        event.stopPropagation();
                        select(line, true);
                      }}
                      className="flex min-w-[92px] flex-col items-end gap-px"
                    >
                      <span
                        className={`border-b-2 text-[15px] font-bold tabular-nums ${selected && work.calc ? 'border-blue-600' : 'border-transparent'} ${
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
                    </button>
                  </div>
                );
              })}
              <button
                ref={(node) => {
                  if (node) addButtons.current.set(group.key, node);
                  else addButtons.current.delete(group.key);
                }}
                type="button"
                onClick={() => addLine(group.key)}
                className="flex w-full items-center gap-1.5 bg-white py-2.5 pl-[26px] text-left text-[13px] text-gray-500 hover:bg-gray-50"
              >
                <Plus size={14} />
                品目を追加
              </button>
            </div>
          );
        })}
        <button
          ref={addCategoryRef}
          type="button"
          onClick={() => onAddCategory()}
          className={`mt-2 flex w-full items-center gap-1.5 px-4 py-3 text-left text-sm font-semibold text-blue-600 hover:bg-gray-50 ${
            drag?.over === ADD_CATEGORY ? 'bg-blue-50' : 'bg-white'
          }`}
        >
          <Plus size={16} />
          カテゴリを追加
        </button>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4">
        <PrimaryButton label="保存" disabled={filled.length === 0} onClick={onSave} />
      </div>

      {work.calc && selectedLine !== null && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/50" {...backdropClose} {...swipeBoundary}>
          <div className="bg-white pb-4">
            <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3">
              <span className="flex flex-col items-center leading-none">
                <span className="text-[22px] font-extrabold text-gray-900">¥</span>
                <span className="text-[11px] font-bold text-gray-900">JPY</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-end">
                {showExpr && <span className="text-[13px] text-gray-500 tabular-nums">{formatCalc(work.expr)} =</span>}
                <span className={`truncate text-4xl font-extrabold tabular-nums ${selectedLine.unitPrice < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                  {(selectedLine.unitPrice < 0 ? '−' : '') + Math.abs(selectedLine.unitPrice).toLocaleString('ja-JP')}
                </span>
              </span>
            </div>
            <Calculator onKey={pressKey} />
            <div className="flex items-center gap-2 px-4 pt-1">
              {/* 金額を入れてから切り替える（0円の行には出さない）。 */}
              <span className="flex w-24 justify-center">
                {selectedLine.unitPrice !== 0 && (
                  <button type="button" onClick={toggleSign} className="text-xs font-semibold text-blue-600">
                    {selectedLine.unitPrice < 0 ? 'プラスに戻す' : 'マイナスにする'}
                  </button>
                )}
              </span>
              <button type="button" onClick={closeCalc} className="h-[52px] flex-1 rounded-full bg-blue-600 text-lg font-extrabold text-white hover:bg-blue-700">
                OK
              </button>
              <span className="w-24" />
            </div>
          </div>
        </div>
      )}
    </StackedScreen>
  );
}
