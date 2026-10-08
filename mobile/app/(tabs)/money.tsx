import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Settings } from 'lucide-react-native';
import type {
  HouseholdProduct,
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecurring,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import {
  archiveMoneyWallet,
  deleteMoneyRecord,
  deleteMoneyWalletBalance,
  insertMoneyWallet,
  loadMoney,
  loadMoneyStores,
  restoreMoneyWallet,
  saveMoneyRecord,
  saveMoneyWalletBalance,
  updateMoneyWallet,
} from '@/lib/api/money';
import { loadHouseholdProducts } from '@/lib/api/householdProducts';
import { loadSpecialExpenses } from '@/lib/api/specialExpenses';
import { fiscalYearOfMonth, monthKeyOf, monthKeyOfDate, specialActualsFromRecords } from '@/lib/moneyUtils';
import MoneyAccountsView from '@/components/money/MoneyAccountsView';
import MoneyRecordsView from '@/components/money/MoneyRecordsView';
import MoneyReviewView from '@/components/money/MoneyReviewView';
import RecordEditor from '@/components/money/RecordEditor';
import CategoryEditor from '@/components/money/CategoryEditor';
import MoneySettings from '@/components/money/MoneySettings';
import { type ReviewPeriod } from '@/components/money/moneyVisual';
import SpecialPanel from '@/components/living/SpecialPanel';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * Web版の `src/components/sukusuku/tabs/MoneyTab.tsx` と同じ項目・並び・文言にしてある。
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
 */

type View3 = 'records' | 'review' | 'special' | 'accounts';

const VIEWS: { id: View3; label: string }[] = [
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
  { id: 'special', label: '特別費' },
  { id: 'accounts', label: '口座' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

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
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View3>('records');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOfMonth(monthKeyOfDate(new Date())));
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const reload = useCallback(async (id: string) => {
    const [money, loadedProducts, special] = await Promise.all([
      loadMoney(supabase, id),
      loadHouseholdProducts(supabase, id),
      loadSpecialExpenses(supabase, id),
    ]);
    setCategories(money.categories);
    setBudgets(money.budgets);
    setWallets(money.wallets);
    setStores(money.stores);
    setRecords(money.records);
    setRecurring(money.recurring);
    setBalances(money.balances);
    setProducts(loadedProducts);
    setSpecialItems(special.items);
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
  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const saveRecord = async (draft: MoneyRecordDraft) => {
    setEditing(null);
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 日用品の台帳の「いつもの値段」が変わるので読み直す（DBの save_money_record が直す）。
      if (familyId && saved.items.some((item) => item.productId !== null)) {
        setProducts(await loadHouseholdProducts(supabase, familyId));
      }
      // 新しいお店の名前は、DBの save_money_record がお店の設定に登録する。
      if (familyId && saved.store !== '' && !stores.some((entry) => entry.name === saved.store)) {
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

  /** 残高を確定する。同じ出金元・同じ日の確定は上書きされる。 */
  const confirmBalance = async (walletId: string, balanceOn: string, amount: number) => {
    if (!familyId) return;
    try {
      const saved = await saveMoneyWalletBalance(supabase, familyId, walletId, balanceOn, amount);
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
      <View style={styles.header}>
        <Text style={styles.title}>家計</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="家計の設定"
          onPress={() => setSettingsOpen(true)}
          disabled={!familyId}
          hitSlop={10}
          style={styles.settings}
        >
          <Settings size={22} color={colors.textSubtle} />
        </Pressable>
      </View>
      <View accessibilityRole="tablist" style={styles.views}>
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
          onRecordsChanged={() => {
            if (familyId) void reload(familyId).catch(() => {});
          }}
        />
      ) : (
        <MoneyAccountsView
          wallets={wallets}
          records={records}
          balances={balances}
          categories={categories}
          specialItems={specialItems}
          isLoading={isLoading}
          onOpenRecord={setEditing}
          onConfirm={(walletId, balanceOn, amount) => void confirmBalance(walletId, balanceOn, amount)}
          onDeleteBalance={(balance) => void removeBalance(balance)}
          onSaveWallet={saveWallet}
          onArchiveWallet={(wallet) => void archiveWallet(wallet)}
          onRestoreWallet={(wallet) => void restoreWallet(wallet)}
        />
      )}

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

      {settingsOpen && familyId && (
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

      {editingCategories && familyId && (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  settings: { marginLeft: 'auto', padding: 2 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
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
  // 4つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。
  views: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  viewTab: { flex: 1, paddingTop: 8, alignItems: 'center' },
  viewText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  viewTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 8, height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.money },
});
