'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, GripVertical, Palette, X } from 'lucide-react';
import type { MoneyCategory, MoneyCategoryKind } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  CATEGORY_ICON_COLORS,
  childCategories,
  guessIconKey,
  iconKeyOf,
  MONEY_ICONS,
  topCategories,
} from '@/lib/moneyUtils';
import { insertDefaultMoneyCategories, updateMoneyCategory } from '@/lib/api/money';
import { useBackLayer } from '@/lib/browserHistory';
import { ModalShell } from '../modals/TaskForm';
import { useBackdropClose } from '../ui/useBackdropClose';
import { useDragReorder, type DragReorder } from '../ui/useDragReorder';
import { swipeBoundary } from '../ui/useSwipeNavigation';
import { SHEET_SIZE } from '../ui/sheetSize';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader } from './moneyVisual';

// カテゴリ（docs/kakei.md §3.1）。mobile版の `mobile/src/components/money/CategoryEditor.tsx` と同じ並び・文言。
//
// ここでできるのは、大分類のアイコン（絵と色）と並べ替えだけ（2026-10-24）。名前の変更・追加・削除は、予算が本体なので年間予算（BudgetEditor）で行い、
// カテゴリはそれを表示するだけ（固定費・予備費の小分類は、予算から決まる）。並べ替えは動かす
// （大分類は一覧の左の持ち手をつかむ、小分類はシートの中で長押し。マウスでも指でも。リストと同じ操作。ui/useDragReorder.ts）。
// 大分類を1行ずつ並べ、押すと下からシート（ボトムシート）が出て、小分類を2列の枠つきボタンで見せる（2026-10-24。カテゴリの選択と同じ見せ方。docs/kakei.md §3.2）。
// 小分類が多い大分類（固定費（確定）23件など）で、行の下に開くと見にくかった。件数は出さない。
// アイコンは、シートの下の「アイコンを変える」から絵と色を選ぶ（アイコンをタップすると色を選べる。出金元のアイコンの色と同じ候補）。
// 小分類のボタンにもアイコンを出し、押すとその小分類の絵と色を選べる（予備費・固定費の行に出るアイコン。2026-10-25）。
// シートとアイコンの選択は同時に出せないので、「アイコンを変える」・小分類を押すとシートを閉じてから開く。
// カテゴリがまだ無い家族には「標準のカテゴリで始める」（Zaim のカテゴリをもとにした並び）。

interface CategoryEditorProps {
  familyId: string;
  categories: MoneyCategory[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onClose: () => void;
}

type Editing = { category: MoneyCategory } | null;

const KIND_OPTIONS: { id: MoneyCategoryKind; label: string }[] = [
  { id: 'living', label: '支出' },
  { id: 'income', label: '収入' },
];

export default function CategoryEditor({
  familyId,
  categories,
  onCategories,
  onClose,
}: CategoryEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [kind, setKind] = useState<MoneyCategoryKind>('living');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  // シートを出している大分類（1つだけ）。
  const [openId, setOpenId] = useState<string | null>(null);

  const tops = useMemo(() => topCategories(categories, kind, true), [categories, kind]);
  const ordered = [...tops.filter((top) => !top.archived), ...tops.filter((top) => top.archived)];
  const openTop = ordered.find((top) => top.id === openId) ?? null;

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);
  const replace = (updated: MoneyCategory) =>
    onCategories((prev) => prev.map((category) => (category.id === updated.id ? updated : category)));

  const seed = async () => {
    setBusy(true);
    try {
      const created = await insertDefaultMoneyCategories(supabase, familyId);
      onCategories((prev) => [...prev, ...created]);
    } catch {
      failed('作成');
    } finally {
      setBusy(false);
    }
  };

  /** 動かしたあとの並び。きょうだいの並びを数え直し、変わったものだけ保存する。 */
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changed = orderedIds
      .map((id, position) => ({ entry: categories.find((category) => category.id === id), position }))
      .filter(
        (change): change is { entry: MoneyCategory; position: number } =>
          change.entry !== undefined && change.entry.position !== change.position,
      );
    if (changed.length === 0) return;
    onCategories((prev) =>
      prev.map((entry) => {
        const hit = changed.find((change) => change.entry.id === entry.id);
        return hit ? { ...entry, position: hit.position } : entry;
      }),
    );
    void Promise.all(changed.map(({ entry, position }) => updateMoneyCategory(supabase, entry.id, { position }))).catch(() =>
      failed('並べ替え'),
    );
  });

  const save = async (result: SheetResult) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    const category = target.category;
    if (result.icon === category.icon && result.iconColor === category.iconColor) return;
    try {
      replace(await updateMoneyCategory(supabase, category.id, { icon: result.icon, iconColor: result.iconColor }));
    } catch {
      failed('保存');
    }
  };

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title="カテゴリ" onClose={onClose} />
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
        <span className="flex-1" />
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={kind === option.id}
            onClick={() => setKind(option.id)}
            className={`rounded-full px-3 py-1.5 text-[13px] ${
              kind === option.id ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="relative flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-2.5">
        {categories.length === 0 && (
          <div className="space-y-3 py-4">
            <p className="text-sm leading-relaxed text-gray-500">
              カテゴリがまだありません。Zaim のカテゴリをもとにした標準のカテゴリで始めて、アイコンや並びをあとで直せます（名前は年間予算で直します）。
            </p>
            <PrimaryButton label="標準のカテゴリで始める" onClick={() => void seed()} disabled={busy} />
          </div>
        )}
        {drag.arrange(`tops-${kind}`, ordered).map((top) => (
          <div
            key={top.id}
            ref={drag.dragRef(top.id)}
            className={`flex min-h-16 items-center rounded-xl border bg-white py-2 pl-1 pr-3.5 ${top.archived ? 'opacity-50' : ''} ${
              drag.isDragging(top.id) ? 'relative z-20 border-blue-300 shadow-xl' : 'border-gray-200'
            }`}
          >
            <span
              role="button"
              aria-label={`${top.name}を並べ替え`}
              {...drag.gripProps(`tops-${kind}`, ordered, top.id)}
              className="flex w-7 flex-none cursor-grab touch-none select-none items-center justify-center self-stretch text-gray-300"
            >
              <GripVertical size={18} />
            </span>
            <button
              type="button"
              aria-label={top.name}
              onClick={() => setOpenId(top.id)}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left"
            >
              <CategoryIcon iconKey={iconKeyOf(top)} size={34} />
              <span className="min-w-0 flex-1 truncate text-base font-bold text-gray-900">{top.name}</span>
              {top.archived && <span className="text-[11px] font-semibold text-gray-400">使わない</span>}
              <ChevronRight size={18} className="text-gray-500" />
            </button>
          </div>
        ))}
      </div>

      {openTop && (
        <ChildSheet
          top={openTop}
          items={drag.arrange(`children-${openTop.id}`, childCategories(categories, openTop.id, true))}
          drag={drag}
          onEditIcon={(category) => {
            setOpenId(null);
            setEditing({ category });
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      {editing !== null && (
        <CategoryModal
          key={editing.category.id}
          category={editing.category}
          onClose={() => setEditing(null)}
          onSubmit={(result) => void save(result)}
        />
      )}
    </FullScreen>
  );
}

// 小分類のボトムシート。カテゴリの選択（CategoryPicker）と同じ見せ方で、長押しで並べ替える。
// 戻る操作（ブラウザ・スマホ）・暗い部分・「×」で閉じる。
function ChildSheet({
  top,
  items,
  drag,
  onEditIcon,
  onClose,
}: {
  top: MoneyCategory;
  items: MoneyCategory[];
  drag: DragReorder;
  /** 大分類・小分類のアイコンを変える。 */
  onEditIcon: (category: MoneyCategory) => void;
  onClose: () => void;
}) {
  useBackLayer(onClose);
  const backdropClose = useBackdropClose(onClose);
  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/50 pt-4 sm:px-4 sm:pb-4"
      {...backdropClose}
      {...swipeBoundary}
    >
      <div role="dialog" aria-label={top.name} className={`flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0 ${SHEET_SIZE}`}>
        <div className="flex h-16 shrink-0 items-center gap-3 px-4">
          <CategoryIcon iconKey={iconKeyOf(top)} size={36} />
          <h3 className="min-w-0 flex-1 truncate text-lg font-bold text-gray-900">{top.name}</h3>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 active:bg-gray-200"
          >
            <X size={20} />
          </button>
        </div>
        {items.length > 0 && (
          <p className="shrink-0 px-4 pb-2 text-[13px] font-medium text-gray-500">
            {items.length >= 2 ? '押すとアイコンを変えられます。長押しして動かすと、並びを変えられます' : '押すとアイコンを変えられます'}
          </p>
        )}
        <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto px-4 pb-1">
          {items.map((child) => (
            <button
              key={child.id}
              type="button"
              ref={drag.dragRef(child.id)}
              {...drag.handleProps(`children-${top.id}`, items, child.id)}
              aria-label={`${child.name}のアイコンを変える`}
              onClick={() => onEditIcon(child)}
              className={`flex min-h-12 select-none items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left text-[15px] font-semibold leading-tight text-gray-900 ${
                child.archived ? 'opacity-50' : ''
              } ${drag.isDragging(child.id) ? 'relative z-20 border-blue-300 shadow-lg' : 'border-gray-300'}`}
            >
              <CategoryIcon iconKey={iconKeyOf(child)} size={24} />
              <span className="min-w-0 flex-1">{child.name}</span>
            </button>
          ))}
        </div>
        <div className="shrink-0 px-4 pb-6 pt-2.5 sm:pb-4">
          <button
            type="button"
            aria-label={`${top.name}のアイコンを変える`}
            onClick={() => onEditIcon(top)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-[15px] font-bold text-blue-800 active:bg-blue-100"
          >
            <Palette size={18} className="text-blue-600" />
            {`${top.name}のアイコンを変える`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SheetResult {
  /** アイコン。 */
  icon: string | null;
  /** アイコンの色。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
}

const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

/** 大分類のアイコン（絵と色）を選ぶ。名前は年間予算で直す。 */
function CategoryModal({
  category,
  onClose,
  onSubmit,
}: {
  category: MoneyCategory;
  onClose: () => void;
  onSubmit: (result: SheetResult) => void;
}) {
  // 自動は無し。決めていないカテゴリは、今の名前から近いものを選んだ状態で始める。
  const [icon, setIcon] = useState<string>(category.icon ?? guessIconKey(category.name));
  const [iconColor, setIconColor] = useState<string | null>(category.iconColor ?? null);
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <ModalShell title={category.name} onClose={onClose} footer={<PrimaryButton label="保存する" onClick={() => onSubmit({ icon, iconColor })} />}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">名前の変更・追加は、年間予算で行います。</p>
        <div>
          <span className={labelClass}>アイコン</span>
          {/* アイコンをタップすると色を選べる（出金元のアイコンの色と同じ候補）。 */}
          <button
            type="button"
            aria-label="アイコンの色を選ぶ"
            aria-expanded={pickingColor}
            onClick={() => setPickingColor((open) => !open)}
            className="flex items-center gap-3 py-1"
          >
            <CategoryIcon iconKey={iconColor ? `${icon}|${iconColor}` : icon} size={48} />
            <span className="text-[13px] font-semibold text-blue-600">タップして色を選ぶ</span>
          </button>
          {pickingColor && (
            <div className="flex flex-wrap gap-2.5 py-1">
              <button
                type="button"
                aria-label="標準の色"
                aria-pressed={iconColor === null}
                onClick={() => setIconColor(null)}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gray-100 ${
                  iconColor === null ? 'ring-[3px] ring-gray-900' : ''
                }`}
              >
                <CategoryIcon iconKey={icon} size={26} />
              </button>
              {CATEGORY_ICON_COLORS.map((entry) => (
                <button
                  key={entry.color}
                  type="button"
                  aria-label={entry.label}
                  aria-pressed={iconColor === entry.color}
                  onClick={() => setIconColor(entry.color)}
                  style={{ backgroundColor: entry.color }}
                  className={`flex h-[34px] w-[34px] items-center justify-center rounded-full text-white ${
                    iconColor === entry.color ? 'ring-[3px] ring-gray-900' : ''
                  }`}
                >
                  {iconColor === entry.color && <Check size={18} />}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {MONEY_ICONS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-label={entry.label}
                aria-pressed={icon === entry.key}
                onClick={() => setIcon(entry.key)}
                className={`flex h-[46px] w-[46px] items-center justify-center rounded-xl border-2 ${
                  icon === entry.key ? 'border-blue-600' : 'border-transparent'
                }`}
              >
                <CategoryIcon iconKey={iconColor ? `${entry.key}|${iconColor}` : entry.key} size={34} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
