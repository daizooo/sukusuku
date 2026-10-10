import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Settings, Ticket } from 'lucide-react-native';
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
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import { getMyMembership } from '@/lib/api/me';
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
import { loadMoneyBootstrap } from '@/lib/api/moneyBootstrap';
import { monthKeyOf, monthKeyOfDate, specialActualsFromRecords, yearOfMonth } from '@/lib/moneyUtils';
import MoneyAccountsView from '@/components/money/MoneyAccountsView';
import MoneyRecordsView from '@/components/money/MoneyRecordsView';
import MoneyReviewView from '@/components/money/MoneyReviewView';
import RecordEditor from '@/components/money/RecordEditor';
import CategoryEditor from '@/components/money/CategoryEditor';
import MoneySettings from '@/components/money/MoneySettings';
import { type ReviewPeriod } from '@/components/money/moneyVisual';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * Web版の `src/components/sukusuku/tabs/MoneyTab.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「口座 / 記録 / 振り返り」の3つ。記録の追加は右下の丸いボタン「＋」（Zaim と同じ。§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額（特別費を除く）と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 振り返り: 月と年（暦年）は同じ面で、送りの右「月 / 年」で期間を切り替える（§4）。結論は生活費の収支
 *   （収入 − 特別費以外の支出。貯金は入れない）。内訳の行（大分類・特別費）を押すと、簡単な分析と絞った記録の一覧（§4.4）
 * - 口座: 総残高と出金元ごとの残高（確定した残高 + その後の記録）。残高の確定、出金元の追加・編集もここ（§9.3）
 * - 見出しは出さない（2026-10-10。各タブに見出しがあるが、家計は切り替えの帯が見出しを兼ねる）。帯の右端に小さなグレーの
   *   アイコンを2つ置く。チケットは「福引チャンス」（暮らしタブの廃止で移した。docs/home.md §9）、歯車は「家計の設定」
   *   （カテゴリと予算・特別費の予定・お店・毎月の記録。docs/kakei.md §3.5）
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

type View3 = 'records' | 'review' | 'accounts';

const VIEWS: { id: View3; label: string }[] = [
  // 口座を一番左にし、はじめに開く面にする（2026-10-08。docs/kakei.md §2）。
  { id: 'accounts', label: '口座' },
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

const NO_SECURITIES: MoneySecuritiesData = { securities: [], holdings: [], values: [], historyLoaded: true };

/** 家計の読み込み（money_bootstrap と証券の評価額）が読む表。 */
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

export default function MoneyScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
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
  const [view, setView] = useState<View3>('accounts');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 評価額の履歴（推移用）は、推移・証券口座の詳細を開くまで読まない。一度読んだら、読み直しでも履歴まで読む。
  const historyWanted = useRef(false);
  const historyLoading = useRef(false);

  const reload = useCallback(async (id: string) => {
    // 起動で読むものは、DBの money_bootstrap で1回にまとめて読む（docs/kakei.md §9.2.6）。
    const { money, special, securities: loadedSecurities } = await loadMoneyBootstrap(
      supabase,
      id,
      historyWanted.current,
    );
    setCategories(money.categories);
    setBudgets(money.budgets);
    setWallets(money.wallets);
    setStores(money.stores);
    setRecords(money.records);
    setRecurring(money.recurring);
    setBalances(money.balances);
    setSecurities(loadedSecurities);
    setSpecialItems(special);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        await reload(membership.familyId);
      } catch {
        // 圏外でも画面は出す。読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId, reload]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 家計の表が変わったときだけ読む（money_bootstrap が読む表。docs/kakei.md §9.2.6）。
  useFamilyRefresh(MONEY_TABLES, () => {
    if (!familyId) return;
    void reload(familyId).catch(() => {
      // 圏外なら前に読んだ分を出したままにする。
    });
  });

  const needSecurityHistory = useCallback(async () => {
    if (!familyId) return;
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
  }, [familyId]);

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
  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const saveRecord = async (draft: MoneyRecordDraft) => {
    setEditing(null);
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 「お店に登録して使う」を選んだお店は、DBの save_money_record がお店の設定に登録する（docs/kakei.md §3.5）。
      if (familyId && draft.registerStore && saved.store !== '' && !stores.some((entry) => entry.name === saved.store && !entry.archived)) {
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
    if (!familyId) return null;
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

  const restoreWallet = async (wallet: MoneyWallet) => {
    try {
      const saved = await restoreMoneyWallet(supabase, wallet.id);
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
    if (!familyId) return;
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
    if (!familyId) return;
    try {
      await archiveSecurity(supabase, walletId, security);
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
    } catch {
      failed('保存');
    }
  };

  /** 残高を確定する。同じ出金元・同じ日の確定は上書きされる。 */
  const confirmBalance = async (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => {
    if (!familyId) return;
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

  // 口座/記録/振り返りは、帯と中身の上の左右スワイプでも切り替える
  // 帯の下の中身は指に合わせて横に動く。
  const viewSwipe = useSwipeTabs(
    VIEWS.map((entry) => entry.id),
    view,
    setView,
  );

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body} {...viewSwipe.handlers}>
        <View style={styles.views}>
          <View accessibilityRole="tablist" style={styles.viewTabs}>
            {VIEWS.map((entry) => {
              const selected = entry.id === view;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setView(entry.id)}
                  style={styles.viewTab}
                >
                  <Text style={[styles.viewText, selected && styles.viewTextSelected]}>{entry.label}</Text>
                  <View style={[styles.underline, selected && styles.underlineSelected]} />
                </Pressable>
              );
            })}
          </View>
          {/* 福引チャンスと家計の設定。目立たせないよう、帯の右端に小さなグレーで置く。 */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="福引チャンス"
            onPress={() => router.push('/lottery')}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={styles.barIcon}
          >
            <Ticket size={20} color={colors.textFaint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="家計の設定"
            onPress={() => setSettingsOpen(true)}
            disabled={!familyId}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={styles.barIcon}
          >
            <Settings size={20} color={colors.textFaint} />
          </Pressable>
        </View>

        <Animated.View style={[styles.body, viewSwipe.style]}>
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
              onNeedSecurityHistory={needSecurityHistory}
              onArchiveSecurity={(walletId, security) => void archiveSecurityOf(walletId, security)}
            />
          )}
        </Animated.View>
      </View>

      {/* 記録の追加は右下の丸いボタン（Zaim と同じ）。どの面でも同じ場所。 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="記録を追加"
        onPress={() => setEditing('new')}
        disabled={!familyId}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Plus size={28} color={colors.primaryText} />
      </Pressable>

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

      {settingsOpen && familyId && (
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
          onRecordsChanged={() => {
            if (familyId) void reload(familyId).catch(() => {});
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editingCategories && familyId && (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.money,
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  // 3つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。
  views: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  viewTabs: { flex: 1, flexDirection: 'row' },
  // 帯の右端のアイコン（福引・設定）。押しやすいよう、見た目より広く押せる。
  barIcon: { paddingHorizontal: 9, paddingVertical: 8, alignSelf: 'flex-start' },
  viewTab: { flex: 1, paddingTop: 8, alignItems: 'center' },
  viewText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  viewTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 8, height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.money },
});
