'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Settings, Ticket } from 'lucide-react';
import type {
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
import { useFamilyRefresh } from '@/lib/familySync';
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
import { loadMoneyBootstrap, type MoneyBootstrap } from '@/lib/api/moneyBootstrap';
import { monthKeyOf, monthKeyOfDate, specialActualsFromRecords, yearOfMonth } from '@/lib/moneyUtils';
import MoneyAccountsView from '../money/MoneyAccountsView';
import MoneyRecordsView from '../money/MoneyRecordsView';
import MoneyReviewView from '../money/MoneyReviewView';
import RecordEditor from '../money/RecordEditor';
import CategoryEditor from '../money/CategoryEditor';
import MoneySettings from '../money/MoneySettings';
import { type ReviewPeriod } from '../money/moneyVisual';
import LotteryScreen from './LotteryScreen';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * mobile版の `mobile/app/(tabs)/money.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「口座 / 記録 / 振り返り」の3つ。記録の追加は右下の丸いボタン「＋」（Zaim と同じ。§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額（特別費を除く）と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 振り返り: 月と年（暦年）は同じ面で、送りの右「月 / 年」で期間を切り替える（§4）。結論は生活費の収支
 *   （収入 − 特別費以外の支出。貯金は入れない）。内訳の行（大分類・特別費）を押すと、簡単な分析と絞った記録の一覧（§4.4）
 * - 口座: 総残高と出金元ごとの残高（確定した残高 + その後の記録）。残高の確定、出金元の追加・編集もここ（§9.3）
 * - 見出しは出さない（2026-10-10。切り替えの帯が見出しを兼ねる）。右下の＋の左に小さなピルを置き、中に「福引チャンス」
 *   （紫のチケット。暮らしタブの廃止で移した。docs/home.md §9）と「家計の設定」（グレーの歯車。カテゴリと予算・特別費の予定・
 *   お店・毎月の記録。docs/kakei.md §3.5）を並べる。＋はどの面にも出ているので、どの面からも入れる
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

type MoneyView = 'records' | 'review' | 'accounts';

const VIEWS: { id: MoneyView; label: string }[] = [
  // 口座を一番左にし、はじめに開く面にする（2026-10-08。docs/kakei.md §2）。
  { id: 'accounts', label: '口座' },
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

const NO_SECURITIES: MoneySecuritiesData = { securities: [], holdings: [], values: [], historyLoaded: true };

/** 家計の読み込み（money_bootstrap と証券の評価額）が読む表。mobile版（mobile/app/(tabs)/money.tsx）と同じ。 */
const MONEY_TABLES = [
  'money_budgets',
  'money_categories',
  'money_holding_values',
  'money_holdings',
  'money_items',
  'money_records',
  'money_recurring',
  'money_securities',
  'money_stores',
  'money_wallet_balances',
  'money_wallets',
  'special_items',
  'special_plans',
] as const;

export default function MoneyTab({ familyId, userId }: { familyId: string; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [budgets, setBudgets] = useState<MoneyBudget[]>([]);
  const [wallets, setWallets] = useState<MoneyWallet[]>([]);
  const [stores, setStores] = useState<MoneyStore[]>([]);
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [recurring, setRecurring] = useState<MoneyRecurring[]>([]);
  const [balances, setBalances] = useState<MoneyWalletBalance[]>([]);
  const [securities, setSecurities] = useState<MoneySecuritiesData>(NO_SECURITIES);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<MoneyView>('accounts');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 福引チャンスの画面を開いているか。開いているあいだは家計の代わりにその画面を出す（戻る操作で家計へ戻る）。
  const [lotteryOpen, setLotteryOpen] = useState(false);

  // 評価額の履歴（推移用）は、推移・証券口座の詳細を開くまで読まない。一度読んだら、読み直しでも履歴まで読む。
  const historyWanted = useRef(false);
  const historyLoading = useRef(false);

  /** 読んだものを画面に入れる。 */
  const apply = useCallback(
    ({ money, special, securities: loadedSecurities }: MoneyBootstrap) => {
      setCategories(money.categories);
      setBudgets(money.budgets);
      setWallets(money.wallets);
      setStores(money.stores);
      setRecords(money.records);
      setRecurring(money.recurring);
      setBalances(money.balances);
      setSecurities(loadedSecurities);
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

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 家計の表が変わったときだけ読む（money_bootstrap が読む表。docs/kakei.md §9.2.6）。
  useFamilyRefresh(MONEY_TABLES, () => {
    reload().catch(() => {
      // 圏外なら前に読んだ分を出したままにする。
    });
  });

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

  /** 振り返りの月 ↔ 年。年へ行くときは今見ている月の年を、月へ戻るときは見ている年の月を開く。 */
  const changePeriod = (next: ReviewPeriod) => {
    if (next === 'year') {
      setYear(yearOfMonth(monthKey));
    } else if (yearOfMonth(monthKey) !== year) {
      const current = monthKeyOfDate(new Date());
      setMonthKey(yearOfMonth(current) === year ? current : `${year}-01`);
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

  if (lotteryOpen) {
    return <LotteryScreen familyId={familyId} userId={userId} onClose={() => setLotteryOpen(false)} />;
  }

  return (
    <div className="relative p-4 pb-0 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="flex min-h-0 flex-1 flex-col" {...swipeHandlers}>
        {/* 3つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。 */}
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
              year={year}
              onYear={setYear}
              records={records}
              categories={categories}
              budgets={budgets}
              wallets={wallets}
              specialItems={specialItems}
              specialActuals={specialActuals}
              onSelectMonth={(next) => {
                setMonthKey(next);
                setPeriod('month');
              }}
              onEditCategories={() => setEditingCategories(true)}
              onOpenRecord={setEditing}
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

      {/* 福引チャンスと家計の設定。＋の左に小さなピルで置く（福引は紫で福引らしさを出し、設定は控えめなグレー）。 */}
      <div className="absolute bottom-[17px] right-[68px] z-20 flex h-10 items-center overflow-hidden rounded-full border border-gray-200 bg-white shadow-md">
        <button
          type="button"
          aria-label="福引チャンス"
          onClick={() => setLotteryOpen(true)}
          className="flex h-10 w-11 items-center justify-center bg-purple-50 text-purple-600 hover:bg-purple-100"
        >
          <Ticket size={20} />
        </button>
        <button
          type="button"
          aria-label="家計の設定"
          onClick={() => setSettingsOpen(true)}
          className="flex h-10 w-11 items-center justify-center text-gray-500 hover:bg-gray-50"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* 記録の追加は右下の丸いボタン（Zaim と同じ）。どの面でも同じ場所。 */}
      <button
        type="button"
        aria-label="記録を追加"
        onClick={() => setEditing('new')}
        className="absolute bottom-4 right-4 z-20 flex h-[42px] w-[42px] items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-105 active:scale-95"
      >
        <Plus size={22} />
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
          year={yearOfMonth(monthKey)}
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
          onSpecialItems={setSpecialItems}
          onRecordsChanged={() => void reload().catch(() => {})}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editingCategories && (
        <CategoryEditor
          familyId={familyId}
          year={yearOfMonth(monthKey)}
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
