import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
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
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { useKeepScroll } from '@/hooks/useKeepScroll';
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
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import StorePicker from '@/components/money/StorePicker';
import CategoryEditor from '@/components/money/CategoryEditor';
import CategoryIconPicker from '@/components/money/CategoryIconPicker';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, WalletChoices } from '@/components/money/feedParts';

// 年間予算（docs/kakei.md §0.8。2026-10-24）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
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

/** 円グラフの色（支出の種類は青の濃淡。収支見込みは収入の緑、赤字は赤）。 */
const PART_COLOR: Record<SpendGroup, string> = {
  variable: '#1e3a8a',
  confirmed: '#3b82f6',
  estimate: '#93c5fd',
  reserve: '#cbd5e1',
};
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
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [stack, setStack] = useState<Screen[]>([{ type: 'list' }]);
  // 予算の編集から戻ったとき、一覧を直前の位置から始める。
  const keepList = useKeepScroll();
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
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

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
    Alert.alert(title, message.replace('{rules}', own.length > 0 ? `予算${own.length}行` : ''), [
      { text: 'やめる', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () =>
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
          })(),
      },
    ]);
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
    if (own === null) return removeRule(rule);
    const shared = recurring.some((entry) => !entry.archived && entry.id !== rule.id && entry.categoryId === own.id);
    if (shared) return removeRule(rule);
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
    removeRule(rule);
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

  const removeRule = (rule: MoneyRecurring) =>
    Alert.alert('この予算を消しますか？', 'すべての年から消えます。自動で作った記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              await deleteMoneyRecurring(supabase, rule.id);
              onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
              pop();
            } catch {
              failed();
            }
          })(),
      },
    ]);

  const onRequestClose = () => {
    if (renaming !== null) return setRenaming(null);
    if (stack.length > 1) return pop();
    onClose();
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
        <View key={group} style={styles.section}>
          <Pressable
            accessibilityRole={filtered ? undefined : 'button'}
            accessibilityState={filtered ? undefined : { expanded: open }}
            disabled={filtered}
            onPress={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              })
            }
            style={[styles.sectionHead, group === 'income' ? styles.sectionHeadIncome : null]}
          >
            {!filtered && (open ? <ChevronDown size={14} color={colors.textMuted} /> : <ChevronRight size={14} color={colors.textMuted} />)}
            <Text style={styles.sectionTitle}>{GROUP_LABEL[group]}</Text>
            <View style={styles.flex} />
            <Text style={styles.sectionTotal}>{formatYen(total)}</Text>
          </Pressable>
          {open && content}
        </View>
      );
    };
    const ruleList = (group: Exclude<BudgetLineGroup, 'variable'>) => (
      <View>
        {sections[group].map((entry, index) => (
          <BudgetRow
            key={entry.rule.id}
            first={index === 0}
            label={rowLabel(entry.rule)}
            total={entry.total}
            onPress={() => push({ type: 'form', ruleId: entry.rule.id })}
          />
        ))}
        {sections[group].length === 0 && <Text style={styles.empty}>予算がまだありません</Text>}
      </View>
    );
    const variableList = (
      <View>
        {[...variableTops]
          .sort((a, b) => Number(a.total === 0) - Number(b.total === 0))
          .map((entry, index) => (
            <BudgetRow
              key={entry.top.id}
              first={index === 0}
              label={entry.top.name}
              total={entry.total}
              offLabel="予算なし"
              onPress={() => {
                const own = variableRuleOf(entry.top.id);
                push({ type: 'form', ruleId: own?.id ?? null, group: 'variable', topId: entry.top.id });
              }}
            />
          ))}
      </View>
    );
    body = (
      <>
        <ScreenHeader
          title="年間予算"
          onClose={onClose}
          right={
            <Pressable accessibilityRole="button" accessibilityLabel="カテゴリ（アイコン・色・並べ替え）" onPress={() => setEditingCategories(true)} style={styles.categoryButton}>
              <Text style={styles.categoryButtonText}>カテゴリ</Text>
            </Pressable>
          }
        />
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="前の年" onPress={() => setYear((current) => current - 1)} hitSlop={8} style={styles.yearButton}>
            <ChevronLeft size={18} color={colors.textSubtle} />
          </Pressable>
          <Text style={styles.year}>{formatYear(year)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="次の年" onPress={() => setYear((current) => current + 1)} hitSlop={8} style={styles.yearButton}>
            <ChevronRight size={18} color={colors.textSubtle} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} {...keepList}>
          <View style={styles.overview}>
            <Donut income={totals.income} parts={SPEND_GROUPS.map((group) => ({ group, amount: totals[group] }))} />
            <LegendRow
              main
              color={balance >= 0 ? colors.moneyIncome : DEFICIT_COLOR}
              label="収支見込み"
              percent=""
              amount={balance < 0 ? `−${formatYen(balance)}` : formatYen(balance)}
              amountColor={balance >= 0 ? colors.moneyIncome : DEFICIT_COLOR}
            />
            <LegendRow
              main
              label="収入"
              percent=""
              amount={formatYen(totals.income)}
              selected={selected === 'income'}
              onPress={() => setSelected((current) => (current === 'income' ? null : 'income'))}
            />
            <LegendRow
              main
              label="支出"
              percent=""
              amount={formatYen(expense)}
              selected={selected === 'expense'}
              onPress={() => setSelected((current) => (current === 'expense' ? null : 'expense'))}
            />
            {SPEND_GROUPS.map((group) => (
              <LegendRow
                key={group}
                color={PART_COLOR[group]}
                label={PART_LABEL[group]}
                percent={percentText(totals[group], totals.income)}
                amount={formatYen(totals[group])}
                selected={selected === group}
                onPress={() => setSelected((current) => (current === group ? null : group))}
              />
            ))}
            <RatioPanel familyId={familyId} targets={ratioTargets} onSaved={onRatioTargets} />
          </View>

          {shown('income') && section('income', ruleList('income'), totals.income)}
          {shown('variable') && section('variable', variableList, totals.variable)}
          {shown('reserve') && section('reserve', ruleList('reserve'), totals.reserve)}
          {shown('confirmed') && section('confirmed', ruleList('confirmed'), totals.confirmed)}
          {shown('estimate') && section('estimate', ruleList('estimate'), totals.estimate)}
          {selected === null && orphans.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>カテゴリなし</Text>
              </View>
              <View>
                {orphans.map((rule, index) => (
                  <BudgetRow key={rule.id} first={index === 0} label={rowLabel(rule)} total={yearTotal(rule)} onPress={() => push({ type: 'form', ruleId: rule.id })} />
                ))}
              </View>
            </View>
          )}
          <AddButton label="予算を追加" onPress={() => push({ type: 'form', ruleId: null, group: selected === null || selected === 'expense' ? 'variable' : selected })} />
        </ScrollView>
      </>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onRequestClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        {body}
      </View>
      {renaming !== null && <RenameSheet name={renaming.name} onClose={() => setRenaming(null)} onSubmit={(name) => void rename(renaming, name)} />}
      {editingCategories && (
        <CategoryEditor familyId={familyId} categories={categories} onCategories={onCategories} onClose={() => setEditingCategories(false)} />
      )}
    </Modal>
  );
}

// ---- 上の枠 ----

const DONUT_SIZE = 168;

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
    if (!deficit && income > expense) arcs.push({ key: 'balance', color: colors.moneyIncome, length: circumference - offset, offset });
  }
  const outer = 74;
  const outerCircumference = 2 * Math.PI * outer;
  // はみ出し（収入に対する割合。収入が無ければ1周）。
  const over = deficit ? Math.min(1, income > 0 ? (expense - income) / income : 1) * outerCircumference : 0;
  const centerText = income >= 10000 ? `¥${Math.round(income / 10000).toLocaleString('ja-JP')}万` : formatYen(income);
  return (
    <View style={styles.donut}>
      <Svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox="0 0 160 160">
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={colors.neutralSurface} strokeWidth={18} />
        {arcs.map((arc) => (
          <Circle
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
          <Circle
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
        <SvgText x={center} y={70} textAnchor="middle" fontSize={10} fontWeight="700" fill={colors.textMuted}>
          収入
        </SvgText>
        <SvgText x={center} y={88} textAnchor="middle" fontSize={16} fontWeight="800" fill={colors.text}>
          {centerText}
        </SvgText>
      </Svg>
    </View>
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
  onPress,
}: {
  label: string;
  percent: string;
  amount: string;
  color?: string;
  amountColor?: string;
  main?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.legend, main && styles.legendMain, selected && styles.legendSelected]}
    >
      <View style={[styles.legendSwatch, color ? { backgroundColor: color } : null]} />
      <Text style={[main ? styles.legendMainLabel : styles.legendLabel, selected && styles.selectedText]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.legendPercent, selected && styles.selectedText]}>{percent}</Text>
      <Text
        style={[main ? styles.legendMainAmount : styles.legendAmount, amountColor ? { color: amountColor } : null, selected && styles.selectedText]}
        numberOfLines={1}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

// ---- 一覧 ----

function BudgetRow({
  label,
  total,
  first,
  offLabel = '期間外',
  onPress,
}: {
  label: string;
  total: number;
  first: boolean;
  offLabel?: string;
  onPress: () => void;
}) {
  const off = total === 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.divided, off && styles.rowOff, pressed && styles.pressed]}
    >
      <Text style={[styles.rowLabel, off && styles.offText]} numberOfLines={1}>
        {label}
      </Text>
      {off && <Text style={styles.offBadge}>{offLabel}</Text>}
      <Text style={[styles.rowAmount, off && styles.offText]}>{formatYen(total)}</Text>
    </Pressable>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}>
      <Plus size={18} color={colors.moneyText} />
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

/** 「項目 ……… 値 ›」の1行（押すと選ぶ画面）。 */
function SettingRow({
  label,
  value,
  onPress,
  first,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  first?: boolean;
  placeholder?: boolean;
  /** 選び直せない（押せず、矢印も出さない）。 */
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}を選ぶ`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={[styles.settingValue, placeholder && styles.mutedValue]} numberOfLines={1}>
        {value}
      </Text>
      {!disabled && <ChevronRight size={16} color={colors.textFaint} />}
    </Pressable>
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
  // お店を選ぶ画面から戻ったとき、入力の途中の位置から始める。
  const keepForm = useKeepScroll();
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

  return (
    <>
      <ScreenHeader title={rule ? '予算を直す' : '予算を追加'} icon="back" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" {...keepForm}>
        <Text style={styles.groupTitle}>分類</Text>
        <View style={styles.group}>
          <SettingRow first label="種類" value={GROUP_LABEL[group]} disabled={typeLocked} onPress={() => setSheet('group')} />
          {group === 'variable' && (
            <>
              <View style={[styles.item, styles.divided]}>
                <Text style={styles.settingLabel}>名前</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={catName}
                  onChangeText={setCatName}
                  placeholder="例: 食費"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="名前"
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="アイコンと色を選ぶ"
                onPress={() => setSheet('icon')}
                style={({ pressed }) => [styles.item, styles.divided, pressed && styles.pressed]}
              >
                <Text style={[styles.settingLabel, styles.flex]}>アイコン</Text>
                <CategoryIcon iconKey={iconColor ? `${iconKey}|${iconColor}` : iconKey} size={30} />
                <ChevronRight size={16} color={colors.textFaint} />
              </Pressable>
              <View style={[styles.kidBlock, styles.divided]}>
                <Text style={styles.settingLabel}>小分類</Text>
                <View style={styles.kidChips}>
                  {topKids.map((kid) => (
                    <Pressable key={kid.id} accessibilityRole="button" onPress={() => setKidSheet({ kidId: kid.id, index: null })} style={styles.kidChip}>
                      <Text style={styles.kidChipText}>{kid.name}</Text>
                    </Pressable>
                  ))}
                  {top === null &&
                    newKids.map((kidName, index) => (
                      <Pressable key={`new-${index}`} accessibilityRole="button" onPress={() => setKidSheet({ kidId: null, index })} style={styles.kidChip}>
                        <Text style={styles.kidChipText}>{kidName}</Text>
                      </Pressable>
                    ))}
                  <Pressable accessibilityRole="button" accessibilityLabel="小分類を足す" onPress={() => setKidSheet({ kidId: null, index: null })} style={[styles.kidChip, styles.kidAdd]}>
                    <Plus size={14} color={colors.money} />
                    <Text style={styles.kidAddText}>小分類</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}
          {isItemGroup(group) && (
            <View style={[styles.item, styles.divided]}>
              <Text style={styles.settingLabel}>名前</Text>
              <TextInput
                style={styles.inlineInput}
                value={catName}
                onChangeText={setCatName}
                placeholder="例: 家賃"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="名前"
              />
            </View>
          )}
          {group === 'income' && (
            <>
              <SettingRow label="大分類" value={top?.name ?? '選ぶ'} placeholder={top === null} onPress={() => setSheet('top')} />
              <SettingRow label="小分類" value={categoryLabel} placeholder={selectedCategory === null} onPress={() => setSheet('category')} />
              <View style={[styles.item, styles.divided]}>
                <Text style={styles.settingLabel}>品目</Text>
                <TextInput style={styles.inlineInput} value={name} onChangeText={setName} accessibilityLabel="品目" />
              </View>
            </>
          )}
        </View>
        <Text style={styles.groupHint}>
          {(group === 'variable'
            ? '変動費は、1つの大分類が予算の1行です。小分類は、記録の分類に使います。'
            : isItemGroup(group)
              ? 'この名前が、記録のカテゴリ（小分類）の名前にもなります。'
              : '品目は、同じ小分類に予算が複数あるときの区別に使います。') + (typeLocked ? '種類を変えるときは、消して作り直します。' : '')}
        </Text>

        <Text style={styles.groupTitle}>予算</Text>
        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={styles.settingLabel}>金額</Text>
            <TextInput
              style={[styles.inlineInput, styles.amountInput]}
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.yen}>円</Text>
          </View>
          <SettingRow label="いつ" value={whenValue} onPress={() => setSheet('when')} />
          <SettingRow label="期間" value={periodValue} placeholder={periodValue === 'ずっと'} onPress={() => setSheet('period')} />
        </View>

        {group === 'estimate' && <Text style={styles.groupHint}>前年の同じ月の記録があれば、その額で見込みます。無ければ、ここの金額を使います（自動記録も同じ額で作ります）。</Text>}
        <Text style={styles.groupTitle}>自動記録</Text>
        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={[styles.settingLabel, styles.flex]}>自動で記録する</Text>
            <Switch
              value={auto}
              disabled={noMonth}
              onValueChange={setMakesRecord}
              trackColor={{ true: colors.money, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
          {auto && (
            <>
              <SettingRow
                label={isIncome ? '振込日' : '日'}
                value={dayValue === '選ぶ' ? '選ぶ' : `${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`}
                placeholder={dayValue === '選ぶ'}
                onPress={() => setSheet('day')}
              />
              <SettingRow label={isIncome ? '入金先' : '出金元'} value={wallet?.name ?? '選ぶ'} placeholder={!wallet} onPress={() => setSheet('wallet')} />
              {isIncome ? (
                <View style={[styles.item, styles.divided]}>
                  <Text style={[styles.settingLabel, styles.flex]}>毎回同じ額</Text>
                  <Switch
                    value={incomeFixed}
                    onValueChange={setIncomeFixed}
                    trackColor={{ true: colors.money, false: colors.borderStrong }}
                    thumbColor={colors.surface}
                  />
                </View>
              ) : (
                <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onPress={() => setPickingStore(true)} />
              )}
            </>
          )}
        </View>

        {preview && (
          <View style={styles.total}>
            <Text style={styles.totalLabel}>{formatYear(year)}</Text>
            <Text style={styles.totalValue}>{`${formatYen(preview.total)}（${preview.count}回）`}</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="保存する" disabled={saving} onPress={() => void submit()} />
        {group === 'variable' && top !== null ? (
          <Pressable accessibilityRole="button" onPress={() => onRemoveTop(top)} style={styles.linkRow}>
            <Text style={styles.dangerText}>この大分類を消す</Text>
          </Pressable>
        ) : (
          onRemove && (
            <Pressable accessibilityRole="button" onPress={onRemove} style={styles.linkRow}>
              <Text style={styles.dangerText}>{isItemGroup(group) ? 'この品目を消す' : 'この予算を消す'}</Text>
            </Pressable>
          )
        )}
      </ScrollView>

      {sheet === 'group' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="種類" onClose={() => setSheet(null)}>
            <View style={styles.options}>
              {groupChoices.map((entry, index) => (
                <OptionRow key={entry} first={index === 0} label={GROUP_LABEL[entry]} selected={entry === group} onPress={() => changeGroup(entry)} />
              ))}
            </View>
          </LogModalShell>
        </SheetModal>
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
          renameLabel="選んでいる小分類の名前を直す"
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
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="いつ" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <Field label="発生月">
              <ChipRow>
                <Chip label="毎月" selected={mode === 'monthly'} onPress={() => setMode('monthly')} />
                <Chip label="月を選ぶ" selected={mode === 'months'} onPress={() => setMode('months')} />
                <Chip label="発生月なし" selected={mode === 'none'} onPress={() => setMode('none')} />
              </ChipRow>
              {mode === 'months' && (
                <ChipRow>
                  {MONTHS.map((month) => (
                    <Chip
                      key={month}
                      label={`${month}月`}
                      selected={months.includes(month)}
                      onPress={() =>
                        setMonths((prev) => (prev.includes(month) ? prev.filter((value) => value !== month) : [...prev, month].sort((a, b) => a - b)))
                      }
                    />
                  ))}
                </ChipRow>
              )}
            </Field>
            <Field label="頻度" hint={byInterval ? '期間の始まりの年から数えます' : undefined}>
              <ChipRow>
                <Chip label="毎年" selected={!byInterval} onPress={() => setByInterval(false)} />
                <Chip label="◯年ごと" selected={byInterval} onPress={() => setByInterval(true)} />
              </ChipRow>
              {byInterval && (
                <View style={styles.inline}>
                  <TextInput
                    style={[styles.input, styles.short]}
                    value={intervalText}
                    onChangeText={setIntervalText}
                    keyboardType="number-pad"
                    placeholder="2"
                    placeholderTextColor={colors.textFaint}
                  />
                  <Text style={styles.inlineText}>年ごと</Text>
                </View>
              )}
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'period' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="期間" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <Field label="始まり〜終わり（空ならずっと）">
              <View style={styles.inline}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={startText}
                  onChangeText={setStartText}
                  placeholder="例: 2027/9"
                  placeholderTextColor={colors.textFaint}
                />
                <Text style={styles.inlineText}>〜</Text>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={endText}
                  onChangeText={setEndText}
                  placeholder="例: 2033/3"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'day' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title={isIncome ? '振込日' : '日'} onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <ChipRow>
              <Chip label="日にち" selected={!byWeekday} onPress={() => setByWeekday(false)} />
              <Chip label="第◯◯曜日" selected={byWeekday} onPress={() => setByWeekday(true)} />
            </ChipRow>
            {byWeekday ? (
              <>
                <ChipRow>
                  {WEEK_OF_MONTH_OPTIONS.map((option) => (
                    <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onPress={() => setWeekOfMonth(option.value)} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Chip key={label} label={`${label}曜日`} selected={weekday === index} onPress={() => setWeekday(index)} />
                  ))}
                </ChipRow>
              </>
            ) : (
              <TextInput
                style={styles.input}
                value={dayText}
                onChangeText={setDayText}
                keyboardType="number-pad"
                placeholder="例: 27（末日は31）"
                placeholderTextColor={colors.textFaint}
              />
            )}
            <Field label="休日のとき">
              <ChipRow>
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onPress={() => setHoliday(entry)} />
                ))}
              </ChipRow>
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'wallet' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title={isIncome ? '入金先' : '出金元'} onClose={() => setSheet(null)}>
            <WalletChoices
              wallets={wallets}
              selectedId={walletId}
              onPick={(id) => {
                setWalletId(id);
                setSheet(null);
              }}
            />
          </LogModalShell>
        </SheetModal>
      )}
    </>
  );
}

function OptionRow({ label, selected, first, onPress }: { label: string; selected: boolean; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={[styles.optionText, selected && styles.optionSelected]}>{label}</Text>
      {selected && <Text style={styles.check}>✓</Text>}
    </Pressable>
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
    <SheetModal visible onClose={onClose}>
      <LogModalShell title={title} onClose={onClose}>
        <View style={styles.options}>
          {choices.map((entry, index) => (
            <OptionRow key={entry.id} first={index === 0} label={entry.label} selected={entry.id === selectedId} onPress={() => onPick(entry.id)} />
          ))}
          <View style={[styles.item, choices.length > 0 && styles.divided]}>
            <Plus size={16} color={colors.money} />
            <TextInput
              style={[styles.inlineInput, styles.newInput]}
              value={name}
              onChangeText={setName}
              placeholder={placeholder}
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              onSubmitEditing={() => void create()}
            />
            {name.trim() !== '' && (
              <Pressable accessibilityRole="button" onPress={() => void create()} hitSlop={8}>
                <Text style={styles.linkText}>作る</Text>
              </Pressable>
            )}
          </View>
        </View>
        {onRename && (
          <Pressable accessibilityRole="button" onPress={onRename} style={styles.linkRow}>
            <Text style={styles.linkText}>{renameLabel}</Text>
          </Pressable>
        )}
        {onDelete && (
          <Pressable accessibilityRole="button" onPress={onDelete} style={styles.linkRow}>
            <Text style={styles.dangerText}>選んでいる小分類を消す</Text>
          </Pressable>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

/**
 * 目標割合（docs/kakei.md §0.9）。上の枠の下に折りたたんで出す（はじめは閉じる）。開くと、種類ごと（変動費・予備費・固定費）の
 * 目標と、貯金（100% − 合計）。「編集」でその場で直す（合計が100%を超えると保存できない。空は目標なし）。
 */
function RatioPanel({ familyId, targets, onSaved }: { familyId: string; targets: MoneyRatioTargets; onSaved: (targets: MoneyRatioTargets) => void }) {
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
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.ratio}>
      <View style={styles.ratioHead}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle} style={styles.ratioToggle}>
          {open ? <ChevronDown size={14} color={colors.textMuted} /> : <ChevronRight size={14} color={colors.textMuted} />}
          <Text style={styles.ratioTitle}>目標割合</Text>
          {!open && <Text style={styles.ratioSummary}>{anySet ? `合計${total}%・貯金${100 - total}%` : '未設定'}</Text>}
        </Pressable>
        {open && !editing && (
          <Pressable accessibilityRole="button" onPress={startEdit} style={styles.ratioButton}>
            <Text style={styles.ratioButtonText}>編集</Text>
          </Pressable>
        )}
        {open && editing && (
          <>
            <Pressable accessibilityRole="button" onPress={() => setEditing(false)} style={styles.ratioCancel}>
              <Text style={styles.ratioButtonText}>キャンセル</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={invalid || over || saving}
              onPress={() => void save()}
              style={[styles.ratioButton, styles.ratioSave, (invalid || over || saving) && styles.ratioDisabled]}
            >
              <Text style={[styles.ratioButtonText, styles.ratioSaveText]}>{saving ? '保存中' : '保存'}</Text>
            </Pressable>
          </>
        )}
      </View>
      {open && (
        <>
          <View style={styles.ratioTiles}>
            {RATIO_ROWS.map((row, index) => (
              <View key={row.key} style={styles.ratioTile}>
                <Text style={styles.ratioTileLabel}>{row.label}</Text>
                {editing ? (
                  <View style={styles.ratioInputRow}>
                    <TextInput
                      value={texts[row.key]}
                      onChangeText={(text) => setTexts((prev) => ({ ...prev, [row.key]: text }))}
                      keyboardType="number-pad"
                      placeholder="−"
                      placeholderTextColor={colors.textFaint}
                      maxLength={3}
                      accessibilityLabel={`${row.label}の目標（%）`}
                      style={[styles.ratioInput, parsed[index] === undefined && styles.ratioInputError]}
                    />
                    <Text style={styles.ratioUnit}>%</Text>
                  </View>
                ) : (
                  <Text style={styles.ratioTileValue}>{targets[row.key] === null ? '−' : `${targets[row.key]}%`}</Text>
                )}
              </View>
            ))}
            <View style={styles.ratioTile}>
              <Text style={styles.ratioTileLabel}>貯金</Text>
              <Text style={[styles.ratioTileValue, over ? styles.ratioOver : anySet ? styles.ratioSavings : null]}>{savings}</Text>
            </View>
          </View>
          {editing && (
            <Text style={[styles.ratioHint, over && styles.ratioOver]}>
              {over ? '合計が100%を超えています' : '収入に対して、種類ごとに何%までに収めたいか。固定費は確定と見込みで1つ。貯金は 100% − 合計。'}
            </Text>
          )}
        </>
      )}
    </View>
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
    <SheetModal visible onClose={onClose}>
      <LogModalShell title={editing ? '小分類を編集' : '小分類を足す'} onClose={onClose} footer={<PrimaryButton label={editing ? '保存する' : '足す'} onPress={submit} />}>
        <TextInput style={styles.input} value={text} onChangeText={setText} autoFocus placeholder="例: 外食" placeholderTextColor={colors.textFaint} accessibilityLabel="小分類の名前" />
        {kid !== null && topChoices.length > 1 && (
          <Field label="大分類" hint="選び直すと、この小分類をほかの大分類へ移します">
            <ChipRow>
              {topChoices.map((entry) => (
                <Chip key={entry.id} label={entry.name} selected={parentId === entry.id} onPress={() => setParentId(entry.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {editing && (
          <Pressable accessibilityRole="button" onPress={onRemove} style={styles.linkRow}>
            <Text style={styles.dangerText}>この小分類を消す</Text>
          </Pressable>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

function RenameSheet({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title="名前を直す" onClose={onClose} footer={<PrimaryButton label="保存する" disabled={text.trim() === ''} onPress={() => onSubmit(text)} />}>
        <TextInput style={styles.input} value={text} onChangeText={setText} autoFocus placeholder="名前" placeholderTextColor={colors.textFaint} />
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  yearButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  year: { fontSize: 16, fontWeight: '700', color: colors.text },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  // 上の枠（影で浮かせ、下の一覧と分ける）
  overview: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  donut: { alignItems: 'center', paddingBottom: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8 },
  legendMain: { paddingVertical: 5 },
  legendSelected: { backgroundColor: colors.moneySoft },
  legendSwatch: { width: 9, height: 9, borderRadius: 2, marginRight: 6 },
  legendLabel: { width: 100, fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  legendMainLabel: { width: 100, fontSize: 15, fontWeight: '800', color: colors.text },
  legendPercent: { width: 56, textAlign: 'right', fontSize: 12, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  legendAmount: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  legendMainAmount: { flex: 1, textAlign: 'right', fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  selectedText: { color: colors.moneyText },
  // 目標割合（上の枠の下。折りたたみ）
  ratio: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  ratioHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratioToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  ratioTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  ratioSummary: { flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  ratioButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.moneySoft },
  ratioCancel: { paddingHorizontal: 8, paddingVertical: 6 },
  ratioButtonText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  ratioSave: { backgroundColor: colors.money },
  ratioSaveText: { color: colors.surface },
  ratioDisabled: { opacity: 0.4 },
  ratioTiles: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ratioTile: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 10, backgroundColor: colors.neutralSurface },
  ratioTileLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  ratioTileValue: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  ratioSavings: { color: colors.moneyIncome },
  ratioOver: { color: colors.moneyOver },
  ratioInputRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratioInput: {
    minWidth: 40,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  ratioInputError: { borderColor: colors.moneyOver },
  ratioUnit: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  ratioHint: { marginTop: 8, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  // 一覧（見出しで区切る。行は枠を付けず、線だけ）
  section: { gap: 4 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeadIncome: { borderBottomColor: colors.moneyIncome },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionTotal: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 11 },
  rowOff: { backgroundColor: colors.neutralSurface },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  rowAmount: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  offText: { color: colors.textMuted },
  offBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    backgroundColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  empty: { fontSize: 13, fontWeight: '500', color: colors.textFaint, paddingVertical: 10, paddingHorizontal: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.moneySoft,
    marginTop: 8,
  },
  addPressed: { opacity: 0.8 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.moneyText },
  topTotal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  topTotalValue: { fontSize: 22, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  topTotalNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  // 予算の枠
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 4, marginBottom: -6 },
  group: { borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' },
  options: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 46 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  settingLabel: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  settingValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.text },
  mutedValue: { color: colors.textFaint, fontWeight: '500' },
  inlineInput: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '500', color: colors.text, paddingVertical: 0 },
  amountInput: { fontSize: 16, fontWeight: '700' },
  newInput: { textAlign: 'left' },
  yen: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  optionText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  optionSelected: { fontWeight: '700' },
  check: { fontSize: 15, fontWeight: '700', color: colors.money },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  categoryButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.moneySoft },
  categoryButtonText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  groupHint: { fontSize: 12, fontWeight: '500', color: colors.textMuted, paddingHorizontal: 4, marginTop: -6 },
  kidBlock: { paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  kidChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kidChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.neutralSurface },
  kidChipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  kidAdd: { backgroundColor: colors.moneySurface },
  kidAddText: { fontSize: 14, fontWeight: '700', color: colors.money },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.money },
  dangerText: { fontSize: 14, fontWeight: '700', color: colors.danger },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  short: { width: 64, textAlign: 'right' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
});
