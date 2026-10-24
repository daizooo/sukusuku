'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type {
  MoneyBudgetGroup,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyHolidayRule,
  MoneyRatioTargets,
  MoneyRecord,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString, WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  amountModeOfGroup,
  budgetLineCount,
  budgetLineOf,
  budgetLineYearAmount,
  childCategories,
  estimatedBudgetYearAmount,
  formatYear,
  formatYen,
  guessIconKey,
  HOLIDAY_RULE_LABEL,
  isBudgetRow,
  manualBudgetFor,
  monthsLabel,
  parseAmountInput,
  parsePeriodMonth,
  periodMonthInput,
  recurringDayLabel,
  spendGroupOf,
  storeChoices,
  topCategories,
  topCategoryIdOf,
  variableBudgetsOf,
  WEEK_OF_MONTH_OPTIONS,
  yearMonthKeys,
  type BudgetLineGroup,
  type SpendGroup,
} from '@/lib/moneyUtils';
import {
  deleteMoneyCategory,
  deleteMoneyRecurring,
  insertMoneyCategory,
  insertMoneyRecurring,
  insertMoneyStore,
  saveMoneyRatioTargets,
  updateMoneyCategory,
  updateMoneyRecurring,
} from '@/lib/api/money';
import { ModalShell } from '../modals/TaskForm';
import StorePicker from './StorePicker';
import { Chip, ChipRow, Field, WalletChoices } from './feedParts';
import CategoryEditor from './CategoryEditor';
import CategoryIconPicker from './CategoryIconPicker';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 年間予算（docs/kakei.md §0.8。2026-10-24）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
//
// 予算が本体。予算1件＝自動記録ルールの表（money_recurring）の1行で、「単価 × その年に発生する回数」。自動記録はその行のオン／オフ。
// - 上の枠: 円グラフ（1周＝収入）。支出の種類を青の濃淡で並べ、残りが収支見込み（緑）。赤字の年は、支出の種類を1周に並べ、
//   収入からはみ出した分を外側の赤い弧で出す。円の下に収支見込み・収入・支出と、支出の種類（収入に対する割合）。
//   行を押すと、下の一覧はその種類だけになる（もう一度押すと全部）
// - 下の一覧: 収入・変動費・予備費・固定費（確定）・固定費（見込み）の見出しごと（見出しを押すと折りたたむ）。収入の見出しの下線は緑、
//   ほかはグレー。行は名前と年の額だけ（詳細は押して開く枠で見る）。その年に発生しない予算は、グレーにして「期間外」を付け、各見出しの一番下
// - 変動費の行は大分類。押すと予算の枠が開く（大分類の画面は無くした。2026-10-24）
// - 予算の枠（追加・編集）は、種類で「分類」の項目が変わる（どの種類も「予算の1行」で数える。docs/kakei.md §0.8）:
//   変動費＝1行が大分類: 種類・名前・アイコン・小分類（大分類の名前とアイコン、小分類の足す・直す・移す・消すをここで）
//   固定費（確定）・固定費（見込み）・予備費＝1行が小分類（品目）: 種類・名前（大分類は種類そのもの。名前が小分類の名前になる）
//   収入＝1行が小分類（種別）: 種類・大分類・小分類・品目（品目名は同じ小分類に予算が複数あるときの区別）
//   予算（金額・いつ・期間）、自動記録（オン／オフ・日・出金元・お店）。種類を変えて保存できるのは、予備費・固定費の間だけ（小分類が選んだ種類へ移る）

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  /** 目標割合（docs/kakei.md §0.9）。年間予算の画面から決める。 */
  ratioTargets: MoneyRatioTargets;
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onRatioTargets: (targets: MoneyRatioTargets) => void;
  onClose: () => void;
}

/** 種類の名前（見出し・選ぶ画面）。 */
const GROUP_LABEL: Record<BudgetLineGroup, string> = {
  income: '収入',
  variable: '変動費',
  confirmed: '固定費（確定）',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

/** 上の枠の内訳の名前。 */
const PART_LABEL: Record<SpendGroup, string> = {
  variable: '変動費',
  confirmed: '固定費・確定',
  estimate: '固定費・見込み',
  reserve: '予備費',
};

// 並びは 変動費 → 予備費 → 固定費（確定・見込み）。家計全体で予算を並べるときの順（2026-10-24。docs/kakei.md §0.9）。
const SPEND_GROUPS: SpendGroup[] = ['variable', 'reserve', 'confirmed', 'estimate'];
const GROUPS: BudgetLineGroup[] = ['income', ...SPEND_GROUPS];

/** 円グラフの色（支出の種類は青の濃淡。収支見込みは収入の緑、赤字は赤）。mobile と同じ。 */
const PART_COLOR: Record<SpendGroup, string> = {
  variable: '#1e3a8a',
  confirmed: '#3b82f6',
  estimate: '#93c5fd',
  reserve: '#cbd5e1',
};
const INCOME_COLOR = '#43b02a';
const DEFICIT_COLOR = '#dc2626';

/** 支出の種類 → 大分類の予算の分け方。 */
const budgetGroupOf = (group: SpendGroup): MoneyBudgetGroup => (group === 'confirmed' ? 'fixed' : group);

/** 大分類＝種類のもの（固定費・予備費）の大分類の名前。 */
const TYPE_TOP_NAME: Record<Exclude<SpendGroup, 'variable'>, string> = {
  confirmed: '固定費（確定）',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

/** 大分類を選ぶ種類（変動費・収入）。ほかは大分類＝種類。 */
const choosesTop = (group: BudgetLineGroup): group is 'variable' | 'income' => group === 'variable' || group === 'income';

/** 種類で変わる、カテゴリの扱い（保存のとき、予算の行より先に作る・直すもの）。 */
type CategoryPlan =
  | { group: 'variable'; topId: string | null; name: string; icon: string; iconColor: string | null; newKids: string[] }
  | { group: Exclude<SpendGroup, 'variable'>; name: string }
  | { group: 'income' };

const isItemGroup = (group: BudgetLineGroup): group is Exclude<SpendGroup, 'variable'> => group === 'reserve' || group === 'confirmed' || group === 'estimate';

type Screen = { type: 'list' } | { type: 'form'; ruleId: string | null; group?: BudgetLineGroup; topId?: string };

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

/** 目標割合（種類ごと。固定費は確定＋見込みで1つ）の行。 */
const RATIO_ROWS: { key: keyof MoneyRatioTargets; label: string }[] = [
  { key: 'variable', label: '変動費' },
  { key: 'reserve', label: '予備費' },
  { key: 'fixed', label: '固定費' },
];

/** 入力の文字を割合（0〜100 の整数）にする。空は null、読めない・範囲外は undefined。 */
function parsePercent(text: string): number | null | undefined {
  const value = text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/[%％\s]/g, '');
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const percent = Number(value);
  return percent <= 100 ? percent : undefined;
}

/** 割合（収入に対する）。一桁は前に数字1つぶんの空き。 */
const percentText = (value: number, base: number): string => {
  if (base <= 0) return '';
  const percent = Math.round((value / base) * 100);
  return `（${percent < 10 ? ' ' : ''}${percent}%）`;
};

/** 行の、保存の形（id などを外したもの）。 */
const draftOf = (rule: MoneyRecurring): MoneyRecurringDraft => ({
  kind: rule.kind,
  day: rule.day,
  weekOfMonth: rule.weekOfMonth,
  weekday: rule.weekday,
  months: rule.months,
  startMonth: rule.startMonth,
  endMonth: rule.endMonth,
  holiday: rule.holiday,
  amountMode: rule.amountMode,
  amount: rule.amount,
  walletId: rule.walletId,
  toWalletId: rule.toWalletId,
  store: rule.store,
  categoryId: rule.categoryId,
  name: rule.name,
  makesRecord: rule.makesRecord,
  skippedMonths: rule.skippedMonths,
  intervalYears: rule.intervalYears,
  dayKnown: rule.dayKnown,
  noMonth: rule.noMonth,
});

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const groupClass = 'overflow-hidden rounded-xl bg-white';
const itemClass = 'flex w-full min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50';
const dividedClass = 'border-t border-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

export default function BudgetEditor({
  familyId,
  year: initialYear,
  categories,
  recurring,
  wallets,
  stores,
  records,
  ratioTargets,
  onCategories,
  onRecurring,
  onStores,
  onRatioTargets,
  onClose,
}: BudgetEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(initialYear);
  const [stack, setStack] = useState<Screen[]>([{ type: 'list' }]);
  // 上の枠で押した種類（その種類だけ並べる。expense は支出の種類すべて）。null は全部。
  const [selected, setSelected] = useState<BudgetLineGroup | 'expense' | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<MoneyCategory | null>(null);
  // カテゴリ（アイコン・色・並べ替え）の画面。家計の設定から、年間予算の右上へ移した（2026-10-24）。
  const [editingCategories, setEditingCategories] = useState(false);
  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const rows = useMemo(() => recurring.filter(isBudgetRow).sort(byPosition), [recurring]);
  /** 予算の行のその年の額。固定費（見込み）は、月ごとに前年の記録から見込む（docs/kakei.md §0.8）。ほかは単価 × 回数。 */
  const yearTotal = (rule: MoneyRecurring) =>
    rule.categoryId !== null && groupOf(rule.categoryId) === 'estimate'
      ? estimatedBudgetYearAmount(rule, year, records)
      : budgetLineYearAmount(budgetLineOf(rule), year);
  const variableBudgets = useMemo(() => variableBudgetsOf(recurring, categories), [recurring, categories]);
  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const category = (id: string | null) => categories.find((entry) => entry.id === id) ?? null;
  const groupOf = (categoryId: string): BudgetLineGroup =>
    category(categoryId)?.kind === 'income' ? 'income' : spendGroupOf(categoryId, categories);
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

  /** 行の名前（小分類〔大分類の行は大分類〕と区別）。収入は「給与 › 大造」。 */
  const rowLabel = (rule: MoneyRecurring) => {
    const own = category(rule.categoryId);
    const top = own?.parentId ? category(own.parentId) : null;
    const base = own === null ? (rule.kind === 'income' ? '収入' : '支出') : own.kind === 'income' && top ? `${top.name} › ${own.name}` : own.name;
    return rule.name.trim() === '' ? base : `${base}（${rule.name.trim()}）`;
  };

  // 変動費の大分類（年の予算）。
  const variableTops = useMemo(
    () =>
      topCategories(categories, 'living')
        .filter((top) => top.budgetGroup === 'variable')
        .map((top) => {
          const total = monthKeys.reduce((sum, key) => sum + (manualBudgetFor(variableBudgets, top.id, key) ?? 0), 0);
          return { top, total };
        }),
    [categories, monthKeys, variableBudgets],
  );
  // 種類ごとの行（変動費以外。その年の額つき。期間外は一番下）。
  const sections = useMemo(() => {
    const result: Record<Exclude<BudgetLineGroup, 'variable'>, { rule: MoneyRecurring; total: number }[]> = {
      income: [],
      confirmed: [],
      estimate: [],
      reserve: [],
    };
    const order = (rule: MoneyRecurring) => {
      const own = categories.find((entry) => entry.id === rule.categoryId);
      const top = categories.find((entry) => entry.id === topCategoryIdOf(categories, rule.categoryId as string));
      return (top?.position ?? 0) * 10000 + (own?.parentId ? own.position : 0);
    };
    for (const rule of [...rows].sort((a, b) => order(a) - order(b) || a.position - b.position)) {
      const own = categories.find((entry) => entry.id === rule.categoryId);
      const group: BudgetLineGroup = own?.kind === 'income' ? 'income' : spendGroupOf(rule.categoryId, categories);
      if (group === 'variable') continue;
      result[group].push({
        rule,
        total: group === 'estimate' ? estimatedBudgetYearAmount(rule, year, records) : budgetLineYearAmount(budgetLineOf(rule), year),
      });
    }
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      result[key].sort((a, b) => Number(a.total === 0) - Number(b.total === 0));
    }
    return result;
  }, [rows, categories, year, records]);
  const orphans = recurring.filter((rule) => !rule.archived && rule.kind !== 'transfer' && rule.categoryId === null).sort(byPosition);

  /** 変動費の大分類の予算の行（大分類そのものの行。無ければ、昔の小分類の行）。 */
  const variableRuleOf = (topId: string): MoneyRecurring | null =>
    rows.find((rule) => rule.categoryId === topId) ?? rows.find((rule) => category(rule.categoryId)?.parentId === topId) ?? null;

  const sumOf = (list: { total: number }[]) => list.reduce((sum, entry) => sum + entry.total, 0);
  const totals: Record<BudgetLineGroup, number> = {
    income: sumOf(sections.income),
    variable: sumOf(variableTops),
    confirmed: sumOf(sections.confirmed),
    estimate: sumOf(sections.estimate),
    reserve: sumOf(sections.reserve),
  };
  const expense = totals.variable + totals.confirmed + totals.estimate + totals.reserve;
  const balance = totals.income - expense;

  // ---- 保存 ----

  const putRule = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));
  const putCategory = (saved: MoneyCategory) => onCategories((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);

  /** その種類の大分類（固定費・予備費は種類そのもの。無ければ作る）。 */
  const typeTop = async (group: Exclude<SpendGroup, 'variable'>): Promise<MoneyCategory> => {
    const found = topCategories(categories, 'living').find((top) => spendGroupOf(top.id, categories) === group);
    if (found) return found;
    const name = TYPE_TOP_NAME[group];
    let top = await insertMoneyCategory(supabase, familyId, {
      kind: 'living',
      parentId: null,
      name,
      icon: guessIconKey(name),
      position: topCategories(categories, 'living', true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
    });
    top = await updateMoneyCategory(supabase, top.id, { budgetGroup: budgetGroupOf(group) });
    putCategory(top);
    return top;
  };

  const nextPosition = (kind: MoneyCategoryKind, parentId: string | null) =>
    (parentId === null ? topCategories(categories, kind, true) : childCategories(categories, parentId, true)).reduce(
      (max, entry) => Math.max(max, entry.position + 1),
      0,
    );

  /** 小分類を作る（収入の枠の小分類の選択から）。 */
  const createCategory = async (topId: string | null, name: string): Promise<MoneyCategory | null> => {
    try {
      const parent = category(topId);
      if (parent === null) return null;
      const created = await insertMoneyCategory(supabase, familyId, {
        kind: parent.kind,
        parentId: parent.id,
        name,
        icon: null,
        position: nextPosition(parent.kind, parent.id),
      });
      onCategories((prev) => [...prev, created]);
      return created;
    } catch {
      failed();
      return null;
    }
  };

  /** 収入の大分類を作る（収入の枠の大分類の選択から）。 */
  const createTop = async (name: string): Promise<MoneyCategory | null> => {
    try {
      const created = await insertMoneyCategory(supabase, familyId, {
        kind: 'income',
        parentId: null,
        name,
        icon: guessIconKey(name),
        position: nextPosition('income', null),
      });
      putCategory(created);
      return created;
    } catch {
      failed();
      return null;
    }
  };

  const rename = async (target: MoneyCategory, name: string) => {
    setRenaming(null);
    if (name.trim() === '' || name.trim() === target.name) return;
    try {
      putCategory(await updateMoneyCategory(supabase, target.id, { name }));
    } catch {
      failed();
    }
  };

  // ---- 変動費の大分類の、小分類（予算の枠の「小分類」から。docs/kakei.md §0.8） ----

  const addKid = async (topId: string, name: string): Promise<void> => {
    const parent = category(topId);
    if (parent === null) return;
    try {
      const created = await insertMoneyCategory(supabase, familyId, {
        kind: parent.kind,
        parentId: parent.id,
        name,
        icon: null,
        position: nextPosition(parent.kind, parent.id),
      });
      onCategories((prev) => [...prev, created]);
    } catch {
      failed();
    }
  };

  /** 小分類の名前を直す・別の大分類へ移す。 */
  const updateKid = async (kid: MoneyCategory, fields: { name?: string; parentId?: string }): Promise<void> => {
    try {
      const moved = fields.parentId !== undefined && fields.parentId !== kid.parentId;
      putCategory(
        await updateMoneyCategory(supabase, kid.id, {
          ...fields,
          ...(moved && { position: nextPosition(kid.kind, fields.parentId as string) }),
        }),
      );
    } catch {
      failed();
    }
  };

  /** 確認して、カテゴリ（と、それを持つ予算の行）を消す。消したあとは after を呼ぶ。 */
  const confirmRemoveCategories = (
    title: string,
    message: string,
    categoryIds: Set<string>,
    deleteId: string,
    after?: () => void,
  ) => {
    const own = recurring.filter((rule) => !rule.archived && rule.categoryId !== null && categoryIds.has(rule.categoryId));
    if (!window.confirm(`${title}\n${message.replace('{rules}', own.length > 0 ? `予算${own.length}行` : '')}`)) return;
    void (async () => {
      try {
        for (const rule of own) await deleteMoneyRecurring(supabase, rule.id);
        await deleteMoneyCategory(supabase, deleteId);
        onRecurring((prev) => prev.filter((entry) => !own.some((rule) => rule.id === entry.id)));
        onCategories((prev) => prev.filter((entry) => !categoryIds.has(entry.id)));
        after?.();
      } catch {
        failed();
      }
    })();
  };

  const removeKid = (kid: MoneyCategory) => {
    const own = recurring.filter((rule) => !rule.archived && rule.categoryId === kid.id).length;
    confirmRemoveCategories(
      `「${kid.name}」を削除しますか？`,
      `${own > 0 ? '{rules}も消えます。' : ''}これまでの記録には、名前だけが残ります。`,
      new Set([kid.id]),
      kid.id,
    );
  };

  /** 変動費の大分類を消す（小分類と予算の行も消える）。 */
  const removeTop = (top: MoneyCategory) => {
    const kids = childCategories(categories, top.id, true);
    const ids = new Set([top.id, ...kids.map((entry) => entry.id)]);
    const hasRules = recurring.some((rule) => !rule.archived && rule.categoryId !== null && ids.has(rule.categoryId));
    confirmRemoveCategories(
      `「${top.name}」を削除しますか？`,
      `小分類${kids.length}件${hasRules ? 'と{rules}' : ''}も消えます。これまでの記録には、名前だけが残ります。`,
      ids,
      top.id,
      pop,
    );
  };

  /** 固定費・予備費の品目（小分類＝予算の1行）を消す。小分類も一緒に消える。 */
  const removeItem = (rule: MoneyRecurring) => {
    const own = category(rule.categoryId);
    if (own === null) return void removeRule(rule);
    const shared = recurring.some((entry) => !entry.archived && entry.id !== rule.id && entry.categoryId === own.id);
    if (shared) return void removeRule(rule);
    confirmRemoveCategories(
      `「${own.name}」を削除しますか？`,
      '小分類と予算が消えます。これまでの記録には、名前だけが残ります。',
      new Set([own.id]),
      own.id,
      pop,
    );
  };

  /** 予算の行の種類に合わせて消す（変動費は大分類ごと、固定費・予備費は品目〔小分類〕ごと、収入は行だけ）。 */
  const removeBudget = (rule: MoneyRecurring) => {
    const own = category(rule.categoryId);
    if (own !== null && own.kind === 'living') {
      const group = groupOf(own.id);
      if (group === 'variable') {
        const top = category(topCategoryIdOf(categories, own.id));
        if (top !== null) return removeTop(top);
      } else return removeItem(rule);
    }
    void removeRule(rule);
  };

  /**
   * 予算を保存する。種類ごとに、先にカテゴリを作る・直す。
   * 変動費は大分類（名前・アイコン・小分類）、固定費・予備費は小分類（名前。選んだ種類の大分類の下へ。種類を変えたら移す）、収入は選んだ小分類。
   */
  const saveBudget = async (
    target: MoneyRecurring | null,
    draft: MoneyRecurringDraft,
    plan: CategoryPlan,
    registerStore: boolean,
  ): Promise<boolean> => {
    try {
      let categoryId = draft.categoryId;
      if (plan.group === 'variable') {
        let top = category(plan.topId);
        const name = plan.name.trim();
        if (top === null) {
          top = await insertMoneyCategory(supabase, familyId, {
            kind: 'living',
            parentId: null,
            name,
            icon: plan.icon,
            iconColor: plan.iconColor,
            position: nextPosition('living', null),
          });
          putCategory(top);
          for (const [index, kidName] of plan.newKids.entries()) {
            const created = await insertMoneyCategory(supabase, familyId, { kind: 'living', parentId: top.id, name: kidName, icon: null, position: index });
            onCategories((prev) => [...prev, created]);
          }
        } else if (top.name !== name || (top.icon ?? guessIconKey(top.name)) !== plan.icon || top.iconColor !== plan.iconColor) {
          top = await updateMoneyCategory(supabase, top.id, { name, icon: plan.icon, iconColor: plan.iconColor });
          putCategory(top);
        }
        categoryId = top.id;
      } else if (plan.group !== 'income') {
        const parent = await typeTop(plan.group);
        const name = plan.name.trim();
        const own = category(target?.categoryId ?? null);
        if (own !== null && own.parentId !== null) {
          let kid = own;
          if (own.parentId !== parent.id) {
            kid = await updateMoneyCategory(supabase, own.id, { parentId: parent.id, position: nextPosition(parent.kind, parent.id) });
            putCategory(kid);
            // 同じ小分類のほかの予算の確定／見込みも、種類に合わせて直す。
            const mode = amountModeOfGroup(plan.group);
            for (const rule of rows.filter((entry) => entry.categoryId === own.id && entry.id !== target?.id && entry.kind === 'expense')) {
              if (rule.amountMode !== mode) putRule(await updateMoneyRecurring(supabase, rule.id, { ...draftOf(rule), amountMode: mode }));
            }
          }
          if (kid.name !== name) {
            kid = await updateMoneyCategory(supabase, kid.id, { name });
            putCategory(kid);
          }
          categoryId = kid.id;
        } else {
          const created = await insertMoneyCategory(supabase, familyId, {
            kind: parent.kind,
            parentId: parent.id,
            name,
            icon: null,
            position: nextPosition(parent.kind, parent.id),
          });
          onCategories((prev) => [...prev, created]);
          categoryId = created.id;
        }
      }
      const saved =
        target === null
          ? await insertMoneyRecurring(supabase, familyId, { ...draft, categoryId }, recurring.reduce((max, rule) => Math.max(max, rule.position + 1), 0))
          : await updateMoneyRecurring(supabase, target.id, { ...draft, categoryId });
      putRule(saved);
      // 「お店に登録して使う」を選んだお店は、お店の設定にも登録する（docs/kakei.md §3.5）。
      if (registerStore && draft.store !== '' && !stores.some((entry) => entry.name === draft.store && !entry.archived)) {
        const savedStore = await insertMoneyStore(supabase, familyId, draft.store);
        onStores((prev) => [...prev.filter((entry) => entry.id !== savedStore.id), savedStore]);
      }
      return true;
    } catch {
      failed();
      return false;
    }
  };

  const removeRule = async (rule: MoneyRecurring) => {
    if (!window.confirm('この予算を消しますか？\nすべての年から消えます。自動で作った記録はそのまま残ります。')) return;
    try {
      await deleteMoneyRecurring(supabase, rule.id);
      onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
      pop();
    } catch {
      failed();
    }
  };


  // ---- 画面 ----

  let body: ReactNode;
  if (screen.type === 'form') {
    const rule = recurring.find((entry) => entry.id === screen.ruleId) ?? null;
    body = (
      <BudgetForm
        key={rule?.id ?? `new-${screen.group ?? ''}-${screen.topId ?? ''}`}
        rule={rule}
        initialGroup={rule?.categoryId ? groupOf(rule.categoryId) : (screen.group ?? 'variable')}
        initialTopId={rule?.categoryId ? topCategoryIdOf(categories, rule.categoryId) : (screen.topId ?? null)}
        year={year}
        categories={categories}
        wallets={wallets}
        stores={stores}
        records={records}
        onCreateCategory={createCategory}
        onCreateTop={createTop}
        onRenameCategory={setRenaming}
        onKidAdd={addKid}
        onKidUpdate={updateKid}
        onKidRemove={removeKid}
        onRemoveTop={removeTop}
        onClose={pop}
        onSubmit={async (draft, plan, registerStore) => {
          if (await saveBudget(rule, draft, plan, registerStore)) pop();
        }}
        onRemove={rule ? () => removeBudget(rule) : undefined}
      />
    );
  } else {
    const shown = (group: BudgetLineGroup) => selected === null || selected === group || (selected === 'expense' && group !== 'income');
    const section = (group: BudgetLineGroup, content: ReactNode, total: number) => {
      // 上の枠で絞ったときは折りたたまない（折りたたみの印も出さない）。
      const filtered = selected !== null;
      const open = filtered || !collapsed.has(group);
      return (
        <section key={group} className="space-y-1">
          <button
            type="button"
            aria-expanded={filtered ? undefined : open}
            disabled={filtered}
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              })
            }
            className={`flex w-full items-center gap-1.5 border-b-2 px-0.5 pt-2.5 pb-1 text-left ${group === 'income' ? 'border-[#43b02a]' : 'border-gray-300'}`}
          >
            {!filtered && (open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />)}
            <span className="text-lg font-extrabold text-gray-900">{GROUP_LABEL[group]}</span>
            <span className="flex-1" />
            <span className="text-lg font-extrabold tabular-nums text-gray-900">{formatYen(total)}</span>
          </button>
          {open && content}
        </section>
      );
    };
    const ruleList = (group: Exclude<BudgetLineGroup, 'variable'>) => (
      <div>
        {sections[group].map((entry, index) => (
          <BudgetRow
            key={entry.rule.id}
            first={index === 0}
            label={rowLabel(entry.rule)}
            total={entry.total}
            onClick={() => push({ type: 'form', ruleId: entry.rule.id })}
          />
        ))}
        {sections[group].length === 0 && <p className="px-1 py-2.5 text-[13px] text-gray-400">予算がまだありません</p>}
      </div>
    );
    const variableList = (
      <div>
        {[...variableTops]
          .sort((a, b) => Number(a.total === 0) - Number(b.total === 0))
          .map((entry, index) => (
            <BudgetRow
              key={entry.top.id}
              first={index === 0}
              label={entry.top.name}
              total={entry.total}
              offLabel="予算なし"
              onClick={() => {
                const own = variableRuleOf(entry.top.id);
                push({ type: 'form', ruleId: own?.id ?? null, group: 'variable', topId: entry.top.id });
              }}
            />
          ))}
      </div>
    );
    body = (
      <>
        <ScreenHeader
          title="年間予算"
          onClose={onClose}
          right={
            <button
              type="button"
              aria-label="カテゴリ（アイコン・色・並べ替え）"
              onClick={() => setEditingCategories(true)}
              className="rounded-2xl bg-blue-100 px-3.5 py-1.5 text-[13px] font-bold text-blue-800 hover:bg-blue-200"
            >
              カテゴリ
            </button>
          }
        />
        <div className="shrink-0 flex items-center gap-2 px-4 py-2">
          <button type="button" aria-label="前の年" onClick={() => setYear((current) => current - 1)} className={yearButtonClass}>
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-bold text-gray-900 tabular-nums">{formatYear(year)}</span>
          <button type="button" aria-label="次の年" onClick={() => setYear((current) => current + 1)} className={yearButtonClass}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
          <div className="rounded-2xl bg-white px-3.5 py-3 shadow-[0_6px_18px_rgba(17,24,39,0.12)]">
            <Donut income={totals.income} parts={SPEND_GROUPS.map((group) => ({ group, amount: totals[group] }))} />
            <LegendRow
              main
              color={balance >= 0 ? INCOME_COLOR : DEFICIT_COLOR}
              label="収支見込み"
              percent=""
              amount={balance < 0 ? `−${formatYen(balance)}` : formatYen(balance)}
              amountColor={balance >= 0 ? INCOME_COLOR : DEFICIT_COLOR}
            />
            <LegendRow
              main
              label="収入"
              percent=""
              amount={formatYen(totals.income)}
              selected={selected === 'income'}
              onClick={() => setSelected((current) => (current === 'income' ? null : 'income'))}
            />
            <LegendRow
              main
              label="支出"
              percent=""
              amount={formatYen(expense)}
              selected={selected === 'expense'}
              onClick={() => setSelected((current) => (current === 'expense' ? null : 'expense'))}
            />
            {SPEND_GROUPS.map((group) => (
              <LegendRow
                key={group}
                color={PART_COLOR[group]}
                label={PART_LABEL[group]}
                percent={percentText(totals[group], totals.income)}
                amount={formatYen(totals[group])}
                selected={selected === group}
                onClick={() => setSelected((current) => (current === group ? null : group))}
              />
            ))}
            <RatioPanel familyId={familyId} targets={ratioTargets} onSaved={onRatioTargets} />
          </div>

          {shown('income') && section('income', ruleList('income'), totals.income)}
          {shown('variable') && section('variable', variableList, totals.variable)}
          {shown('reserve') && section('reserve', ruleList('reserve'), totals.reserve)}
          {shown('confirmed') && section('confirmed', ruleList('confirmed'), totals.confirmed)}
          {shown('estimate') && section('estimate', ruleList('estimate'), totals.estimate)}
          {selected === null && orphans.length > 0 && (
            <section className="space-y-1">
              <div className="border-b-2 border-gray-300 px-0.5 pt-2.5 pb-1">
                <span className="text-lg font-extrabold text-gray-900">カテゴリなし</span>
              </div>
              <div>
                {orphans.map((rule, index) => (
                  <BudgetRow key={rule.id} first={index === 0} label={rowLabel(rule)} total={yearTotal(rule)} onClick={() => push({ type: 'form', ruleId: rule.id })} />
                ))}
              </div>
            </section>
          )}
          <AddButton label="予算を追加" onClick={() => push({ type: 'form', ruleId: null, group: selected === null || selected === 'expense' ? 'variable' : selected })} />
        </div>
      </>
    );
  }

  return (
    <FullScreen onBack={onClose}>
      {stack.length > 1 ? (
        // 1つ奥の画面ごとに、戻る操作で1つ前の画面へ戻す層を積む。
        <StackedScreen key={stack.length} onBack={pop}>
          {body}
        </StackedScreen>
      ) : (
        body
      )}
      {renaming !== null && <RenameSheet name={renaming.name} onClose={() => setRenaming(null)} onSubmit={(name) => void rename(renaming, name)} />}
      {editingCategories && (
        <CategoryEditor familyId={familyId} categories={categories} onCategories={onCategories} onClose={() => setEditingCategories(false)} />
      )}
    </FullScreen>
  );
}

// ---- 上の枠 ----

/** 円グラフ（1周＝収入）。黒字は残りを緑。赤字は支出の種類を1周に並べ、収入からはみ出した分を外側の赤い弧で出す。 */
function Donut({ income, parts }: { income: number; parts: { group: SpendGroup; amount: number }[] }) {
  const expense = parts.reduce((sum, part) => sum + part.amount, 0);
  const deficit = expense > income;
  // 種類を並べる1周の基準。黒字は収入、赤字は支出（種類の並びを1周に収める）。
  const base = deficit ? expense : income;
  const center = 80;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs: { key: string; color: string; length: number; offset: number }[] = [];
  if (base > 0) {
    for (const part of parts) {
      const length = (circumference * part.amount) / base;
      arcs.push({ key: part.group, color: PART_COLOR[part.group], length, offset });
      offset += length;
    }
    if (!deficit && income > expense) arcs.push({ key: 'balance', color: INCOME_COLOR, length: circumference - offset, offset });
  }
  const outer = 74;
  const outerCircumference = 2 * Math.PI * outer;
  // はみ出し（収入に対する割合。収入が無ければ1周）。
  const over = deficit ? Math.min(1, income > 0 ? (expense - income) / income : 1) * outerCircumference : 0;
  const centerText = income >= 10000 ? `¥${Math.round(income / 10000).toLocaleString('ja-JP')}万` : formatYen(income);
  return (
    <div className="flex justify-center pb-1.5">
      <svg viewBox="0 0 160 160" width={168} height={168} role="img" aria-label="収入を1周とした支出と収支見込みの円グラフ">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={18} />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={18}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
        {over > 0 && (
          <circle
            cx={center}
            cy={center}
            r={outer}
            fill="none"
            stroke={DEFICIT_COLOR}
            strokeWidth={6}
            strokeDasharray={`${over} ${outerCircumference - over}`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
        <text x={center} y={70} textAnchor="middle" fontSize={10} fontWeight={700} fill="#6b7280">
          収入
        </text>
        <text x={center} y={88} textAnchor="middle" fontSize={16} fontWeight={800} fill="#111827">
          {centerText}
        </text>
      </svg>
    </div>
  );
}

/**
 * 目標割合（docs/kakei.md §0.9）。上の枠の下に折りたたんで出す（はじめは閉じる）。開くと、種類ごと（変動費・予備費・固定費）の
 * 目標と、貯金（100% − 合計）。「編集」でその場で直す（合計が100%を超えると保存できない。空は目標なし）。
 */
function RatioPanel({ familyId, targets, onSaved }: { familyId: string; targets: MoneyRatioTargets; onSaved: (targets: MoneyRatioTargets) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const textsOf = (value: MoneyRatioTargets): Record<keyof MoneyRatioTargets, string> => ({
    variable: value.variable === null ? '' : String(value.variable),
    reserve: value.reserve === null ? '' : String(value.reserve),
    fixed: value.fixed === null ? '' : String(value.fixed),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState(() => textsOf(targets));
  const [saving, setSaving] = useState(false);

  const parsed = RATIO_ROWS.map((row) => (editing ? parsePercent(texts[row.key]) : targets[row.key]));
  const invalid = parsed.some((value) => value === undefined);
  const total = parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const anySet = parsed.some((value) => value !== null && value !== undefined);
  const over = total > 100;
  const savings = anySet ? `${100 - total}%` : '−';

  const toggle = () => {
    if (open) setEditing(false);
    setOpen(!open);
  };
  const startEdit = () => {
    setTexts(textsOf(targets));
    setEditing(true);
  };
  const save = async () => {
    if (invalid || over || saving) return;
    const next: MoneyRatioTargets = { variable: parsed[0] ?? null, reserve: parsed[1] ?? null, fixed: parsed[2] ?? null };
    setSaving(true);
    try {
      await saveMoneyRatioTargets(supabase, familyId, next);
      onSaved(next);
      setEditing(false);
    } catch {
      window.alert('保存できませんでした。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border-t border-gray-200 pt-2">
      <div className="flex items-center gap-2">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown size={14} className="shrink-0 text-gray-500" /> : <ChevronRight size={14} className="shrink-0 text-gray-500" />}
          <span className="shrink-0 text-[15px] font-extrabold text-gray-900">目標割合</span>
          {!open && (
            <span className="min-w-0 flex-1 truncate text-right text-xs font-semibold tabular-nums text-gray-500">
              {anySet ? `合計${total}%・貯金${100 - total}%` : '未設定'}
            </span>
          )}
        </button>
        {open && !editing && (
          <button type="button" onClick={startEdit} className="rounded-2xl bg-blue-100 px-3.5 py-1.5 text-[13px] font-bold text-blue-800 hover:bg-blue-200">
            編集
          </button>
        )}
        {open && editing && (
          <>
            <button type="button" onClick={() => setEditing(false)} className="px-2 py-1.5 text-[13px] font-bold text-blue-800">
              キャンセル
            </button>
            <button
              type="button"
              disabled={invalid || over || saving}
              onClick={() => void save()}
              className="rounded-2xl bg-blue-600 px-3.5 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              {saving ? '保存中' : '保存'}
            </button>
          </>
        )}
      </div>
      {open && (
        <>
          <div className="mt-2 flex gap-2">
            {RATIO_ROWS.map((row, index) => (
              <div key={row.key} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] bg-gray-100 px-1 py-2">
                <span className="text-[11px] font-semibold text-gray-500">{row.label}</span>
                {editing ? (
                  <label className="flex items-center gap-0.5">
                    <input
                      value={texts[row.key]}
                      onChange={(event) => setTexts((prev) => ({ ...prev, [row.key]: event.target.value }))}
                      inputMode="numeric"
                      placeholder="−"
                      maxLength={3}
                      aria-label={`${row.label}の目標（%）`}
                      className={`w-10 rounded-lg border bg-white px-1.5 py-[3px] text-right text-base font-extrabold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 ${parsed[index] === undefined ? 'border-red-500' : 'border-gray-300'}`}
                    />
                    <span className="text-[13px] font-semibold text-gray-500">%</span>
                  </label>
                ) : (
                  <span className="text-[17px] font-extrabold tabular-nums text-gray-900">{targets[row.key] === null ? '−' : `${targets[row.key]}%`}</span>
                )}
              </div>
            ))}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] bg-gray-100 px-1 py-2">
              <span className="text-[11px] font-semibold text-gray-500">貯金</span>
              <span className={`text-[17px] font-extrabold tabular-nums ${over ? 'text-red-600' : anySet ? 'text-green-700' : 'text-gray-900'}`}>{savings}</span>
            </div>
          </div>
          {editing && (
            <p className={`mt-2 text-xs font-medium ${over ? 'text-red-600' : 'text-gray-500'}`}>
              {over ? '合計が100%を超えています' : '収入に対して、種類ごとに何%までに収めたいか。固定費は確定と見込みで1つ。貯金は 100% − 合計。'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LegendRow({
  label,
  percent,
  amount,
  color,
  amountColor,
  main,
  selected,
  onClick,
}: {
  label: string;
  percent: string;
  amount: string;
  color?: string;
  amountColor?: string;
  main?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="mr-1.5 h-[9px] w-[9px] shrink-0 rounded-sm" style={color ? { backgroundColor: color } : undefined} />
      <span
        className={`w-[100px] shrink-0 truncate ${main ? 'text-[15px] font-extrabold text-gray-900' : 'text-sm font-medium text-gray-700'} ${selected ? '!text-blue-800' : ''}`}
      >
        {label}
      </span>
      <span className={`w-14 shrink-0 text-right text-xs font-semibold tabular-nums whitespace-pre text-gray-500 ${selected ? '!text-blue-800' : ''}`}>{percent}</span>
      <span
        className={`min-w-0 flex-1 truncate text-right tabular-nums ${main ? 'text-base font-extrabold' : 'text-sm font-semibold'} ${selected ? 'text-blue-800' : 'text-gray-900'}`}
        style={amountColor && !selected ? { color: amountColor } : undefined}
      >
        {amount}
      </span>
    </>
  );
  const className = `-mx-2 flex w-[calc(100%+16px)] items-center rounded-lg px-2 ${main ? 'py-1.5' : 'py-[3px]'} ${selected ? 'bg-blue-100' : ''}`;
  return onClick ? (
    <button type="button" aria-pressed={!!selected} onClick={onClick} className={`${className} text-left hover:bg-gray-50`}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

// ---- 一覧 ----

function BudgetRow({
  label,
  total,
  first,
  offLabel = '期間外',
  onClick,
}: {
  label: string;
  total: number;
  first: boolean;
  offLabel?: string;
  onClick: () => void;
}) {
  const off = total === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-1 py-[11px] text-left hover:bg-gray-100 ${first ? '' : dividedClass} ${off ? 'bg-gray-100' : ''}`}
    >
      <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${off ? 'text-gray-500' : 'text-gray-900'}`}>{label}</span>
      {off && <span className="shrink-0 rounded-md bg-gray-200 px-1.5 text-[11px] font-bold text-gray-700">{offLabel}</span>}
      <span className={`shrink-0 text-[15px] font-bold tabular-nums ${off ? 'text-gray-500' : 'text-gray-900'}`}>{formatYen(total)}</span>
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-100 py-3 text-[15px] font-bold text-blue-800 hover:bg-blue-200"
    >
      <Plus size={18} />
      {label}
    </button>
  );
}

/** 「項目 ……… 値 ›」の1行（押すと選ぶ画面）。 */
function SettingRow({
  label,
  value,
  onClick,
  first,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onClick: () => void;
  first?: boolean;
  placeholder?: boolean;
  /** 選び直せない（押せず、矢印も出さない）。 */
  disabled?: boolean;
}) {
  return (
    <button type="button" aria-label={`${label}を選ぶ`} disabled={disabled} onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass}`}>
      <span className="shrink-0 text-[15px] font-medium text-gray-500">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-right text-[15px] ${placeholder ? 'font-medium text-gray-400' : 'font-semibold text-gray-900'}`}>
        {value}
      </span>
      {!disabled && <ChevronRight size={16} className="shrink-0 text-gray-400" />}
    </button>
  );
}

/** 入・切のつまみ。 */
function Switch({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${value ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

// ---- 予算の枠 ----

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];

type FormSheet = 'group' | 'top' | 'category' | 'icon' | 'when' | 'period' | 'day' | 'wallet' | null;

/** 予算1件の枠（追加・編集）。分類（種類・大分類・小分類・品目）、予算（金額・いつ・期間）、自動記録。 */
function BudgetForm({
  rule,
  initialGroup,
  initialTopId,
  year,
  categories,
  wallets,
  stores,
  records,
  onCreateCategory,
  onCreateTop,
  onRenameCategory,
  onKidAdd,
  onKidUpdate,
  onKidRemove,
  onRemoveTop,
  onClose,
  onSubmit,
  onRemove,
}: {
  rule: MoneyRecurring | null;
  initialGroup: BudgetLineGroup;
  initialTopId: string | null;
  year: number;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  /** 収入の小分類を作る。 */
  onCreateCategory: (topId: string | null, name: string) => Promise<MoneyCategory | null>;
  /** 収入の大分類を作る。 */
  onCreateTop: (name: string) => Promise<MoneyCategory | null>;
  onRenameCategory: (category: MoneyCategory) => void;
  /** 変動費の大分類の小分類を、足す・直す（名前・移す）・消す。 */
  onKidAdd: (topId: string, name: string) => Promise<void>;
  onKidUpdate: (kid: MoneyCategory, fields: { name?: string; parentId?: string }) => Promise<void>;
  onKidRemove: (kid: MoneyCategory) => void;
  /** 変動費の大分類を消す（小分類と予算の行も消える）。 */
  onRemoveTop: (top: MoneyCategory) => void;
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, plan: CategoryPlan, registerStore: boolean) => Promise<void>;
  onRemove?: () => void;
}) {
  const topsOf = (group: BudgetLineGroup) =>
    group === 'income'
      ? topCategories(categories, 'income')
      : topCategories(categories, 'living').filter((top) => spendGroupOf(top.id, categories) === group);
  const [group, setGroup] = useState<BudgetLineGroup>(initialGroup);
  // 変動費は、いま直している大分類（無ければ新しく作る）。収入は選んだ大分類。
  const [topId, setTopId] = useState<string | null>(initialTopId ?? (initialGroup === 'income' ? (topsOf('income')[0]?.id ?? null) : null));
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const initialTop = categories.find((entry) => entry.id === initialTopId) ?? null;
  const initialOwn = categories.find((entry) => entry.id === rule?.categoryId) ?? null;
  // 変動費の大分類の名前とアイコン、固定費・予備費の名前（小分類の名前）。
  const [catName, setCatName] = useState(
    initialGroup === 'variable' ? (initialTop?.name ?? '') : isItemGroup(initialGroup) ? (initialOwn?.name ?? '') : '',
  );
  const [iconKey, setIconKey] = useState<string>(initialTop ? (initialTop.icon ?? guessIconKey(initialTop.name)) : 'other');
  const [iconColor, setIconColor] = useState<string | null>(initialTop?.iconColor ?? null);
  // 新しい変動費の大分類の小分類（保存するまで、この枠の中だけで持つ）。
  const [newKids, setNewKids] = useState<string[]>([]);
  const [kidSheet, setKidSheet] = useState<{ kidId: string | null; index: number | null } | null>(null);
  const [amountText, setAmountText] = useState(rule ? String(rule.amount) : '');
  const [mode, setMode] = useState<'monthly' | 'months' | 'none'>(rule?.noMonth ? 'none' : rule?.months ? 'months' : 'monthly');
  const [months, setMonths] = useState<number[]>(rule?.months ?? []);
  const [byInterval, setByInterval] = useState(rule?.intervalYears != null);
  const [intervalText, setIntervalText] = useState(rule?.intervalYears != null ? String(rule.intervalYears) : '2');
  const [startText, setStartText] = useState(periodMonthInput(rule?.startMonth ?? null));
  const [endText, setEndText] = useState(periodMonthInput(rule?.endMonth ?? null));
  // 品目（収入の、同じ小分類に予算が複数あるときの区別）。ほかの種類では今の値を残すだけ。
  const [name, setName] = useState(rule?.name ?? '');
  const [makesRecord, setMakesRecord] = useState(rule?.makesRecord ?? false);
  const [byWeekday, setByWeekday] = useState(rule?.weekOfMonth != null);
  const [dayText, setDayText] = useState(rule && rule.dayKnown && rule.weekOfMonth == null ? String(rule.day) : '');
  const [weekOfMonth, setWeekOfMonth] = useState<number | null>(rule?.weekOfMonth ?? null);
  const [weekday, setWeekday] = useState<number | null>(rule?.weekday ?? null);
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(rule?.holiday ?? (initialGroup === 'income' ? 'prev' : 'next'));
  const [walletId, setWalletId] = useState<string | null>(rule?.walletId ?? null);
  const [store, setStore] = useState(rule?.store ?? '');
  const [registerStore, setRegisterStore] = useState(false);
  // 収入の自動記録の額: 毎回同じ（確定）か、変わる（見込み）。支出は種類で決まる。
  const [incomeFixed, setIncomeFixed] = useState(rule?.amountMode === 'fixed');
  const [sheet, setSheet] = useState<FormSheet>(null);
  const [pickingStore, setPickingStore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateString(new Date())), [stores, records]);

  const isIncome = group === 'income';
  const noMonth = mode === 'none';
  const auto = makesRecord && !noMonth;
  const top = categories.find((entry) => entry.id === topId) ?? null;
  const topKids = top && group === 'variable' ? childCategories(categories, top.id) : [];
  /** 種類を変えられるか。変動費・収入は、消して作り直す（固定費・予備費の間だけ、小分類が選んだ種類へ移る）。 */
  const typeLocked = rule !== null && !isItemGroup(initialGroup);
  const selectedCategory = categories.find((entry) => entry.id === categoryId) ?? null;
  // 小分類の選択肢。変動費・収入は選んだ大分類（まとめての予算は大分類そのもの）、ほかはその種類の小分類。
  const categoryChoices: { category: MoneyCategory; label: string }[] = choosesTop(group)
    ? top
      ? [{ category: top, label: 'まとめて（大分類）' }, ...childCategories(categories, top.id).map((entry) => ({ category: entry, label: entry.name }))]
      : []
    : topsOf(group).flatMap((entry) => childCategories(categories, entry.id).map((child) => ({ category: child, label: child.name })));
  const categoryLabel = selectedCategory === null ? '選ぶ' : selectedCategory.parentId === null ? 'まとめて（大分類）' : selectedCategory.name;

  /** 種類の選択肢。直すときは、固定費・予備費の間だけ（変動費・収入は、消して作り直す）。 */
  const groupChoices: BudgetLineGroup[] = rule !== null ? GROUPS.filter(isItemGroup) : GROUPS;

  const changeGroup = (next: BudgetLineGroup) => {
    setSheet(null);
    if (next === group) return;
    setGroup(next);
    setTopId(next === 'income' ? (topsOf('income')[0]?.id ?? null) : null);
    // 収入の小分類は、収入と支出をまたぐなら選び直す。固定費・予備費は、保存のときに選んだ種類へ移す。
    const own = selectedCategory;
    if (own === null || own.parentId === null || (own.kind === 'income') !== (next === 'income')) setCategoryId(null);
  };

  const build = (): MoneyRecurringDraft | string => {
    if (group === 'variable') {
      if (catName.trim() === '') return '名前を入れてください';
      const same = topsOf('variable').some((entry) => entry.id !== topId && entry.name === catName.trim());
      if (same) return '同じ名前の大分類があります';
    } else if (isItemGroup(group)) {
      if (catName.trim() === '') return '名前を入れてください';
      const parent = topsOf(group)[0];
      const same = parent ? childCategories(categories, parent.id).some((entry) => entry.id !== initialOwn?.id && entry.name === catName.trim()) : false;
      if (same) return '同じ名前があります';
    } else {
      if (topId === null) return '大分類を選んでください';
      if (selectedCategory === null) return '小分類を選んでください';
    }
    const amount = parseAmountInput(amountText);
    if (amountText.trim() === '' || amount === null) return '金額は0以上の整数（円）で入れてください';
    if (mode === 'months' && months.length === 0) return '発生する月を選んでください';
    const startMonth = parsePeriodMonth(startText);
    const endMonth = parsePeriodMonth(endText);
    if (startMonth === undefined || endMonth === undefined) return '期間は「2027/9」の形で入れてください（ずっとなら空）';
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return '期間の終わりを始まりより後にしてください';
    const intervalYears = byInterval ? Number(intervalText.trim()) : null;
    if (intervalYears !== null) {
      if (!Number.isInteger(intervalYears) || intervalYears < 2 || intervalYears > 10) return '何年ごとかを 2〜10 で入れてください';
      if (startMonth === null) return '◯年ごとは、期間の始まり（最初の回の月）を入れてください';
    }
    let day = rule?.day ?? 1;
    if (auto) {
      if (byWeekday) {
        if (weekOfMonth === null || weekday === null) return '第何週の何曜日かを選んでください';
        day = 1;
      } else {
        day = Number(dayText.trim());
        if (!Number.isInteger(day) || day < 1 || day > 31) return `${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`;
      }
      if (walletId === null) return isIncome ? '入金先を選んでください' : '出金元を選んでください';
    }
    return {
      kind: isIncome ? 'income' : 'expense',
      day,
      weekOfMonth: auto && byWeekday ? weekOfMonth : null,
      weekday: auto && byWeekday ? weekday : null,
      months: mode === 'months' ? months : null,
      startMonth,
      endMonth,
      holiday,
      amountMode: group === 'income' ? (incomeFixed ? 'fixed' : 'estimate') : amountModeOfGroup(group),
      amount,
      walletId,
      toWalletId: null,
      store: isIncome ? '' : store,
      categoryId: group === 'income' ? (selectedCategory?.id ?? null) : (rule?.categoryId ?? null),
      name,
      makesRecord: auto,
      skippedMonths: rule?.skippedMonths ?? [],
      intervalYears,
      dayKnown: auto,
      noMonth,
    };
  };
  const draft = build();
  const preview =
    typeof draft === 'string'
      ? null
      : (() => {
          const asRule = { ...draft, id: '', position: 0, archived: false, createdAt: '', deferredUntil: null };
          const line = budgetLineOf(asRule);
          return { count: budgetLineCount(line, year), total: group === 'estimate' ? estimatedBudgetYearAmount(asRule, year, records) : budgetLineYearAmount(line, year) };
        })();

  const submit = async () => {
    const result = build();
    if (typeof result === 'string') return setError(result);
    setError(null);
    setSaving(true);
    try {
      const plan: CategoryPlan =
        group === 'variable'
          ? { group, topId, name: catName, icon: iconKey, iconColor, newKids }
          : isItemGroup(group)
            ? { group, name: catName }
            : { group };
      await onSubmit(result, plan, result.store !== '' && registerStore);
    } finally {
      setSaving(false);
    }
  };

  if (pickingStore) {
    return (
      <StackedScreen onBack={() => setPickingStore(false)}>
        <StorePicker
          value={store}
          registered={storeOptions.registered}
          others={storeOptions.others}
          canRegister
          onPick={(value, register) => {
            setStore(value);
            setRegisterStore(register);
            setPickingStore(false);
          }}
          onClose={() => setPickingStore(false)}
        />
      </StackedScreen>
    );
  }

  const when = noMonth ? '発生月なし' : mode === 'monthly' ? '毎月' : months.length === 0 ? '選ぶ' : monthsLabel(months);
  const whenValue = byInterval ? `${when}・${intervalText.trim() || '?'}年ごと` : when;
  const periodValue = startText.trim() === '' && endText.trim() === '' ? 'ずっと' : `${startText.trim()}〜${endText.trim()}`;
  const dayValue = byWeekday
    ? weekOfMonth !== null && weekday !== null
      ? recurringDayLabel({ day: 1, weekOfMonth, weekday })
      : '選ぶ'
    : dayText.trim() === ''
      ? '選ぶ'
      : recurringDayLabel({ day: Number(dayText.trim()) || 1 });
  const wallet = wallets.find((entry) => entry.id === walletId);
  const toggleMonth = (month: number) =>
    setMonths((prev) => (prev.includes(month) ? prev.filter((value) => value !== month) : [...prev, month].sort((a, b) => a - b)));

  return (
    <>
      <ScreenHeader title={rule ? '予算を直す' : '予算を追加'} icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-3 pb-8 space-y-3">
        <p className="px-1 text-[13px] font-bold text-gray-500">分類</p>
        <div className={groupClass}>
          <SettingRow first label="種類" value={GROUP_LABEL[group]} disabled={typeLocked} onClick={() => setSheet('group')} />
          {group === 'variable' && (
            <>
              <label className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
                <span className="shrink-0 text-[15px] font-medium text-gray-500">名前</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] text-gray-900 focus:outline-none"
                  value={catName}
                  onChange={(event) => setCatName(event.target.value)}
                  placeholder="例: 食費"
                  aria-label="名前"
                />
              </label>
              <button
                type="button"
                aria-label="アイコンと色を選ぶ"
                onClick={() => setSheet('icon')}
                className={`flex min-h-[46px] w-full items-center gap-2.5 px-3.5 py-2.5 text-left ${dividedClass}`}
              >
                <span className="flex-1 text-[15px] font-medium text-gray-500">アイコン</span>
                <CategoryIcon iconKey={iconColor ? `${iconKey}|${iconColor}` : iconKey} size={30} />
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </button>
              <div className={`flex flex-col gap-2 px-3.5 py-2.5 ${dividedClass}`}>
                <span className="text-[15px] font-medium text-gray-500">小分類</span>
                <div className="flex flex-wrap gap-1.5">
                  {topKids.map((kid) => (
                    <button
                      key={kid.id}
                      type="button"
                      onClick={() => setKidSheet({ kidId: kid.id, index: null })}
                      className="rounded-lg bg-gray-100 px-3 py-2 text-[15px] font-semibold text-gray-900"
                    >
                      {kid.name}
                    </button>
                  ))}
                  {top === null &&
                    newKids.map((kidName, index) => (
                      <button
                        key={`new-${index}`}
                        type="button"
                        onClick={() => setKidSheet({ kidId: null, index })}
                        className="rounded-lg bg-gray-100 px-3 py-2 text-[15px] font-semibold text-gray-900"
                      >
                        {kidName}
                      </button>
                    ))}
                  <button
                    type="button"
                    aria-label="小分類を足す"
                    onClick={() => setKidSheet({ kidId: null, index: null })}
                    className="flex items-center gap-0.5 rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600"
                  >
                    <Plus size={14} />
                    小分類
                  </button>
                </div>
              </div>
            </>
          )}
          {isItemGroup(group) && (
            <label className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
              <span className="shrink-0 text-[15px] font-medium text-gray-500">名前</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-right text-[15px] text-gray-900 focus:outline-none"
                value={catName}
                onChange={(event) => setCatName(event.target.value)}
                placeholder="例: 家賃"
                aria-label="名前"
              />
            </label>
          )}
          {group === 'income' && (
            <>
              <SettingRow label="大分類" value={top?.name ?? '選ぶ'} placeholder={top === null} onClick={() => setSheet('top')} />
              <SettingRow label="小分類" value={categoryLabel} placeholder={selectedCategory === null} onClick={() => setSheet('category')} />
              <label className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
                <span className="shrink-0 text-[15px] font-medium text-gray-500">品目</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] text-gray-900 focus:outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="品目"
                />
              </label>
            </>
          )}
        </div>
        <p className="px-1 text-xs font-medium text-gray-500">
          {(group === 'variable'
            ? '変動費は、1つの大分類が予算の1行です。小分類は、記録の分類に使います。'
            : isItemGroup(group)
              ? 'この名前が、記録のカテゴリ（小分類）の名前にもなります。'
              : '品目は、同じ小分類に予算が複数あるときの区別に使います。') + (typeLocked ? '種類を変えるときは、消して作り直します。' : '')}
        </p>

        <p className="px-1 text-[13px] font-bold text-gray-500">予算</p>
        <div className={groupClass}>
          <label className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[15px] font-medium text-gray-500">金額</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-right text-base font-bold tabular-nums text-gray-900 focus:outline-none"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              aria-label="金額"
            />
            <span className="text-[15px] text-gray-500">円</span>
          </label>
          <SettingRow label="いつ" value={whenValue} onClick={() => setSheet('when')} />
          <SettingRow label="期間" value={periodValue} placeholder={periodValue === 'ずっと'} onClick={() => setSheet('period')} />
        </div>

        {group === 'estimate' && <p className="px-1 text-xs font-medium text-gray-500">前年の同じ月の記録があれば、その額で見込みます。無ければ、ここの金額を使います（自動記録も同じ額で作ります）。</p>}
        <p className="px-1 text-[13px] font-bold text-gray-500">自動記録</p>
        <div className={groupClass}>
          <div className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="flex-1 text-[15px] font-medium text-gray-500">自動で記録する</span>
            <Switch label="自動で記録する" value={auto} disabled={noMonth} onChange={setMakesRecord} />
          </div>
          {auto && (
            <>
              <SettingRow
                label={isIncome ? '振込日' : '日'}
                value={dayValue === '選ぶ' ? '選ぶ' : `${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`}
                placeholder={dayValue === '選ぶ'}
                onClick={() => setSheet('day')}
              />
              <SettingRow label={isIncome ? '入金先' : '出金元'} value={wallet?.name ?? '選ぶ'} placeholder={!wallet} onClick={() => setSheet('wallet')} />
              {isIncome ? (
                <div className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
                  <span className="flex-1 text-[15px] font-medium text-gray-500">毎回同じ額</span>
                  <Switch label="毎回同じ額" value={incomeFixed} onChange={setIncomeFixed} />
                </div>
              ) : (
                <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onClick={() => setPickingStore(true)} />
              )}
            </>
          )}
        </div>

        {preview && (
          <div className="flex justify-between px-1 text-[15px] font-bold text-gray-900">
            <span>{formatYear(year)}</span>
            <span className="tabular-nums">{`${formatYen(preview.total)}（${preview.count}回）`}</span>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <PrimaryButton label="保存する" disabled={saving} onClick={() => void submit()} />
        {group === 'variable' && top !== null ? (
          <button type="button" onClick={() => onRemoveTop(top)} className="w-full py-2.5 text-sm font-bold text-red-600">
            この大分類を消す
          </button>
        ) : (
          onRemove && (
            <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
              {isItemGroup(group) ? 'この品目を消す' : 'この予算を消す'}
            </button>
          )
        )}
      </div>

      {sheet === 'group' && (
        <ModalShell title="種類" onClose={() => setSheet(null)} footer={null}>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {groupChoices.map((entry, index) => (
              <OptionRow key={entry} first={index === 0} label={GROUP_LABEL[entry]} selected={entry === group} onClick={() => changeGroup(entry)} />
            ))}
          </div>
        </ModalShell>
      )}
      {sheet === 'icon' && (
        <CategoryIconPicker
          icon={iconKey}
          iconColor={iconColor}
          onClose={() => setSheet(null)}
          onSubmit={(icon, color) => {
            setIconKey(icon);
            setIconColor(color);
            setSheet(null);
          }}
        />
      )}
      {kidSheet !== null && (
        <KidSheet
          key={kidSheet.kidId ?? `local-${kidSheet.index ?? 'new'}`}
          kid={kidSheet.kidId !== null ? (categories.find((entry) => entry.id === kidSheet.kidId) ?? null) : null}
          localName={kidSheet.index !== null ? (newKids[kidSheet.index] ?? null) : null}
          topChoices={topsOf('variable').map((entry) => ({ id: entry.id, name: entry.name }))}
          takenNames={(top ? topKids.map((entry) => entry.name) : newKids).filter((entry) => entry !== (kidSheet.kidId !== null ? categories.find((c) => c.id === kidSheet.kidId)?.name : kidSheet.index !== null ? newKids[kidSheet.index] : undefined))}
          onClose={() => setKidSheet(null)}
          onSubmit={(value, parentId) => {
            const sheetKid = kidSheet.kidId !== null ? (categories.find((entry) => entry.id === kidSheet.kidId) ?? null) : null;
            setKidSheet(null);
            if (sheetKid !== null) {
              const fields = { ...(value !== sheetKid.name && { name: value }), ...(parentId !== sheetKid.parentId && parentId !== null && { parentId }) };
              if (Object.keys(fields).length > 0) void onKidUpdate(sheetKid, fields);
            } else if (kidSheet.index !== null) {
              const index = kidSheet.index;
              setNewKids((prev) => prev.map((entry, i) => (i === index ? value : entry)));
            } else if (top !== null) {
              void onKidAdd(top.id, value);
            } else {
              setNewKids((prev) => [...prev, value]);
            }
          }}
          onRemove={() => {
            const sheetKid = kidSheet.kidId !== null ? (categories.find((entry) => entry.id === kidSheet.kidId) ?? null) : null;
            const index = kidSheet.index;
            setKidSheet(null);
            if (sheetKid !== null) onKidRemove(sheetKid);
            else if (index !== null) setNewKids((prev) => prev.filter((_, i) => i !== index));
          }}
        />
      )}
      {sheet === 'top' && (
        <NameSheet
          title="大分類"
          placeholder="新しい大分類の名前"
          choices={topsOf(group).map((entry) => ({ id: entry.id, label: entry.name }))}
          selectedId={topId}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setTopId(id);
            // まとめて（大分類）を選んでいたら、選んだ大分類のまとめてにする。
            if (selectedCategory !== null && selectedCategory.parentId === null) setCategoryId(id);
            setSheet(null);
          }}
          onCreate={async (newName) => {
            const created = await onCreateTop(newName);
            if (created) {
              setTopId(created.id);
              if (selectedCategory !== null && selectedCategory.parentId === null) setCategoryId(created.id);
            }
            setSheet(null);
          }}
        />
      )}
      {sheet === 'category' && (
        <NameSheet
          title="小分類"
          placeholder="新しい小分類の名前"
          choices={categoryChoices.map((entry) => ({ id: entry.category.id, label: entry.label }))}
          renameLabel="選んでいる小分類の名前を直す"
          selectedId={categoryId}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setCategoryId(id);
            setSheet(null);
          }}
          onCreate={async (newName) => {
            const created = await onCreateCategory(topId, newName);
            if (created) setCategoryId(created.id);
            setSheet(null);
          }}
          onRename={
            selectedCategory !== null && selectedCategory.parentId !== null
              ? () => {
                  setSheet(null);
                  onRenameCategory(selectedCategory);
                }
              : undefined
          }
          onDelete={
            selectedCategory !== null && selectedCategory.parentId !== null
              ? () => {
                  setSheet(null);
                  onKidRemove(selectedCategory);
                }
              : undefined
          }
        />
      )}
      {sheet === 'when' && (
        <ModalShell title="いつ" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <div className="space-y-4">
            <Field label="発生月">
              <ChipRow>
                <Chip label="毎月" selected={mode === 'monthly'} onClick={() => setMode('monthly')} />
                <Chip label="月を選ぶ" selected={mode === 'months'} onClick={() => setMode('months')} />
                <Chip label="発生月なし" selected={mode === 'none'} onClick={() => setMode('none')} />
              </ChipRow>
              {mode === 'months' && (
                <ChipRow>
                  {MONTHS.map((month) => (
                    <Chip key={month} label={`${month}月`} selected={months.includes(month)} onClick={() => toggleMonth(month)} />
                  ))}
                </ChipRow>
              )}
            </Field>
            <Field label="頻度" hint={byInterval ? '期間の始まりの年から数えます' : undefined}>
              <ChipRow>
                <Chip label="毎年" selected={!byInterval} onClick={() => setByInterval(false)} />
                <Chip label="◯年ごと" selected={byInterval} onClick={() => setByInterval(true)} />
              </ChipRow>
              {byInterval && (
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClass} w-16 text-right tabular-nums`}
                    value={intervalText}
                    onChange={(event) => setIntervalText(event.target.value)}
                    inputMode="numeric"
                    placeholder="2"
                    aria-label="何年ごと"
                  />
                  <span className="text-sm font-semibold text-gray-500">年ごと</span>
                </div>
              )}
            </Field>
          </div>
        </ModalShell>
      )}
      {sheet === 'period' && (
        <ModalShell title="期間" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <Field label="始まり〜終わり（空ならずっと）">
            <div className="flex items-center gap-2">
              <input className={inputClass} value={startText} onChange={(event) => setStartText(event.target.value)} placeholder="例: 2027/9" aria-label="始まり" />
              <span className="text-sm font-semibold text-gray-500">〜</span>
              <input className={inputClass} value={endText} onChange={(event) => setEndText(event.target.value)} placeholder="例: 2033/3" aria-label="終わり" />
            </div>
          </Field>
        </ModalShell>
      )}
      {sheet === 'day' && (
        <ModalShell title={isIncome ? '振込日' : '日'} onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <div className="space-y-4">
            <ChipRow>
              <Chip label="日にち" selected={!byWeekday} onClick={() => setByWeekday(false)} />
              <Chip label="第◯◯曜日" selected={byWeekday} onClick={() => setByWeekday(true)} />
            </ChipRow>
            {byWeekday ? (
              <>
                <ChipRow>
                  {WEEK_OF_MONTH_OPTIONS.map((option) => (
                    <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onClick={() => setWeekOfMonth(option.value)} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Chip key={label} label={`${label}曜日`} selected={weekday === index} onClick={() => setWeekday(index)} />
                  ))}
                </ChipRow>
              </>
            ) : (
              <input
                className={`${inputClass} tabular-nums`}
                value={dayText}
                onChange={(event) => setDayText(event.target.value)}
                inputMode="numeric"
                placeholder="例: 27（末日は31）"
                aria-label="日"
              />
            )}
            <Field label="休日のとき">
              <ChipRow>
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onClick={() => setHoliday(entry)} />
                ))}
              </ChipRow>
            </Field>
          </div>
        </ModalShell>
      )}
      {sheet === 'wallet' && (
        <ModalShell title={isIncome ? '入金先' : '出金元'} onClose={() => setSheet(null)} footer={null}>
          <WalletChoices
            wallets={wallets}
            selectedId={walletId}
            onPick={(id) => {
              setWalletId(id);
              setSheet(null);
            }}
          />
        </ModalShell>
      )}
    </>
  );
}

function OptionRow({ label, selected, first, onClick }: { label: string; selected: boolean; first: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass}`}>
      <span className={`flex-1 text-[15px] text-gray-900 ${selected ? 'font-bold' : 'font-medium'}`}>{label}</span>
      {selected && <span className="text-[15px] font-bold text-blue-600">✓</span>}
    </button>
  );
}

/** 大分類・小分類を選ぶ。一番下で新しく作る。選んでいる小分類の名前もここから直す。 */
function NameSheet({
  title,
  placeholder,
  choices,
  selectedId,
  onClose,
  onPick,
  onCreate,
  onRename,
  renameLabel,
  onDelete,
}: {
  title: string;
  placeholder: string;
  choices: { id: string; label: string }[];
  selectedId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename?: () => void;
  renameLabel?: string;
  /** 選んでいる小分類を消す（確認は呼び出し側）。 */
  onDelete?: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={title} onClose={onClose} footer={null}>
      <div className="space-y-2">
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {choices.map((entry, index) => (
            <OptionRow key={entry.id} first={index === 0} label={entry.label} selected={entry.id === selectedId} onClick={() => onPick(entry.id)} />
          ))}
          <div className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${choices.length > 0 ? dividedClass : ''}`}>
            <Plus size={16} className="shrink-0 text-blue-600" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 focus:outline-none"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
              placeholder={placeholder}
              aria-label={placeholder}
            />
            {name.trim() !== '' && (
              <button type="button" onClick={() => void create()} className="shrink-0 text-sm font-bold text-blue-600">
                作る
              </button>
            )}
          </div>
        </div>
        {onRename && (
          <button type="button" onClick={onRename} className="w-full py-2.5 text-sm font-bold text-blue-600">
            {renameLabel}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className="w-full py-2.5 text-sm font-bold text-red-600">
            選んでいる小分類を消す
          </button>
        )}
      </div>
    </ModalShell>
  );
}

/** 変動費の大分類の小分類を、足す・直す（名前・別の大分類へ移す）・消す。 */
function KidSheet({
  kid,
  localName,
  topChoices,
  takenNames,
  onClose,
  onSubmit,
  onRemove,
}: {
  /** 直す小分類（DBにあるもの）。無ければ足す、または保存前の小分類。 */
  kid: MoneyCategory | null;
  /** 保存前の小分類の名前（新しい大分類の中だけにあるもの）。 */
  localName: string | null;
  topChoices: { id: string; name: string }[];
  /** ほかの小分類の名前（同じ名前は作れない）。 */
  takenNames: string[];
  onClose: () => void;
  onSubmit: (name: string, parentId: string | null) => void;
  onRemove: () => void;
}) {
  const editing = kid !== null || localName !== null;
  const [text, setText] = useState(kid?.name ?? localName ?? '');
  const [parentId, setParentId] = useState<string | null>(kid?.parentId ?? null);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const value = text.trim();
    if (value === '') return setError('名前を入れてください');
    if (takenNames.includes(value)) return setError('同じ名前の小分類があります');
    onSubmit(value, parentId);
  };
  return (
    <ModalShell title={editing ? '小分類を編集' : '小分類を足す'} onClose={onClose} footer={<PrimaryButton label={editing ? '保存する' : '足す'} onClick={submit} />}>
      <div className="space-y-3">
        <input
          className={inputClass}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          autoFocus
          placeholder="例: 外食"
          aria-label="小分類の名前"
        />
        {kid !== null && topChoices.length > 1 && (
          <Field label="大分類" hint="選び直すと、この小分類をほかの大分類へ移します">
            <ChipRow>
              {topChoices.map((entry) => (
                <Chip key={entry.id} label={entry.name} selected={parentId === entry.id} onClick={() => setParentId(entry.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {editing && (
          <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
            この小分類を消す
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function RenameSheet({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <ModalShell title="名前を直す" onClose={onClose} footer={<PrimaryButton label="保存する" disabled={text.trim() === ''} onClick={() => onSubmit(text)} />}>
      <input className={inputClass} value={text} onChange={(event) => setText(event.target.value)} autoFocus placeholder="名前" aria-label="名前" />
    </ModalShell>
  );
}
