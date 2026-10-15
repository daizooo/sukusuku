'use client';

import { useState } from 'react';
import { Banknote, CalendarClock, ChevronRight, Mail, PiggyBank, Store, Tag, type LucideIcon } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedData,
  MoneyRecord,
  MoneyRecurring,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { budgetFor, formatYear, formatYen, topCategories, yearMonthKeys } from '@/lib/moneyUtils';
import CategoryEditor from './CategoryEditor';
import BudgetEditor from './BudgetEditor';
import RecurringSettings from './RecurringSettings';
import StoreSettings from './StoreSettings';
import MoneyFeedSettings from './MoneyFeedSettings';
import { FullScreen, ScreenHeader } from './moneyVisual';

// 家計の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/MoneySettings.tsx` と同じ並び・文言。
//
// カテゴリ・予算（年ごと。2026-10-15にカテゴリと分けた）・固定支出・固定収入（給与・賞与）・よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
// （お店の名前を直しても、過去の記録のお店の名前はそのまま）。
// 戻る操作（ブラウザの戻る）は、開いている設定の面から入口へ、入口から家計タブへ。

interface MoneySettingsProps {
  familyId: string;
  /** 予算を最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  /** 毎月の記録の出金元・入金先を選ぶのに使う（出金元そのものは「口座」の面で直す）。 */
  wallets: MoneyWallet[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  /** Zaim 取り込み（docs/kakei.md §9.5.6）。null は読み込み中。 */
  feed: MoneyFeedData | null;
  /** 取り込みの設定を直したあとに読み直す。 */
  onFeedChanged: () => Promise<void>;
  onClose: () => void;
}

type Page = 'menu' | 'categories' | 'budget' | 'stores' | 'recurring' | 'income' | 'feed';

export default function MoneySettings({
  familyId,
  year,
  categories,
  budgets,
  stores,
  wallets,
  recurring,
  records,
  onCategories,
  onBudgets,
  onStores,
  onRecurring,
  feed,
  onFeedChanged,
  onClose,
}: MoneySettingsProps) {
  const [page, setPage] = useState<Page>('menu');

  const tops = topCategories(categories, 'living', true).filter((top) => !top.archived);
  const yearBudget = tops.reduce(
    (sum, top) => sum + yearMonthKeys(year).reduce((inner, key) => inner + (budgetFor(budgets, top.id, key) ?? 0), 0),
    0,
  );
  const childCount = categories.filter((category) => category.parentId !== null).length;
  const storeCount = stores.filter((store) => !store.archived).length;
  const recurringCount = recurring.filter((rule) => !rule.archived && rule.kind !== 'income').length;
  const incomeCount = recurring.filter((rule) => !rule.archived && rule.kind === 'income').length;

  const rows: { id: Exclude<Page, 'menu'>; label: string; summary: string; icon: LucideIcon }[] = [
    { id: 'categories', label: 'カテゴリ', summary: `支出の大分類 ${tops.length}個・小分類 ${childCount}個`, icon: Tag },
    { id: 'budget', label: '予算', summary: `${formatYear(year)}の支出の予算 年${formatYen(yearBudget)}（年ごとに決める）`, icon: PiggyBank },
    { id: 'recurring', label: '固定支出', summary: `${recurringCount}件（自動で記録）`, icon: CalendarClock },
    { id: 'income', label: '固定収入', summary: `給与・賞与 ${incomeCount}件（自動で記録）`, icon: Banknote },
    { id: 'stores', label: 'よく行くお店', summary: `登録したお店 ${storeCount}件`, icon: Store },
    {
      id: 'feed',
      label: 'Gmail 取り込み',
      summary: feed ? `口座の対応・取り込みのルール ${feed.rules.length}件` : '口座の対応・取り込みのルール',
      icon: Mail,
    },
  ];

  const back = () => setPage('menu');

  return (
    <FullScreen onBack={onClose}>
      {(page === 'menu' || page === 'categories' || page === 'budget') && (
        <>
          <ScreenHeader title="家計の設定" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 p-4">
            <p className="pb-1 text-[13px] leading-relaxed text-gray-500">
              カテゴリ・予算・固定支出・固定収入・よく行くお店・Gmail 取り込みを、いつでも編集・追加できます。直すのは設定だけで、記録は変わりません。
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
      {page === 'stores' && <StoreSettings familyId={familyId} stores={stores} onStores={onStores} onBack={back} />}
      {page === 'feed' && (
        <MoneyFeedSettings
          familyId={familyId}
          feed={feed}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          records={records}
          recurring={recurring}
          onChanged={onFeedChanged}
          onBack={back}
        />
      )}
      {(page === 'recurring' || page === 'income') && (
        <RecurringSettings
          mode={page === 'income' ? 'income' : 'expense'}
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
        <CategoryEditor familyId={familyId} categories={categories} onCategories={onCategories} onBudgets={onBudgets} onClose={back} />
      )}
      {page === 'budget' && (
        <BudgetEditor
          familyId={familyId}
          year={year}
          categories={categories}
          budgets={budgets}
          recurring={recurring}
          records={records}
          onBudgets={onBudgets}
          onClose={back}
        />
      )}
    </FullScreen>
  );
}
