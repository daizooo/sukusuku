'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import type {
  HouseholdProduct,
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecurring,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { useSwipeTabs } from '../ui/useSwipeTabs';
import {
  archiveMoneyWallet,
  deleteMoneyRecord,
  deleteMoneyWalletBalance,
  insertMoneyWallet,
  loadMoneyStores,
  restoreMoneyWallet,
  saveMoneyRecord,
  saveMoneyWalletBalance,
  updateMoneyWallet,
} from '@/lib/api/money';
import {
  archiveSecurity,
  loadSecurities,
  loadSecurityHistory,
  requestSecurityBackfill,
  saveSecurity,
} from '@/lib/api/moneySecurities';
import { loadHouseholdProducts } from '@/lib/api/householdProducts';
import { loadMoneyBootstrap, type MoneyBootstrap } from '@/lib/api/moneyBootstrap';
import { fiscalYearOfMonth, monthKeyOf, monthKeyOfDate, specialActualsFromRecords } from '@/lib/moneyUtils';
import MoneyAccountsView from '../money/MoneyAccountsView';
import MoneyRecordsView from '../money/MoneyRecordsView';
import MoneyReviewView from '../money/MoneyReviewView';
import RecordEditor from '../money/RecordEditor';
import CategoryEditor from '../money/CategoryEditor';
import MoneySettings from '../money/MoneySettings';
import { type ReviewPeriod } from '../money/moneyVisual';
import SpecialPanel from '../living/SpecialPanel';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * mobile版の `mobile/app/(tabs)/money.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「記録 / 振り返り / 特別費 / 口座」の4つ。記録の追加は右下の丸いボタン「＋」（Zaim と同じ。§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額（特別費を除く）と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 振り返り: 月と年は同じ面で、送りの右「月 / 年」で期間を切り替える（§4）。結論は2つ:
 *   生活費の収支（収入 − 特別費以外の支出。貯金は入れない）と、特別費（その期間に払った額と年度の予算の残り）
 * - 特別費: 年度の予定と実績の一覧・設定（「振り返り」の年と同じ年度を見る）
 * - 口座: 総残高と出金元ごとの残高（確定した残高 + その後の記録）。残高の確定、出金元の追加・編集もここ（§9.3）
 * - 見出しの右の歯車は「家計の設定」（予算・種類・お店・毎月の記録。docs/kakei.md §3.5）
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

type MoneyView = 'records' | 'review' | 'special' | 'accounts';

const VIEWS: { id: MoneyView; label: string }[] = [
  // 口座を一番左にし、はじめに開く面にする（2026-10-08。docs/kakei.md §2）。
  { id: 'accounts', label: '口座' },
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
  { id: 'special', label: '特別費' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

const NO_SECURITIES: MoneySecuritiesData = { securities: [], holdings: [], values: [], historyLoaded: true };

export default function MoneyTab({ familyId }: { familyId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [budgets, setBudgets] = useState<MoneyBudget[]>([]);
  const [wallets, setWallets] = useState<MoneyWallet[]>([]);
  const [stores, setStores] = useState<MoneyStore[]>([]);
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [recurring, setRecurring] = useState<MoneyRecurring[]>([]);
  const [balances, setBalances] = useState<MoneyWalletBalance[]>([]);
  const [securities, setSecurities] = useState<MoneySecuritiesData>(NO_SECURITIES);
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<MoneyView>('accounts');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOfMonth(monthKeyOfDate(new Date())));
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 評価額の履歴（推移用）は、推移・証券口座の詳細を開くまで読まない。一度読んだら、読み直しでも履歴まで読む。
  const historyWanted = useRef(false);
  const historyLoading = useRef(false);

  /** 読んだものを画面に入れる。 */
  const apply = useCallback(
    ({ money, products: loadedProducts, special, securities: loadedSecurities }: MoneyBootstrap) => {
      setCategories(money.categories);
      setBudgets(money.budgets);
      setWallets(money.wallets);
      setStores(money.stores);
      setRecords(money.records);
      setRecurring(money.recurring);
      setBalances(money.balances);
      setSecurities(loadedSecurities);
      setProducts(loadedProducts);
      setSpecialItems(special);
    },
    [],
  );
  // 起動で読むものは、DBの money_bootstrap で1回にまとめて読む（docs/kakei.md §9.2.6）。
  const fetchAll = useCallback(
    () => loadMoneyBootstrap(supabase, familyId, historyWanted.current),
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

  const needSecurityHistory = useCallback(async () => {
    historyWanted.current = true;
    if (historyLoading.current) return;
    historyLoading.current = true;
    try {
      const values = await loadSecurityHistory(supabase, familyId);
      setSecurities((prev) => ({ ...prev, values, historyLoaded: true }));
    } catch {
      // 読めなかったら「読み込み中」のまま。開き直すと読み直す。
    } finally {
      historyLoading.current = false;
    }
  }, [supabase, familyId]);

  const specialActuals = useMemo(() => specialActualsFromRecords(records), [records]);

  /** 振り返りの月 ↔ 年。年へ行くときは今見ている月の年度を、月へ戻るときは見ている年度の月を開く。 */
  const changePeriod = (next: ReviewPeriod) => {
    if (next === 'year') {
      setFiscalYear(fiscalYearOfMonth(monthKey));
    } else if (fiscalYearOfMonth(monthKey) !== fiscalYear) {
      const current = monthKeyOfDate(new Date());
      setMonthKey(fiscalYearOfMonth(current) === fiscalYear ? current : `${fiscalYear}-04`);
    }
    setPeriod(next);
  };
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
      // 「お店に登録して使う」を選んだお店は、DBの save_money_record がお店の設定に登録する（docs/kakei.md §3.5）。
      if (draft.registerStore && saved.store !== '' && !stores.some((entry) => entry.name === saved.store && !entry.archived)) {
        setStores(await loadMoneyStores(supabase, familyId));
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

  /**
   * 銘柄を保存する（docs/kakei.md §9.2）。足したとき・コードを変えたときは、サーバーに過去1年の価格と
   * 評価額を作らせてから読み直す（数秒かかる。先に保存した分を出しておく）。
   */
  const saveSecurityOf = async (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => {
    try {
      const { securityId, needsBackfill } = await saveSecurity(
        supabase,
        familyId,
        walletId,
        target,
        draft,
        securities.holdings,
        securities.securities.reduce((max, security) => Math.max(max, security.position + 1), 0),
      );
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
      if (needsBackfill) {
        await requestSecurityBackfill(supabase, securityId);
        setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
      }
    } catch {
      failed('保存');
    }
  };

  const archiveSecurityOf = async (walletId: string, security: MoneySecurity) => {
    try {
      await archiveSecurity(supabase, walletId, security);
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
    } catch {
      failed('保存');
    }
  };

  const restoreWallet = async (wallet: MoneyWallet) => {
    try {
      const saved = await restoreMoneyWallet(supabase, wallet.id);
      setWallets((prev) => prev.map((entry) => (entry.id === saved.id ? saved : entry)));
    } catch {
      failed('保存');
    }
  };

  /** 残高を確定する。同じ出金元・同じ日の確定は上書きされる。 */
  const confirmBalance = async (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => {
    try {
      const saved = await saveMoneyWalletBalance(supabase, familyId, walletId, balanceOn, amount, showInHistory);
      setBalances((prev) => [
        ...prev.filter((entry) => !(entry.walletId === saved.walletId && entry.balanceOn === saved.balanceOn)),
        saved,
      ]);
    } catch {
      failed('確定');
    }
  };

  const removeBalance = async (balance: MoneyWalletBalance) => {
    const previous = balances;
    setBalances((prev) => prev.filter((entry) => entry.id !== balance.id));
    try {
      await deleteMoneyWalletBalance(supabase, balance.id);
    } catch {
      setBalances(previous);
      failed('取り消し');
    }
  };

  // 口座/記録/振り返り/特別費は、帯と中身の上の左右スワイプでも切り替える
  // 帯の下の中身は指に合わせて横に動く。
  const { handlers: swipeHandlers, attachContent } = useSwipeTabs(
    VIEWS.map((entry) => entry.id),
    view,
    setView,
  );

  return (
    <div className="relative p-4 pb-0 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center pb-1">
        <h2 className="text-lg font-bold text-gray-900">家計</h2>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="家計の設定"
          onClick={() => setSettingsOpen(true)}
          className="p-0.5 text-gray-700 hover:text-gray-900"
        >
          <Settings size={22} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" {...swipeHandlers}>
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

        <div ref={attachContent} className="flex min-h-0 flex-1 flex-col">
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
          ) : view === 'review' ? (
            <MoneyReviewView
              period={period}
              onPeriod={changePeriod}
              monthKey={monthKey}
              onMonth={setMonthKey}
              fiscalYear={fiscalYear}
              onFiscalYear={setFiscalYear}
              records={records}
              categories={categories}
              budgets={budgets}
              specialItems={specialItems}
              specialActuals={specialActuals}
              onSelectMonth={(next) => {
                setMonthKey(next);
                setPeriod('month');
              }}
              onEditCategories={() => setEditingCategories(true)}
              onOpenSpecial={() => {
                // 「特別費」の面は振り返りの年度を見るので、月の振り返りから来たらその月の年度にそろえる。
                if (period === 'month') setFiscalYear(fiscalYearOfMonth(monthKey));
                setView('special');
              }}
            />
          ) : view === 'special' ? (
            <SpecialPanel
              familyId={familyId}
              fiscalYear={fiscalYear}
              onFiscalYear={setFiscalYear}
              onRecordsChanged={() => void reload().catch(() => {})}
            />
          ) : (
            <MoneyAccountsView
              wallets={wallets}
              records={records}
              balances={balances}
              securities={securities}
              categories={categories}
              specialItems={specialItems}
              isLoading={isLoading}
              onOpenRecord={setEditing}
              onConfirm={(walletId, balanceOn, amount, showInHistory) => void confirmBalance(walletId, balanceOn, amount, showInHistory)}
              onDeleteBalance={(balance) => void removeBalance(balance)}
              onSaveWallet={saveWallet}
              onArchiveWallet={(wallet) => void archiveWallet(wallet)}
              onRestoreWallet={(wallet) => void restoreWallet(wallet)}
              onSaveSecurity={(walletId, target, draft) => void saveSecurityOf(walletId, target, draft)}
              onArchiveSecurity={(walletId, security) => void archiveSecurityOf(walletId, security)}
              onNeedSecurityHistory={needSecurityHistory}
            />
          )}
        </div>
      </div>

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
          stores={stores}
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

      {settingsOpen && (
        <MoneySettings
          familyId={familyId}
          fiscalYear={fiscalYearOfMonth(monthKey)}
          categories={categories}
          budgets={budgets}
          stores={stores}
          wallets={wallets}
          recurring={recurring}
          records={records}
          specialItems={specialItems}
          specialActuals={specialActuals}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onStores={setStores}
          onRecurring={setRecurring}
          onClose={() => setSettingsOpen(false)}
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
