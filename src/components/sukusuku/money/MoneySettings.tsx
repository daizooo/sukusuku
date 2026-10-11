'use client';

import { useState } from 'react';
import { CalendarClock, ChevronRight, Flag, Store, Tag, type LucideIcon } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecurring,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { budgetFor, budgetMonthKey, dateKeyOfDate, formatMonthKey, formatYear, formatYen, topCategories } from '@/lib/moneyUtils';
import CategoryEditor from './CategoryEditor';
import RecurringSettings from './RecurringSettings';
import StartMonthSettings from './StartMonthSettings';
import StoreSettings from './StoreSettings';
import { FullScreen, ScreenHeader } from './moneyVisual';

// 家計の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/MoneySettings.tsx` と同じ並び・文言。
//
// カテゴリ・予算・固定費・よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
// （お店の名前を直しても、過去の記録のお店の名前はそのまま）。
// 戻る操作（ブラウザの戻る）は、開いている設定の面から入口へ、入口から家計タブへ。

interface MoneySettingsProps {
  familyId: string;
  /** 予算・特別費の予定を最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  /** 毎月の記録の出金元・入金先を選ぶのに使う（出金元そのものは「口座」の面で直す）。 */
  wallets: MoneyWallet[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  /** 年・累計を数え始める月（YYYY-MM）。null は全部の月を数える。 */
  startMonth: string | null;
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStartMonth: (startMonth: string | null) => void;
  onClose: () => void;
}

type Page = 'menu' | 'categories' | 'stores' | 'recurring' | 'start';

export default function MoneySettings({
  familyId,
  year,
  categories,
  budgets,
  stores,
  wallets,
  recurring,
  records,
  startMonth,
  onCategories,
  onBudgets,
  onStores,
  onRecurring,
  onStartMonth,
  onClose,
}: MoneySettingsProps) {
  const [page, setPage] = useState<Page>('menu');

  const tops = topCategories(categories, 'living', true).filter((top) => !top.archived);
  const totalBudget = tops.reduce((sum, top) => sum + (budgetFor(budgets, top.id, budgetMonthKey(year, dateKeyOfDate(new Date()))) ?? 0), 0);
  const storeCount = stores.filter((store) => !store.archived).length;
  const recurringCount = recurring.filter((rule) => !rule.archived).length;

  const rows: { id: Exclude<Page, 'menu'>; label: string; summary: string; icon: LucideIcon }[] = [
    {
      id: 'categories',
      label: 'カテゴリ・予算',
      summary: `支出の大分類 ${tops.length}個・月の予算 ${formatYen(totalBudget)}（${formatYear(year)}）`,
      icon: Tag,
    },
    { id: 'recurring', label: '固定費', summary: `給料なども含む ${recurringCount}件（自動で記録）`, icon: CalendarClock },
    { id: 'stores', label: 'よく行くお店', summary: `登録したお店 ${storeCount}件`, icon: Store },
    {
      id: 'start',
      label: '集計の開始月',
      summary: startMonth === null ? 'すべての月を数える' : `${formatMonthKey(startMonth)}から（年と累計に入る月）`,
      icon: Flag,
    },
  ];

  const back = () => setPage('menu');

  return (
    <FullScreen onBack={onClose}>
      {(page === 'menu' || page === 'categories') && (
        <>
          <ScreenHeader title="家計の設定" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 p-4">
            <p className="pb-1 text-[13px] leading-relaxed text-gray-500">
              カテゴリ・予算・固定費・よく行くお店・集計の開始月を、いつでも編集・追加できます。直すのは設定だけで、記録は変わりません。
            </p>
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setPage(row.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 text-left hover:bg-gray-50"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-800">
                    <Icon size={20} />
                  </span>
                  <span className="flex-1">
                    <span className="block text-base font-bold text-gray-900">{row.label}</span>
                    <span className="mt-0.5 block text-xs text-gray-500 tabular-nums">{row.summary}</span>
                  </span>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>
              );
            })}
          </div>
        </>
      )}
      {page === 'start' && (
        <StartMonthSettings familyId={familyId} startMonth={startMonth} onSaved={onStartMonth} onBack={back} />
      )}
      {page === 'stores' && <StoreSettings familyId={familyId} stores={stores} onStores={onStores} onBack={back} />}
      {page === 'recurring' && (
        <RecurringSettings
          familyId={familyId}
          recurring={recurring}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          stores={stores}
          records={records}
          onRecurring={onRecurring}
          onStores={onStores}
          onBack={back}
        />
      )}
      {page === 'categories' && (
        <CategoryEditor
          familyId={familyId}
          year={year}
          categories={categories}
          budgets={budgets}
          onCategories={onCategories}
          onBudgets={onBudgets}
          onClose={back}
        />
      )}
    </FullScreen>
  );
}
