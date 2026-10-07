'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type {
  HouseholdProduct,
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyWallet,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  archiveMoneyWallet,
  deleteMoneyRecord,
  insertMoneyWallet,
  loadMoney,
  saveMoneyRecord,
  updateMoneyWallet,
  type MoneyData,
} from '@/lib/api/money';
import { loadHouseholdProducts } from '@/lib/api/householdProducts';
import { loadSpecialExpenses } from '@/lib/api/specialExpenses';
import { fiscalYearOfMonth, monthKeyOf, monthKeyOfDate, specialActualsFromRecords } from '@/lib/moneyUtils';
import MoneyRecordsView from '../money/MoneyRecordsView';
import MoneyMonthView from '../money/MoneyMonthView';
import RecordEditor from '../money/RecordEditor';
import CategoryEditor from '../money/CategoryEditor';
import MoneyYearView from '../money/MoneyYearView';
import SpecialPanel from '../living/SpecialPanel';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * mobile版の `mobile/app/(tabs)/money.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「記録 / 月 / 年 / 特別費」の4つ。記録の追加は右下の丸いボタン「＋」（Zaim と同じ。§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額（特別費を除く）と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 月: 月の収支（収入 − 生活費 − 貯金）と内訳、生活費の大分類の小さな一覧（特別費は出さない）。
 *   種類と予算はここから直す
 * - 年: 年度の収支と内訳、月ごとの収支（押すとその月へ）
 * - 特別費: 年度の予定と実績（「年」と同じ年度を見る）。特別費の数字はこの面だけに出す
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

type MoneyView = 'records' | 'month' | 'year' | 'special';

const VIEWS: { id: MoneyView; label: string }[] = [
  { id: 'records', label: '記録' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
  { id: 'special', label: '特別費' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

export default function MoneyTab({ familyId }: { familyId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [budgets, setBudgets] = useState<MoneyBudget[]>([]);
  const [wallets, setWallets] = useState<MoneyWallet[]>([]);
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<MoneyView>('records');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOfMonth(monthKeyOfDate(new Date())));
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);

  /** 読んだものを画面に入れる。 */
  const apply = useCallback(
    ([money, loadedProducts, special]: [MoneyData, HouseholdProduct[], { items: SpecialItem[] }]) => {
      setCategories(money.categories);
      setBudgets(money.budgets);
      setWallets(money.wallets);
      setRecords(money.records);
      setProducts(loadedProducts);
      setSpecialItems(special.items);
    },
    [],
  );
  const fetchAll = useCallback(
    () =>
      Promise.all([
        loadMoney(supabase, familyId),
        loadHouseholdProducts(supabase, familyId),
        loadSpecialExpenses(supabase, familyId),
      ]),
    [supabase, familyId],
  );
  const reload = () => fetchAll().then(apply);

  useEffect(() => {
    let isMounted = true;
    fetchAll()
      .then((loaded) => {
        if (isMounted) apply(loaded);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [fetchAll, apply]);

  const specialActuals = useMemo(() => specialActualsFromRecords(records), [records]);
  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  const saveRecord = async (draft: MoneyRecordDraft) => {
    setEditing(null);
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 日用品の台帳の「いつもの値段」が変わるので読み直す（DBの save_money_record が直す）。
      if (saved.items.some((item) => item.productId !== null)) {
        setProducts(await loadHouseholdProducts(supabase, familyId));
      }
    } catch {
      failed('保存');
    }
  };

  const removeRecord = async (record: MoneyRecord) => {
    setEditing(null);
    const previous = records;
    setRecords((prev) => prev.filter((entry) => entry.id !== record.id));
    try {
      await deleteMoneyRecord(supabase, record.id);
    } catch {
      setRecords(previous);
      failed('削除');
    }
  };

  const saveWallet = async (target: MoneyWallet | null, draft: MoneyWalletDraft): Promise<MoneyWallet | null> => {
    try {
      const saved =
        target === null
          ? await insertMoneyWallet(
              supabase,
              familyId,
              draft,
              wallets.reduce((max, wallet) => Math.max(max, wallet.position + 1), 0),
            )
          : await updateMoneyWallet(supabase, target.id, draft);
      setWallets((prev) => [...prev.filter((wallet) => wallet.id !== saved.id), saved]);
      return saved;
    } catch {
      failed('保存');
      return null;
    }
  };

  const archiveWallet = async (wallet: MoneyWallet) => {
    try {
      const saved = await archiveMoneyWallet(supabase, wallet.id);
      setWallets((prev) => prev.map((entry) => (entry.id === saved.id ? saved : entry)));
    } catch {
      failed('保存');
    }
  };

  return (
    <div className="relative p-4 pb-0 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <h2 className="shrink-0 pb-1 text-lg font-bold text-gray-900">家計</h2>
      {/* 4つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。 */}
      <div role="tablist" className="shrink-0 flex border-b border-gray-200">
        {VIEWS.map((entry) => {
          const selected = entry.id === view;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setView(entry.id)}
              className="flex flex-1 flex-col items-center pt-2"
            >
              <span className={`text-[15px] ${selected ? 'font-bold text-gray-900' : 'font-semibold text-gray-400'}`}>
                {entry.label}
              </span>
              <span className={`mt-2 h-[3px] w-8 rounded-full ${selected ? 'bg-blue-600' : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      {view === 'records' ? (
        <MoneyRecordsView
          monthKey={monthKey}
          onMonth={setMonthKey}
          records={records}
          categories={categories}
          wallets={wallets}
          specialItems={specialItems}
          isLoading={isLoading}
          onOpen={setEditing}
        />
      ) : view === 'month' ? (
        <MoneyMonthView
          monthKey={monthKey}
          onMonth={setMonthKey}
          records={records}
          categories={categories}
          budgets={budgets}
          wallets={wallets}
          onEditCategories={() => setEditingCategories(true)}
        />
      ) : view === 'year' ? (
        <MoneyYearView
          fiscalYear={fiscalYear}
          onFiscalYear={setFiscalYear}
          records={records}
          categories={categories}
          budgets={budgets}
          wallets={wallets}
          onSelectMonth={(next) => {
            setMonthKey(next);
            setView('month');
          }}
        />
      ) : (
        <SpecialPanel
          familyId={familyId}
          fiscalYear={fiscalYear}
          onFiscalYear={setFiscalYear}
          onRecordsChanged={() => void reload().catch(() => {})}
        />
      )}

      {/* 記録の追加は右下の丸いボタン（Zaim と同じ）。どの面でも同じ場所。 */}
      <button
        type="button"
        aria-label="記録を追加"
        onClick={() => setEditing('new')}
        className="absolute bottom-4 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-105 active:scale-95"
      >
        <Plus size={28} />
      </button>

      {editing !== null && (
        <RecordEditor
          key={editing === 'new' ? 'new' : editing.id}
          record={editing === 'new' ? null : editing}
          categories={categories}
          budgets={budgets}
          wallets={wallets}
          records={records}
          products={products}
          specialItems={specialItems}
          specialActuals={specialActuals}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void saveRecord(draft)}
          onDelete={(record) => void removeRecord(record)}
          onSaveWallet={saveWallet}
          onArchiveWallet={(wallet) => void archiveWallet(wallet)}
          onEditCategories={() => setEditingCategories(true)}
        />
      )}

      {editingCategories && (
        <CategoryEditor
          familyId={familyId}
          fiscalYear={fiscalYearOfMonth(monthKey)}
          categories={categories}
          budgets={budgets}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onClose={() => setEditingCategories(false)}
        />
      )}
    </div>
  );
}
