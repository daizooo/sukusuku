'use client';

import { useState } from 'react';
import { ArrowLeftRight, ChevronRight, Mail, PiggyBank, Store, Tag, type LucideIcon } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedData,
  MoneyRatioTargets,
  MoneyRecord,
  MoneyRecurring,
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
// 年間予算（予算・カテゴリ・自動記録をまとめて決める。2026-10-23。docs/kakei.md §0.8）（目標割合〔§0.9〕もここで決める。2026-10-24）・カテゴリ（アイコン・並び）・振替の自動記録・
// よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
// （お店の名前を直しても、過去の記録のお店の名前はそのまま）。
// 戻る操作（ブラウザの戻る）は、開いている設定の面から入口へ、入口から家計タブへ。

interface MoneySettingsProps {
  familyId: string;
  /** 予算を最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  /** 変動費の月の予算（予算の行から作ったもの。取り込みの設定で使う）。 */
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  /** 毎月の記録の出金元・入金先を選ぶのに使う（出金元そのものは「口座」の面で直す）。 */
  wallets: MoneyWallet[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  /** 開いたときに編集を開く振替の自動記録。 */
  initialRecurringId?: string | null;
  /** 目標割合（docs/kakei.md §0.9）。 */
  ratioTargets: MoneyRatioTargets;
  onRatioTargets: (targets: MoneyRatioTargets) => void;
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
  onStores,
  onRecurring,
  initialRecurringId = null,
  ratioTargets,
  onRatioTargets,
  feed,
  onFeedChanged,
  onClose,
}: MoneySettingsProps) {
  const [page, setPage] = useState<Page>(() => {
    const rule = recurring.find((entry) => entry.id === initialRecurringId);
    return rule ? 'recurring' : 'menu';
  });
  // 自動記録ルールの編集を開くルール（記録の詳細などから）。
  const [recurringTarget, setRecurringTarget] = useState<string | null>(initialRecurringId);

  const rows: { id: Exclude<Page, 'menu'>; label: string; icon: LucideIcon }[] = [
    { id: 'budget', label: '年間予算', icon: PiggyBank },
    { id: 'categories', label: 'カテゴリ', icon: Tag },
    { id: 'recurring', label: '振替', icon: ArrowLeftRight },
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
        <CategoryEditor familyId={familyId} categories={categories} onCategories={onCategories} onClose={back} />
      )}
      {page === 'budget' && (
        <BudgetEditor
          familyId={familyId}
          year={year}
          categories={categories}
          recurring={recurring}
          wallets={wallets}
          stores={stores}
          records={records}
          ratioTargets={ratioTargets}
          onCategories={onCategories}
          onRecurring={onRecurring}
          onStores={onStores}
          onRatioTargets={onRatioTargets}
          onClose={back}
        />
      )}
    </FullScreen>
  );
}
