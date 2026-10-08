'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
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
  SpecialActual,
  SpecialItem,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString } from '@/lib/dateUtils';
import {
  cardScheduleLabel,
  categoryPath,
  formatShortDate,
  formatYen,
  HOLIDAY_RULE_LABEL,
  monthKeyOfDate,
  RECORD_KIND_LABEL,
  recurringHistory,
  recurringScheduleLabel,
  storeChoices,
} from '@/lib/moneyUtils';
import { insertMoneyRecurring, setMoneyRecurringArchived, updateMoneyRecurring } from '@/lib/api/money';
import CategoryPicker from './CategoryPicker';
import StorePicker from './StorePicker';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 毎月の記録の設定（docs/kakei.md §3.3・§3.4・§3.5）。mobile版の `mobile/src/components/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 口座から落ちる固定費・口座に入る給料などを、項目ごとのルールにする。サーバーが毎朝、その日に当たる記録を作る
// （DBの make_money_recurring_records）。額を見込むものは、過去1年の記録（種類・出金元・お店が同じもの）から出す。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（一覧だけ出す）。
// 直すのはルールだけで、もう作った記録は変わらない。

interface RecurringSettingsProps {
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onBack: () => void;
}

const KINDS: MoneyRecordKind[] = ['expense', 'income', 'transfer'];
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
  specialItems,
  specialActuals,
  onRecurring,
  onBack,
}: RecurringSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(null);
  const usable = recurring.filter((rule) => !rule.archived);
  const archived = recurring.filter((rule) => rule.archived);
  const cards = wallets.filter((wallet) => wallet.type === 'card' && !wallet.archived);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

  const save = async (target: MoneyRecurring | null, draft: MoneyRecurringDraft) => {
    setEditing(null);
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
    } catch {
      failed();
    }
  };

  const setArchived = async (rule: MoneyRecurring, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyRecurringArchived(supabase, rule.id, value));
    } catch {
      failed();
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      {editing !== null ? (
        <RecurringEditor
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          stores={stores}
          records={records}
          specialItems={specialItems}
          specialActuals={specialActuals}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(editing === 'new' ? null : editing, draft)}
          onArchive={editing === 'new' ? undefined : () => void setArchived(editing, true)}
        />
      ) : (
        <>
          <ScreenHeader title="毎月の記録" icon="back" onClose={onBack} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <p className="text-[13px] leading-relaxed text-gray-500">
              口座から落ちる固定費・口座に入る給料などを登録すると、その日に自動で記録します（毎朝。休日は営業日にずらします）。
              額を見込むものは「見込み」の印つきで記録し、額を直すと確定します。
            </p>
            {usable.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-400">まだありません。家賃・光熱費・給料などを足してください</p>
            )}
            {KINDS.map((kind) => {
              const inKind = usable.filter((rule) => rule.kind === kind);
              if (inKind.length === 0) return null;
              return (
                <section key={kind} className="space-y-1.5">
                  <p className="text-xs font-bold text-gray-500">{RECORD_KIND_LABEL[kind]}</p>
                  {inKind.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      aria-label={`${ruleTitle(rule, categories, specialItems)}を編集`}
                      onClick={() => setEditing(rule)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900">
                          {ruleTitle(rule, categories, specialItems)}
                        </span>
                        <span className={subClass}>{recurringScheduleLabel(rule)}</span>
                        <span className={`${subClass} tabular-nums`}>
                          {rule.kind === 'transfer'
                            ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                            : walletName(rule.walletId) || '出金元なし'}
                          ・{rule.amountMode === 'fixed' ? `固定 ${formatYen(rule.amount)}` : '過去の記録から見込む'}
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
              毎月の記録を足す
            </button>

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
                <p className="text-xs font-bold text-gray-500">使わない毎月の記録（作った記録は残っています）</p>
                {archived.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 opacity-70">
                    <span className="flex-1 text-[15px] font-semibold text-gray-900">
                      {ruleTitle(rule, categories, specialItems)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void setArchived(rule, false)}
                      className="text-[13px] font-bold text-blue-600"
                    >
                      また使う
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

/** ルールの名前（品名 → お店 → 種類の順に、あるもの）。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[], specialItems: SpecialItem[]): string {
  if (rule.name.trim() !== '') return rule.name.trim();
  if (rule.store.trim() !== '') return rule.store.trim();
  if (rule.categoryId !== null) return categoryPath(categories, rule.categoryId);
  if (rule.specialItemId !== null) return specialItems.find((item) => item.id === rule.specialItemId)?.name ?? '';
  return RECORD_KIND_LABEL[rule.kind];
}

type EditorScreen = 'form' | 'category' | 'store';

function RecurringEditor({
  rule,
  wallets,
  categories,
  budgets,
  stores,
  records,
  specialItems,
  specialActuals,
  onClose,
  onSubmit,
  onArchive,
}: {
  rule: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft) => void;
  onArchive?: () => void;
}) {
  const [screen, setScreen] = useState<EditorScreen>('form');
  const [kind, setKind] = useState<MoneyRecordKind>(rule?.kind ?? 'expense');
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [specialItemId, setSpecialItemId] = useState<string | null>(rule?.specialItemId ?? null);
  const [walletId, setWalletId] = useState<string | null>(rule?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(rule?.toWalletId ?? null);
  const [store, setStore] = useState(rule?.store ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [day, setDay] = useState(rule ? String(rule.day) : '');
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(rule?.holiday ?? 'next');
  const [months, setMonths] = useState<number[] | null>(rule?.months ?? null);
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(rule?.amountMode ?? 'estimate');
  const [amount, setAmount] = useState(rule && rule.amount > 0 ? String(rule.amount) : '');
  const [error, setError] = useState<string | null>(null);

  const usableWallets = wallets.filter((wallet) => !wallet.archived || wallet.id === walletId || wallet.id === toWalletId);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const today = toDateString(new Date());
  const history = useMemo(
    () => recurringHistory({ kind, walletId, toWalletId, store, categoryId, specialItemId }, records, today),
    [kind, walletId, toWalletId, store, categoryId, specialItemId, records, today],
  );
  const target =
    categoryId !== null
      ? categoryPath(categories, categoryId)
      : specialItemId !== null
        ? `${kind === 'income' ? '特別収入' : '特別費'} › ${specialItems.find((item) => item.id === specialItemId)?.name ?? ''}`
        : '';

  const changeKind = (next: MoneyRecordKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId(null);
    setSpecialItemId(null);
  };

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    const dayValue = Number(day.trim());
    if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError('引き落とし日を 1〜31 で入れてください（末日は31）');
    if (walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null && specialItemId === null) return setError('種類を選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError('固定額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      months,
      holiday,
      amountMode,
      amount: amountValue,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      specialItemId: kind === 'transfer' ? null : specialItemId,
      name,
    });
  };

  const archive = () => {
    if (window.confirm('この毎月の記録を使わなくしますか？これから先は作らなくなります。作った記録は残ります。')) onArchive?.();
  };

  const walletChips = (selected: string | null, onPick: (id: string) => void, exclude: string | null) => (
    <div className="flex flex-wrap gap-2">
      {usableWallets
        .filter((wallet) => wallet.id !== exclude)
        .map((wallet) => (
          <Chip key={wallet.id} label={wallet.name} selected={selected === wallet.id} onClick={() => onPick(wallet.id)} />
        ))}
      {usableWallets.length === 0 && <span className={subClass}>出金元を先に足してください</span>}
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
          specialItems={specialItems}
          specialActuals={specialActuals}
          onPick={(choice) => {
            setCategoryId(choice.categoryId);
            setSpecialItemId(choice.specialItemId);
            setScreen('form');
          }}
          onClose={() => setScreen('form')}
        />
      ) : screen === 'store' ? (
        <StorePicker
          value={store}
          registered={storeOptions.registered}
          recent={storeOptions.recent}
          onPick={(value) => {
            setStore(value);
            setScreen('form');
          }}
          onClose={() => setScreen('form')}
        />
      ) : (
        <>
          <ScreenHeader title={rule ? '毎月の記録を編集' : '毎月の記録を足す'} icon="back" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {KINDS.map((entry) => (
                <Chip key={entry} label={RECORD_KIND_LABEL[entry]} selected={kind === entry} onClick={() => changeKind(entry)} />
              ))}
            </div>

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
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 電気代" />
            </label>

            <label className="block">
              <span className={labelClass}>引き落とし日（入る日）</span>
              <input
                className={inputClass}
                value={day}
                onChange={(event) => setDay(event.target.value)}
                inputMode="numeric"
                placeholder="例: 27（末日は31）"
              />
            </label>
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
              <span className={subClass}>賞与のように年に数回のものは、別の記録にして月を選びます（毎月の見込みを崩さないため）</span>
            </div>

            <div className="space-y-2">
              <span className={labelClass}>額の決め方</span>
              <div className="flex flex-wrap gap-2">
                <Chip label="過去の記録から見込む" selected={amountMode === 'estimate'} onClick={() => setAmountMode('estimate')} />
                <Chip label="固定額" selected={amountMode === 'fixed'} onClick={() => setAmountMode('fixed')} />
              </div>
              <input
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder={amountMode === 'fixed' ? '額（円）' : '過去の記録が無いときの額（円・任意）'}
              />
              <span className={subClass}>
                {amountMode === 'fixed'
                  ? 'この額で確定として記録します（家賃・ローンなど）'
                  : '前年同月の記録があればその額、無ければ直近3回の平均で、「見込み」として記録します'}
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
            {onArchive && (
              <button type="button" onClick={archive} className="w-full py-2 text-sm text-red-500">
                使わなくする
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
