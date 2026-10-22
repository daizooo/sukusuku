'use client';

import { useState } from 'react';
import { CalendarClock, ChevronRight, Mail, PiggyBank, Store, Tag, type LucideIcon } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedData,
  MoneyRecord,
  MoneyRecurring,
  MoneyReserve,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import CategoryEditor from './CategoryEditor';
import BudgetEditor from './BudgetEditor';
import RecurringSettings from './RecurringSettings';
import StoreSettings from './StoreSettings';
import MoneyFeedSettings from './MoneyFeedSettings';
import { FullScreen, ScreenHeader } from './moneyVisual';

// 家計の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/MoneySettings.tsx` と同じ並び・文言。
//
// カテゴリ・予算（年ごと。2026-10-15にカテゴリと分けた）・固定費（支出・収入〔給与・賞与〕・振替）・よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
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
  /** 予備費の年の額（docs/kakei.md §3.7）。 */
  reserves: MoneyReserve[];
  onReserves: (update: (prev: MoneyReserve[]) => MoneyReserve[]) => void;
  /** 開いたときに編集を開く固定支出（予算の画面の固定費から来たとき）。 */
  initialRecurringId?: string | null;
  /** Zaim 取り込み（docs/kakei.md §9.5.6）。null は読み込み中。 */
  feed: MoneyFeedData | null;
  /** 取り込みの設定を直したあとに読み直す。 */
  onFeedChanged: () => Promise<void>;
  onClose: () => void;
}

type Page = 'menu' | 'categories' | 'budget' | 'stores' | 'recurring' | 'feed';

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
  reserves,
  onReserves,
  initialRecurringId = null,
  feed,
  onFeedChanged,
  onClose,
}: MoneySettingsProps) {
  const [page, setPage] = useState<Page>(() => {
    const rule = recurring.find((entry) => entry.id === initialRecurringId);
    return rule ? 'recurring' : 'menu';
  });
  // 固定支出の編集を開くルール（予算の画面の固定費の行から）。
  const [recurringTarget, setRecurringTarget] = useState<string | null>(initialRecurringId);
  const openRecurring = (id: string) => {
    const rule = recurring.find((entry) => entry.id === id);
    if (!rule) return;
    setRecurringTarget(id);
    setPage('recurring');
  };

  const rows: { id: Exclude<Page, 'menu'>; label: string; icon: LucideIcon }[] = [
    { id: 'categories', label: 'カテゴリ', icon: Tag },
    { id: 'budget', label: '年間予算', icon: PiggyBank },
    { id: 'recurring', label: '自動記録ルール（支出、収入、振替）', icon: CalendarClock },
    { id: 'stores', label: 'よく行くお店', icon: Store },
    { id: 'feed', label: 'Gmail 取り込み', icon: Mail },
  ];

  const back = () => {
    setRecurringTarget(null);
    setPage('menu');
  };

  return (
    <FullScreen onBack={onClose}>
      {(page === 'menu' || page === 'categories' || page === 'budget') && (
        <>
          <ScreenHeader title="家計の設定" onClose={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 p-4">
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
                  <span className="flex-1 text-base font-bold text-gray-900">{row.label}</span>
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
      {page === 'recurring' && (
        <RecurringSettings
          key={recurringTarget ?? 'list'}
          familyId={familyId}
          recurring={recurring}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          stores={stores}
          records={records}
          onRecurring={onRecurring}
          initialEditId={recurringTarget}
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
          onRecurring={onRecurring}
          reserves={reserves}
          onReserves={onReserves}
          onOpenRecurring={openRecurring}
          onClose={back}
        />
      )}
    </FullScreen>
  );
}
