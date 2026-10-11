'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
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
  cardScheduleLabel,
  categoryPath,
  formatShortDate,
  formatYear,
  formatYen,
  HOLIDAY_RULE_LABEL,
  incomeRecordsInYear,
  monthKeyOfDate,
  RECORD_KIND_LABEL,
  recordTotal,
  recurringHistory,
  recurringScheduleLabel,
  storeChoices,
  WEEK_OF_MONTH_OPTIONS,
} from '@/lib/moneyUtils';
import {
  deleteMoneyRecurring,
  insertMoneyRecurring,
  insertMoneyStore,
  setMoneyRecurringArchived,
  updateMoneyRecurring,
} from '@/lib/api/money';
import CategoryPicker from './CategoryPicker';
import StorePicker from './StorePicker';
import { EstimateBadge, PrimaryButton, ScreenHeader, StackedScreen, incomeAmountClass } from './moneyVisual';

// 毎月の記録の設定（docs/kakei.md §3.3・§3.4・§3.5）。mobile版の `mobile/src/components/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 口座から落ちる固定支出・口座に入る給料などを、項目ごとのルールにする。サーバーが毎朝、その日に当たる記録を作る
// （DBの make_money_recurring_records）。額を見込むものは、過去1年の記録（種類・出金元・お店が同じもの）から出す。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（一覧だけ出す）。
// 直すのはルールだけで、もう作った記録は変わらない。
//
// 固定収入（給与・賞与。2026-10-11。docs/kakei.md §0.3）も同じルールで、mode が 'income' の画面。収入のルールだけを出し、
// 入金先・振込日・見込み額の言葉にする。賞与は1回ごとに1件のルール（月・日・額）で、「同じ名前でもう1回足す」で回を増やす。
// 履歴は、その年の収入の記録を見込み／確定つきで年ごとに出す（見込み額の変更の版は持たない）。

interface RecurringSettingsProps {
  /** 'expense'＝固定支出（支出・振替）、'income'＝固定収入（給与・賞与）。 */
  mode: 'expense' | 'income';
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const KINDS: MoneyRecordKind[] = ['expense', 'transfer'];
const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';
const subClass = 'block text-xs text-gray-400';

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

export default function RecurringSettings({
  mode,
  familyId,
  recurring,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onRecurring,
  onStores,
  onBack,
}: RecurringSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const isIncome = mode === 'income';
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(null);
  // 賞与の「もう1回」を足すときの元（月・日だけ入れ直す）。
  const [template, setTemplate] = useState<MoneyRecurring | null>(null);
  const inMode = recurring.filter((rule) => (rule.kind === 'income') === isIncome);
  const usable = inMode.filter((rule) => !rule.archived);
  const archived = inMode.filter((rule) => rule.archived);
  const cards = isIncome ? [] : wallets.filter((wallet) => wallet.type === 'card' && !wallet.archived);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

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
        `この${isIncome ? '固定収入' : '固定支出'}を削除しますか？これから先は作らなくなります。作った記録は残ります。`,
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
          mode={mode}
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
          onAddSimilar={
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
          <ScreenHeader title={isIncome ? '固定収入' : '固定支出'} icon="back" onClose={onBack} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <p className="text-[13px] leading-relaxed text-gray-500">
              {isIncome
                ? '給与・賞与を登録すると、振込日に見込みの額で自動で記録します（毎朝。休日は営業日にずらします）。給与明細などを見て額を直すと確定します。賞与は1回ごとに、月と日と額を足します。'
                : '口座から落ちる固定支出を登録すると、その日に自動で記録します（毎朝。休日は営業日にずらします）。額を見込むものは「見込み」の印つきで記録し、額を直すと確定します。'}
            </p>
            {usable.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-400">
                {isIncome ? 'まだありません。給与・賞与を足してください' : 'まだありません。家賃・光熱費などを足してください'}
              </p>
            )}
            {(isIncome ? (['income'] as const) : KINDS).map((kind) => {
              const inKind = usable.filter((rule) => rule.kind === kind);
              if (inKind.length === 0) return null;
              return (
                <section key={kind} className="space-y-1.5">
                  {!isIncome && <p className="text-xs font-bold text-gray-500">{RECORD_KIND_LABEL[kind]}</p>}
                  {inKind.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      aria-label={`${ruleTitle(rule, categories)}を編集`}
                      onClick={() => setEditing(rule)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900">
                          {ruleTitle(rule, categories)}
                        </span>
                        <span className={subClass}>{recurringScheduleLabel(rule)}</span>
                        <span className={`${subClass} tabular-nums`}>
                          {rule.kind === 'transfer'
                            ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                            : walletName(rule.walletId) || (isIncome ? '入金先なし' : '出金元なし')}
                          ・{amountLabel(rule, isIncome)}
                        </span>
                      </span>
                      <Pencil size={16} className="text-gray-400" />
                    </button>
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
              {isIncome ? '固定収入を足す' : '固定支出を足す'}
            </button>

            {isIncome && <IncomeHistory records={records} categories={categories} />}

            {cards.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-bold text-gray-500">カード代金（出金元のカードで設定）</p>
                {cards.map((card) => {
                  const schedule = cardScheduleLabel(card);
                  const ready = schedule !== '' && card.payWalletId !== null;
                  return (
                    <div key={card.id} className="rounded-lg border border-gray-200 px-3 py-3">
                      <span className="block text-[15px] font-semibold text-gray-900">{card.name}</span>
                      <span className={subClass}>
                        {ready
                          ? `${schedule}・${walletName(card.payWalletId)}から（休日は翌営業日）`
                          : '締め日・引き落とし日・引き落とし口座がそろっていません'}
                      </span>
                    </div>
                  );
                })}
              </section>
            )}

            {archived.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-xs font-bold text-gray-500">
                  {isIncome ? '使わない固定収入（作った記録は残っています）' : '使わない固定支出（作った記録は残っています）'}
                </p>
                {archived.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 opacity-70">
                    <span className="flex-1 text-[15px] font-semibold text-gray-900">
                      {ruleTitle(rule, categories)}
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
        </>
      )}
    </StackedScreen>
  );
}

/** 額の言い方。収入は「見込み額」、支出は「過去の記録から見込む」。 */
function amountLabel(rule: MoneyRecurring, isIncome: boolean): string {
  if (rule.amountMode === 'fixed') return `固定 ${formatYen(rule.amount)}`;
  if (isIncome) return rule.amount > 0 ? `見込み額 ${formatYen(rule.amount)}` : '見込み額は過去の記録から';
  return '過去の記録から見込む';
}

/** 固定収入の履歴。その年の収入の記録を、新しい日から（見込みの印つき）。年は送れる。 */
function IncomeHistory({ records, categories }: { records: MoneyRecord[]; categories: MoneyCategory[] }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const list = useMemo(() => incomeRecordsInYear(records, year), [records, year]);
  const total = list.reduce((sum, record) => sum + recordTotal(record), 0);
  const titleOf = (record: MoneyRecord) => {
    const item = record.items[0];
    if (item && item.name.trim() !== '') return item.name.trim();
    if (record.store.trim() !== '') return record.store.trim();
    return item && item.categoryId !== null ? categoryPath(categories, item.categoryId) : '収入';
  };
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between py-1">
        <button type="button" aria-label="前の年" onClick={() => setYear(year - 1)} className="text-gray-700">
          <ChevronLeft size={22} />
        </button>
        <p className="text-[15px] font-bold text-gray-900">{formatYear(year)}の収入</p>
        <button type="button" aria-label="次の年" onClick={() => setYear(year + 1)} className="text-gray-700">
          <ChevronRight size={22} />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">この年の収入の記録はまだありません</p>
      ) : (
        <>
          {list.map((record) => (
            <div key={record.id} className="flex items-center gap-2 border-b border-gray-200 py-2.5">
              <span className="w-11 text-[13px] font-semibold text-gray-500 tabular-nums">{formatShortDate(record.occurredOn)}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{titleOf(record)}</span>
              {record.isEstimate && <EstimateBadge />}
              <span className={`text-[15px] font-extrabold tabular-nums ${incomeAmountClass}`}>{formatYen(recordTotal(record))}</span>
            </div>
          ))}
          <span className={`${subClass} tabular-nums`}>合計 {formatYen(total)}</span>
        </>
      )}
    </section>
  );
}

/** ルールの名前（品名 → お店 → 種類の順に、あるもの）。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  if (rule.name.trim() !== '') return rule.name.trim();
  if (rule.store.trim() !== '') return rule.store.trim();
  if (rule.categoryId !== null) return categoryPath(categories, rule.categoryId);
  return RECORD_KIND_LABEL[rule.kind];
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
  onAddSimilar,
}: {
  mode: 'expense' | 'income';
  rule: MoneyRecurring | null;
  /** 賞与の「もう1回」を足すときの元。月・日は入れ直す。 */
  template: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, registerStore: boolean) => void;
  onDelete?: () => void;
  /** 固定収入で、同じ名前・入金先でもう1回（月・日・額）を足す。 */
  onAddSimilar?: (source: MoneyRecurring) => void;
}) {
  const isIncome = mode === 'income';
  const base = rule ?? template;
  const [screen, setScreen] = useState<EditorScreen>('form');
  const [kind, setKind] = useState<MoneyRecordKind>(rule?.kind ?? (isIncome ? 'income' : 'expense'));
  const [categoryId, setCategoryId] = useState<string | null>(base?.categoryId ?? null);
  const [walletId, setWalletId] = useState<string | null>(base?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(base?.toWalletId ?? null);
  const [store, setStore] = useState(base?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する）。
  const [registerStore, setRegisterStore] = useState(false);
  const [name, setName] = useState(base?.name ?? '');
  const [day, setDay] = useState(rule ? String(rule.day) : '');
  // 振込日を「第◯◯曜日」で決めるか（賞与など。固定収入だけ）。
  const [byWeekday, setByWeekday] = useState(base?.weekOfMonth != null);
  const [weekOfMonth, setWeekOfMonth] = useState<number | null>(base?.weekOfMonth ?? null);
  const [weekday, setWeekday] = useState<number | null>(base?.weekday ?? null);
  // 給与は休日の前の営業日に振り込まれることが多い。
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(base?.holiday ?? (isIncome ? 'prev' : 'next'));
  // 賞与の「もう1回」は、月を選び直す（空のまま）。
  const [months, setMonths] = useState<number[] | null>(rule ? rule.months : template ? [] : null);
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(base?.amountMode ?? 'estimate');
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : '');
  const [error, setError] = useState<string | null>(null);

  // 固定収入の入金先は銀行の口座だけ（いま選んでいるものは、銀行でなくても残す）。
  const usableWallets = wallets.filter(
    (wallet) =>
      (!wallet.archived || wallet.id === walletId || wallet.id === toWalletId) &&
      (!isIncome || wallet.type === 'bank' || wallet.id === walletId),
  );
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const today = toDateString(new Date());
  const history = useMemo(
    () => recurringHistory({ kind, walletId, toWalletId, store, categoryId }, records, today),
    [kind, walletId, toWalletId, store, categoryId, records, today],
  );
  const target = categoryId !== null ? categoryPath(categories, categoryId) : '';

  const changeKind = (next: MoneyRecordKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId(null);
  };

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    // 「第◯◯曜日」のときは day を使わない（1 を入れておく）。
    let dayValue = 1;
    if (byWeekday) {
      if (weekOfMonth === null || weekday === null) return setError('第何週の何曜日かを選んでください');
    } else {
      dayValue = Number(day.trim());
      if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError(`${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`);
    }
    if (walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null) return setError('種類を選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError('固定額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      weekOfMonth: byWeekday ? weekOfMonth : null,
      weekday: byWeekday ? weekday : null,
      months,
      holiday,
      amountMode,
      amount: amountValue,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      name,
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
          monthKey={monthKeyOfDate(new Date())}
          categories={categories}
          budgets={budgets}
          records={records}
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
          recent={storeOptions.recent}
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
          <ScreenHeader title={`${isIncome ? '固定収入' : '固定支出'}を${rule ? '編集' : '足す'}`} icon="back" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {!isIncome && (
              <div className="flex flex-wrap gap-2">
                {KINDS.map((entry) => (
                  <Chip key={entry} label={RECORD_KIND_LABEL[entry]} selected={kind === entry} onClick={() => changeKind(entry)} />
                ))}
              </div>
            )}

            {kind !== 'transfer' && (
              <button
                type="button"
                onClick={() => setScreen('category')}
                className="flex w-full items-center gap-3 border-b border-gray-200 py-3 text-left"
              >
                <span className="text-xs font-bold text-gray-700">種類</span>
                <span className={`flex-1 text-right text-[15px] ${target === '' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {target || '選ぶ'}
                </span>
                <ChevronRight size={18} className="text-gray-400" />
              </button>
            )}

            <div>
              <span className={labelClass}>{kind === 'income' ? '入金先' : '出金元'}</span>
              {walletChips(walletId, setWalletId, null)}
              {isIncome && <span className={`${subClass} mt-1.5`}>入金先は銀行の口座だけ選べます</span>}
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
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder={isIncome ? '例: 賞与（6月）' : '例: 電気代'} />
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
            {byWeekday ? (
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
                <span className={subClass}>例: 第2・金曜日（その月の2回目の金曜日）、最終・金曜日（月の最後の金曜日）</span>
              </div>
            ) : (
              <label className="block">
                <span className={labelClass}>{isIncome ? '振込日' : '引き落とし日（入る日）'}</span>
                <input
                  className={inputClass}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="例: 27（末日は31）"
                />
              </label>
            )}
            <div>
              <span className={labelClass}>休日のとき</span>
              <div className="flex flex-wrap gap-2">
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onClick={() => setHoliday(entry)} />
                ))}
              </div>
              <span className={`${subClass} mt-1.5`}>休日は土日・祝日・12月31日〜1月3日（銀行の休業日）</span>
            </div>
            <div className="space-y-2">
              <span className={labelClass}>記録する月</span>
              <div className="flex flex-wrap gap-2">
                <Chip label="毎月" selected={months === null} onClick={() => setMonths(null)} />
                <Chip label="月を選ぶ" selected={months !== null} onClick={() => setMonths(months ?? [])} />
              </div>
              {months !== null && (
                <div className="flex flex-wrap gap-2">
                  {MONTHS.map((month) => (
                    <Chip key={month} label={`${month}月`} selected={months.includes(month)} onClick={() => toggleMonth(month)} />
                  ))}
                </div>
              )}
              <span className={subClass}>
                {isIncome
                  ? '給与は毎月。賞与は支給される月を選びます（年に2回なら、回ごとに足します）'
                  : '年に数回のものは、月を選びます（毎月の見込みを崩さないため）'}
              </span>
            </div>

            <div className="space-y-2">
              <span className={labelClass}>{isIncome ? '見込み額' : '額の決め方'}</span>
              <div className="flex flex-wrap gap-2">
                <Chip label={isIncome ? '見込み額' : '過去の記録から見込む'} selected={amountMode === 'estimate'} onClick={() => setAmountMode('estimate')} />
                <Chip label="固定額" selected={amountMode === 'fixed'} onClick={() => setAmountMode('fixed')} />
              </div>
              <input
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder={amountMode === 'fixed' ? '額（円）' : isIncome ? '見込み額（円）' : '過去の記録が無いときの額（円・任意）'}
              />
              <span className={subClass}>
                {amountMode === 'fixed'
                  ? `この額で確定として記録します（${isIncome ? '額が決まっている給与など' : '家賃・ローンなど'}）`
                  : isIncome
                    ? '振込日に、この額を「見込み」として記録します。給与明細などを見て額を直すと確定します。前の年の同じ月の記録があれば、その額を見込みにします'
                    : '前年同月の記録があればその額、無ければ直近3回の平均で、「見込み」として記録します。記録が1件も無いときは、上に入れた額で「見込み」として記録します'}
              </span>
              {amountMode === 'estimate' && (
                <span className={`${subClass} tabular-nums`}>
                  {history.length === 0
                    ? '過去1年に、種類・出金元・お店が同じ記録はまだありません'
                    : `過去1年の記録 ${history.length}件（直近 ${formatShortDate(history[0].occurredOn)} ${formatYen(history[0].amount)}）`}
                </span>
              )}
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <div className="shrink-0 space-y-1 border-t border-gray-200 px-4 pt-2.5 pb-4">
            <PrimaryButton label="保存する" onClick={submit} />
            {isIncome && rule && onAddSimilar && (
              <button type="button" onClick={() => onAddSimilar(rule)} className="w-full py-2 text-sm font-bold text-blue-600">
                同じ名前でもう1回（月・日）を足す
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
