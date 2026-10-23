'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, GripVertical, Pencil, Plus } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyHolidayRule,
  MoneyRecord,
  MoneyRecordKind,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString, WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  categoryPath,
  formatShortDate,
  formatYen,
  HOLIDAY_RULE_LABEL,
  monthKeyOfDate,
  parsePeriodMonth,
  periodMonthInput,
  RECORD_KIND_LABEL,
  recurringEnded,
  recurringHistory,
  recurringPeriodLabel,
  recurringScheduleLabel,
  reorderedPositions,
  storeChoices,
  WEEK_OF_MONTH_OPTIONS,
} from '@/lib/moneyUtils';
import {
  deleteMoneyRecurring,
  insertMoneyRecurring,
  insertMoneyStore,
  setMoneyRecurringArchived,
  updateMoneyRecurring,
  updateMoneyRecurringPosition,
} from '@/lib/api/money';
import { useDragReorder } from '../ui/useDragReorder';
import CategoryPicker from './CategoryPicker';
import StorePicker from './StorePicker';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 振替の自動記録（docs/kakei.md §3.3・§0.8）。mobile版の `mobile/src/components/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 支出・収入の自動記録は、年間予算の予算1件ごとに決める（2026-10-23。BudgetEditor）。ここに残すのは振替（予算に数えないもの）だけ。
// サーバーが毎朝、その日に当たる記録を作る（DBの make_money_recurring_records）。振替はほぼ毎月額を変えるので、いつも見込みの記録を作る。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（2026-10-18）。
// 直すのはルールだけで、もう作った記録は変わらない。並べ替えは左の持ち手をつかんで動かす。複製は編集の画面の「複製して足す」から。
// 期間（開始月・終了月）の外の月は記録を作らない。期間が終わったルールは、一覧の下に畳んで出す（押すと開く）。

type RecurringMode = 'expense' | 'income' | 'transfer';

/** 一覧の切り替え。'expense'＝固定支出（固定・予定）、'income'＝固定収入（給与・賞与）、'transfer'＝振替。 */
const modeOf = (rule: MoneyRecurring): RecurringMode => rule.kind;

// 振替はほぼ毎月額が変わるので、いつも見込みとして記録を作る（docs/kakei.md §3.3）。
const MODE_NAME: Record<RecurringMode, string> = { expense: '固定支出', income: '固定収入', transfer: '振替の見込み' };

interface RecurringSettingsProps {
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  /** 開いたときに編集を開くルール（予算の画面の固定費から来たとき）。 */
  initialEditId?: string | null;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';
const subClass = 'block text-xs text-gray-400';

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

export default function RecurringSettings({
  familyId,
  recurring,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onRecurring,
  initialEditId,
  onStores,
  onBack,
}: RecurringSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(
    () => recurring.find((rule) => rule.id === initialEditId) ?? null,
  );
  // 出すのは振替だけ（支出・収入は年間予算で決める）。
  const tab: RecurringMode = 'transfer';
  // 「複製して足す」の元。日・月・額など全部を写し、品名に「のコピー」を付けて新規の編集を開く。
  const [template, setTemplate] = useState<MoneyRecurring | null>(null);
  const thisMonth = monthKeyOfDate(new Date());
  const inTab = recurring.filter((rule) => modeOf(rule) === tab);
  const usable = inTab.filter((rule) => !rule.archived && !recurringEnded(rule, thisMonth));
  const ended = inTab.filter((rule) => !rule.archived && recurringEnded(rule, thisMonth));
  const [showEnded, setShowEnded] = useState(false);
  const archived = inTab.filter((rule) => rule.archived);
  const sections: { key: string; title: string | null; rules: MoneyRecurring[] }[] = [{ key: tab, title: null, rules: usable }];

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

  // 動かしたあとの並び。同じ種類の中で数え直し、変わったものだけ保存する。
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changes = reorderedPositions(recurring, orderedIds);
    if (changes.length === 0) return;
    onRecurring((prev) =>
      prev
        .map((rule) => {
          const hit = changes.find((change) => change.id === rule.id);
          return hit ? { ...rule, position: hit.position } : rule;
        })
        .sort(byPosition),
    );
    void Promise.all(changes.map((change) => updateMoneyRecurringPosition(supabase, change.id, change.position))).catch(() =>
      window.alert('並べ替えを保存できませんでした。もう一度お試しください。'),
    );
  });

  const save = async (target: MoneyRecurring | null, draft: MoneyRecurringDraft, registerStore: boolean) => {
    setEditing(null);
    setTemplate(null);
    try {
      put(
        target === null
          ? await insertMoneyRecurring(
              supabase,
              familyId,
              draft,
              recurring.reduce((max, rule) => Math.max(max, rule.position + 1), 0),
            )
          : await updateMoneyRecurring(supabase, target.id, draft),
      );
      // 「お店に登録して使う」を選んだお店は、お店の設定にも登録する（docs/kakei.md §3.5）。
      if (registerStore && draft.store !== '' && !stores.some((entry) => entry.name === draft.store && !entry.archived)) {
        const savedStore = await insertMoneyStore(supabase, familyId, draft.store);
        onStores((prev) => [...prev.filter((entry) => entry.id !== savedStore.id), savedStore]);
      }
    } catch {
      failed();
    }
  };

  // 使わなくした古い項目を「また使う」にするためだけに残している（新しく使わなくすることはできない。削除する）。
  const setArchived = async (rule: MoneyRecurring, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyRecurringArchived(supabase, rule.id, value));
    } catch {
      failed();
    }
  };

  const remove = async (rule: MoneyRecurring) => {
    if (
      !window.confirm(
        `この${MODE_NAME[modeOf(rule)]}を削除しますか？これから先は作らなくなります。作った記録は残ります。`,
      )
    ) {
      return;
    }
    setEditing(null);
    try {
      await deleteMoneyRecurring(supabase, rule.id);
      onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
    } catch {
      window.alert('削除できませんでした。もう一度お試しください。');
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      {editing !== null ? (
        <RecurringEditor
          key={editing === 'new' ? 'new' : editing.id}
          mode={editing === 'new' ? (template ? modeOf(template) : tab) : modeOf(editing)}
          rule={editing === 'new' ? null : editing}
          template={editing === 'new' ? template : null}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          stores={stores}
          records={records}
          onClose={() => {
            setEditing(null);
            setTemplate(null);
          }}
          onSubmit={(draft, registerStore) => void save(editing === 'new' ? null : editing, draft, registerStore)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing)}
          onDuplicate={
            editing === 'new'
              ? undefined
              : (source) => {
                  setTemplate(source);
                  setEditing('new');
                }
          }
        />
      ) : (
        <>
          <ScreenHeader title="振替の自動記録" icon="back" onClose={onBack} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {usable.length === 0 && <p className="py-4 text-center text-sm text-gray-400">まだありません</p>}
            {sections.map((section) => {
              const inKind = section.rules;
              if (inKind.length === 0) return null;
              return (
                <section key={section.key} className="space-y-1.5">
                  {section.title !== null && <p className="text-xs font-bold text-gray-500">{section.title}</p>}
                  {drag.arrange(`rules-${section.key}`, inKind).map((rule) => (
                    <div
                      key={rule.id}
                      ref={drag.dragRef(rule.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border bg-white px-3 py-3 ${
                        drag.isDragging(rule.id) ? 'relative z-20 border-blue-300 shadow-lg' : 'border-gray-200'
                      }`}
                    >
                      {inKind.length > 1 && (
                        <span
                          role="button"
                          aria-label={`${ruleTitle(rule, categories)}を並べ替え`}
                          {...drag.gripProps(`rules-${section.key}`, inKind, rule.id)}
                          className="-my-3 -ml-2 flex w-7 flex-none cursor-grab touch-none select-none items-center justify-center self-stretch text-gray-300"
                        >
                          <GripVertical size={18} />
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`${ruleTitle(rule, categories)}を編集`}
                        onClick={() => setEditing(rule)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="flex-1">
                          <span className="block text-[15px] font-semibold text-gray-900">
                            {ruleTitle(rule, categories)}
                          </span>
                          {ruleDetail(rule) !== '' && <span className={subClass}>{ruleDetail(rule)}</span>}
                          <span className={subClass}>{scheduleWithPeriod(rule)}</span>
                          <span className={`${subClass} tabular-nums`}>
                            {`${
                              rule.kind === 'transfer'
                                ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                                : walletName(rule.walletId) || (rule.kind === 'income' ? '入金先なし' : '出金元なし')
                            }・${amountLabel(rule)}`}
                          </span>
                        </span>
                        <Pencil size={16} className="text-gray-400" />
                      </button>
                    </div>
                  ))}
                </section>
              );
            })}
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="flex items-center gap-2 py-2.5 text-[15px] font-bold text-blue-600"
            >
              <Plus size={18} />
              {`${MODE_NAME[tab]}を足す`}
            </button>

            {ended.length > 0 && (
              <section className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowEnded((value) => !value)}
                  className="text-left text-xs font-bold text-gray-500"
                >
                  {`期間が終わったもの ${ended.length}件`}
                </button>
                {showEnded &&
                  ended.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      aria-label={`${ruleTitle(rule, categories)}を編集`}
                      onClick={() => setEditing(rule)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 text-left opacity-70"
                    >
                      <span className="flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900">{ruleTitle(rule, categories)}</span>
                        {ruleDetail(rule) !== '' && <span className={subClass}>{ruleDetail(rule)}</span>}
                        <span className={subClass}>{scheduleWithPeriod(rule)}</span>
                      </span>
                      <Pencil size={16} className="text-gray-400" />
                    </button>
                  ))}
              </section>
            )}

            {archived.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-bold text-gray-500">
                  使わないもの
                </p>
                {archived.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 opacity-70">
                    <span className="flex-1 text-[15px] font-semibold text-gray-900">
                      {ruleTitle(rule, categories)}
                      {ruleDetail(rule) !== '' ? `（${ruleDetail(rule)}）` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => void setArchived(rule, false)}
                      className="text-[13px] font-bold text-blue-600"
                    >
                      また使う
                    </button>
                    <button type="button" onClick={() => void remove(rule)} className="text-[13px] font-bold text-red-500">
                      削除
                    </button>
                  </div>
                ))}
              </section>
            )}
          </div>
          </div>
        </>
      )}
    </StackedScreen>
  );
}

/** 額の言い方。「確定 ¥55,000」「見込み 過去の記録から（無ければ ¥23,000）」。振替は入れた額でも見込み。 */
function amountLabel(rule: MoneyRecurring): string {
  if (rule.amountMode === 'fixed') return `${rule.kind === 'transfer' ? '見込み' : '確定'} ${formatYen(rule.amount)}`;
  const source = '過去の記録から';
  return rule.amount > 0 ? `見込み ${source}（無ければ ${formatYen(rule.amount)}）` : `見込み ${source}`;
}

/** ルールの見出し。カテゴリに統一する。振替などカテゴリのないものは取引の種別。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const path = rule.categoryId !== null ? categoryPath(categories, rule.categoryId) : '';
  return path !== '' ? path : RECORD_KIND_LABEL[rule.kind];
}

/** 日取りと期間。「毎月25日（休日は前営業日）・2027/9〜」。日付未定のものは月だけ（「11月・日付未定」）。 */
function scheduleWithPeriod(rule: MoneyRecurring): string {
  const period = recurringPeriodLabel(rule);
  const schedule = recurringScheduleLabel(rule);
  return period === '' ? schedule : `${schedule}・${period}`;
}

/** お店（相手先）と品名。見出しの下に添える（どちらも無ければ空）。 */
function ruleDetail(rule: MoneyRecurring): string {
  return [rule.store, rule.name]
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .join('・');
}

/** 複製の品名。品名があれば「◯◯のコピー」、無ければカテゴリ（見出し）に「のコピー」を付ける。 */
function copyName(source: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = source.name.trim();
  return `${name !== '' ? name : ruleTitle(source, categories)}のコピー`;
}

type EditorScreen = 'form' | 'category' | 'store';

function RecurringEditor({
  mode,
  rule,
  template,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onClose,
  onSubmit,
  onDelete,
  onDuplicate,
}: {
  mode: RecurringMode;
  rule: MoneyRecurring | null;
  /** 「複製して足す」の元（全部を写す）。 */
  template: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, registerStore: boolean) => void;
  onDelete?: () => void;
  /** 全部を写した新しい項目を足す（日・月・額もそのまま）。 */
  onDuplicate?: (source: MoneyRecurring) => void;
}) {
  const isIncome = mode === 'income';
  const base = rule ?? template;
  const [screen, setScreen] = useState<EditorScreen>('form');
  // 種類（支出・収入・振替）は、一覧の切り替えで決まる（編集では変えない）。
  const kind: MoneyRecordKind = base?.kind ?? mode;
  const [categoryId, setCategoryId] = useState<string | null>(base?.categoryId ?? null);
  const [walletId, setWalletId] = useState<string | null>(base?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(base?.toWalletId ?? null);
  const [store, setStore] = useState(base?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する）。
  const [registerStore, setRegisterStore] = useState(false);
  const [name, setName] = useState(rule ? rule.name : template ? copyName(template, categories) : '');
  const [day, setDay] = useState(rule ? String(rule.day) : template ? String(template.day) : '');
  // 振込日を「第◯◯曜日」で決めるか（賞与など。固定収入だけ）。
  const [byWeekday, setByWeekday] = useState(base?.weekOfMonth != null);
  const [weekOfMonth, setWeekOfMonth] = useState<number | null>(base?.weekOfMonth ?? null);
  const [weekday, setWeekday] = useState<number | null>(base?.weekday ?? null);
  // 給与は休日の前の営業日に振り込まれることが多い。
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(base?.holiday ?? (isIncome ? 'prev' : 'next'));
  const [months, setMonths] = useState<number[] | null>((rule ?? template)?.months ?? null);
  // ◯年ごと（車検など。間隔は2〜10年。期間の始まりの年から数える）。空は毎年。
  const [intervalInput, setIntervalInput] = useState(base?.intervalYears != null ? String(base.intervalYears) : '');
  const [byInterval, setByInterval] = useState(base?.intervalYears != null);

  // 期間（2027/9 の形で入れる。空は無期限）。
  const [startInput, setStartInput] = useState(periodMonthInput(base?.startMonth ?? null));
  const [endInput, setEndInput] = useState(periodMonthInput(base?.endMonth ?? null));
  // 種類。確定（fixed）は確定の記録、見込み（estimate）は過去の記録から見込んだ見込みの記録（振替はいつも見込み）。
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(base?.amountMode ?? 'estimate');
  // 支出・収入の自動記録のオン／オフ・日付未定は年間予算で決める（ここは振替だけ。いつも自動で記録する）。
  const estimate = false;
  const noDay = false;
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : '');
  const [error, setError] = useState<string | null>(null);

  // 固定収入の入金先は銀行の口座だけ（いま選んでいるものは、銀行でなくても残す）。
  const usableWallets = wallets.filter(
    (wallet) =>
      (!wallet.archived || wallet.id === walletId || wallet.id === toWalletId) &&
      (!isIncome || wallet.type === 'bank' || wallet.id === walletId),
  );
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateString(new Date())), [stores, records]);
  const today = toDateString(new Date());
  const startForHistory = parsePeriodMonth(startInput) ?? null;
  const history = useMemo(
    () =>
      recurringHistory(
        { id: rule?.id, kind, walletId, toWalletId, store, categoryId, startMonth: startForHistory },
        records,
        today,
      ),
    [rule?.id, kind, walletId, toWalletId, store, categoryId, startForHistory, records, today],
  );
  const target = categoryId !== null ? categoryPath(categories, categoryId) : '';

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    // 「第◯◯曜日」のときは day を使わない（1 を入れておく）。日付未定も 1。
    let dayValue = 1;
    if (noDay) {
      // 日は決めない。
    } else if (byWeekday) {
      if (weekOfMonth === null || weekday === null) return setError('第何週の何曜日かを選んでください');
    } else {
      dayValue = Number(day.trim());
      if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError(`${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`);
    }
    // 帯に出すものは、出金元を決めなくてよい（記録するときに選ぶ）。
    if (!estimate && walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null) return setError('カテゴリを選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const startMonth = parsePeriodMonth(startInput);
    const endMonth = parsePeriodMonth(endInput);
    if (startMonth === undefined || endMonth === undefined) return setError('期間は「2027/9」の形で入れてください（無期限は空）');
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return setError('期間の終わりを始まりより後にしてください');
    const intervalYears = byInterval ? Number(intervalInput.trim()) : null;
    if (intervalYears !== null) {
      if (!Number.isInteger(intervalYears) || intervalYears < 2 || intervalYears > 10) return setError('何年ごとかを 2〜10 で入れてください');
      if (months === null) return setError('◯年ごとは、記録する月を選んでください');
      if (startMonth === null) return setError('◯年ごとは、期間の始まり（最初の回の月）を入れてください');
    }
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError(kind === 'transfer' ? '見込みの額を入れてください' : '確定の額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      weekOfMonth: !noDay && byWeekday ? weekOfMonth : null,
      weekday: !noDay && byWeekday ? weekday : null,
      months,
      startMonth,
      endMonth,
      holiday: noDay ? 'next' : holiday,
      amountMode,
      amount: amountValue,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      name,
      makesRecord: true,
      skippedMonths: rule?.skippedMonths ?? [],
      intervalYears,
      dayKnown: true,
      noMonth: false,
    }, kind !== 'transfer' && store !== '' && registerStore);
  };

  const walletChips = (selected: string | null, onPick: (id: string) => void, exclude: string | null) => (
    <div className="flex flex-wrap gap-2">
      {usableWallets
        .filter((wallet) => wallet.id !== exclude)
        .map((wallet) => (
          <Chip key={wallet.id} label={wallet.name} selected={selected === wallet.id} onClick={() => onPick(wallet.id)} />
        ))}
      {usableWallets.length === 0 && (
        <span className={subClass}>{isIncome ? '銀行の口座を先に足してください' : '出金元を先に足してください'}</span>
      )}
    </div>
  );

  return (
    <StackedScreen onBack={onClose}>
      {screen === 'category' ? (
        <CategoryPicker
          kind={kind === 'income' ? 'income' : 'expense'}
          categories={categories}
          onPick={(choice) => {
            setCategoryId(choice.categoryId);
            setScreen('form');
          }}
          onClose={() => setScreen('form')}
        />
      ) : screen === 'store' ? (
        <StorePicker
          value={store}
          registered={storeOptions.registered}
          others={storeOptions.others}
          canRegister
          onPick={(value, register) => {
            setStore(value);
            setRegisterStore(register);
            setScreen('form');
          }}
          onClose={() => setScreen('form')}
        />
      ) : (
        <>
          <ScreenHeader title={`${MODE_NAME[mode]}を${rule ? '編集' : template ? '複製して足す' : '足す'}`} icon="back" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {kind !== 'transfer' && (
              <div className="space-y-2">
                <span className={labelClass}>種類</span>
                <div className="flex flex-wrap gap-2">
                  <Chip label="確定" selected={amountMode === 'fixed'} onClick={() => setAmountMode('fixed')} />
                  <Chip label="見込み" selected={amountMode === 'estimate'} onClick={() => setAmountMode('estimate')} />
                </div>
              </div>
            )}

            {kind !== 'transfer' && (
              <button
                type="button"
                onClick={() => setScreen('category')}
                className="flex w-full items-center gap-3 border-b border-gray-200 py-3 text-left"
              >
                <span className="text-xs font-bold text-gray-700">カテゴリ</span>
                <span className={`flex-1 text-right text-[15px] ${target === '' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {target || '選ぶ'}
                </span>
                <ChevronRight size={18} className="text-gray-400" />
              </button>
            )}

            <div>
              <span className={labelClass}>{kind === 'income' ? '入金先' : estimate ? '出金元（任意）' : '出金元'}</span>
              {walletChips(walletId, (id) => setWalletId(estimate && id === walletId ? null : id), null)}
            </div>
            {kind === 'transfer' ? (
              <div>
                <span className={labelClass}>入金先</span>
                {walletChips(toWalletId, setToWalletId, walletId)}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setScreen('store')}
                className="flex w-full items-center gap-3 border-b border-gray-200 py-3 text-left"
              >
                <span className="text-xs font-bold text-gray-700">お店（相手先）</span>
                <span className={`flex-1 text-right text-[15px] ${store === '' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {store || '選ぶ'}
                </span>
                <ChevronRight size={18} className="text-gray-400" />
              </button>
            )}

            <label className="block">
              <span className={labelClass}>品名（任意）</span>
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder={isIncome ? '例: 賞与（6月）' : estimate ? '例: 車検' : '例: 電気代'} />
            </label>

            {isIncome && (
              <div>
                <span className={labelClass}>日の決め方</span>
                <div className="flex flex-wrap gap-2">
                  <Chip label="日にち" selected={!byWeekday} onClick={() => setByWeekday(false)} />
                  <Chip label="第◯◯曜日" selected={byWeekday} onClick={() => setByWeekday(true)} />
                </div>
              </div>
            )}
            {noDay ? null : byWeekday ? (
              <div className="space-y-2">
                <span className={labelClass}>振込日</span>
                <div className="flex flex-wrap gap-2">
                  {WEEK_OF_MONTH_OPTIONS.map((option) => (
                    <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onClick={() => setWeekOfMonth(option.value)} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Chip key={label} label={`${label}曜日`} selected={weekday === index} onClick={() => setWeekday(index)} />
                  ))}
                </div>
              </div>
            ) : (
              <label className="block">
                <span className={labelClass}>{isIncome ? '振込日' : estimate ? '帯に出す日（払う日の目安）' : '引き落とし日（入る日）'}</span>
                <input
                  className={inputClass}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="例: 27（末日は31）"
                />
              </label>
            )}
            {!noDay && (
            <div>
              <span className={labelClass}>休日のとき</span>
              <div className="flex flex-wrap gap-2">
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onClick={() => setHoliday(entry)} />
                ))}
              </div>
            </div>
            )}
            <div className="space-y-2">
              <span className={labelClass}>記録する月</span>
              <div className="flex flex-wrap gap-2">
                <Chip
                  label="毎月"
                  selected={months === null}
                  onClick={() => {
                    setMonths(null);
                    setByInterval(false);
                  }}
                />
                <Chip
                  label="毎年（月を選ぶ）"
                  selected={months !== null && !byInterval}
                  onClick={() => {
                    setMonths(months ?? []);
                    setByInterval(false);
                  }}
                />
                <Chip
                  label="◯年ごと"
                  selected={byInterval}
                  onClick={() => {
                    setMonths(months ?? []);
                    setByInterval(true);
                  }}
                />
              </div>
              {byInterval && (
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClass} w-16 text-right`}
                    value={intervalInput}
                    onChange={(event) => setIntervalInput(event.target.value)}
                    inputMode="numeric"
                    placeholder="2"
                  />
                  <span className="text-[15px] font-semibold text-gray-500">年ごと（期間の始まりの年から数える）</span>
                </div>
              )}
              {months !== null && (
                <div className="flex flex-wrap gap-2">
                  {MONTHS.map((month) => (
                    <Chip key={month} label={`${month}月`} selected={months.includes(month)} onClick={() => toggleMonth(month)} />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <span className={labelClass}>{byInterval ? '期間（始まり＝最初の回）' : '期間（任意）'}</span>
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={startInput}
                  onChange={(event) => setStartInput(event.target.value)}
                  placeholder="始まり 例: 2027/9"
                />
                <span className="text-[15px] font-semibold text-gray-500">〜</span>
                <input
                  className={inputClass}
                  value={endInput}
                  onChange={(event) => setEndInput(event.target.value)}
                  placeholder="終わり 例: 2027/8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <span className={labelClass}>{kind === 'transfer' ? '額の決め方' : amountMode === 'fixed' ? '額' : '見込みの額'}</span>
              {kind === 'transfer' && (
                <div className="flex flex-wrap gap-2">
                  <Chip label="過去の記録から" selected={amountMode === 'estimate'} onClick={() => setAmountMode('estimate')} />
                  <Chip label="入れた額" selected={amountMode === 'fixed'} onClick={() => setAmountMode('fixed')} />
                </div>
              )}
              <input
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder={amountMode === 'fixed' ? '額（円）' : '過去の記録が無いときの額（円・任意）'}
              />
              {amountMode === 'estimate' && (
                <span className={`${subClass} tabular-nums`}>
                  {history.length === 0
                    ? '過去1年に、カテゴリ・出金元・お店が同じ記録はまだありません'
                    : `過去1年の記録 ${history.length}件（直近 ${formatShortDate(history[0].occurredOn)} ${formatYen(history[0].amount)}）`}
                </span>
              )}
              {(kind === 'transfer' || amountMode === 'estimate') && (
                <span className={subClass}>{kind === 'income' ? '振込日' : kind === 'transfer' ? '振替の日' : '引き落とし日'}に見込みの記録を作ります。実額に直すと確定します</span>
              )}
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <div className="shrink-0 space-y-1 border-t border-gray-200 px-4 pt-2.5 pb-4">
            <PrimaryButton label="保存する" onClick={submit} />
            {rule && onDuplicate && (
              <button type="button" onClick={() => onDuplicate(rule)} className="w-full py-2 text-sm font-bold text-blue-600">
                複製して足す
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete} className="w-full py-2 text-sm text-red-500">
                削除
              </button>
            )}
          </div>
        </>
      )}
    </StackedScreen>
  );
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
        selected ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}
