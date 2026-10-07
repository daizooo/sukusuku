import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
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
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import {
  archiveMoneyWallet,
  deleteMoneyRecord,
  insertMoneyWallet,
  loadMoney,
  saveMoneyRecord,
  updateMoneyWallet,
} from '@/lib/api/money';
import { loadHouseholdProducts } from '@/lib/api/householdProducts';
import { loadSpecialExpenses } from '@/lib/api/specialExpenses';
import { fiscalYearOfMonth, monthKeyOf, monthKeyOfDate, specialActualsFromRecords } from '@/lib/moneyUtils';
import MoneyRecordsView from '@/components/money/MoneyRecordsView';
import MoneyMonthView from '@/components/money/MoneyMonthView';
import RecordEditor from '@/components/money/RecordEditor';
import CategoryEditor from '@/components/money/CategoryEditor';
import SpecialPanel from '@/components/living/SpecialPanel';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * Web版の `src/components/sukusuku/tabs/MoneyTab.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「記録 / 月 / 年」の3つ。見出しの右は淡い色の丸いボタン「＋」（記録を追加）だけ（§2）。
 * - 記録: その月の記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 月: 月の収支と、生活費の大分類のタイル（予算を超えた順）。種類と予算はここから直す
 * - 年: 特別費の年度の予定と実績（暮らしタブから移した。年の振り返りは §7 の5 で作り直す）
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

type View3 = 'records' | 'month' | 'year';

const VIEWS: { id: View3; label: string }[] = [
  { id: 'records', label: '記録' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
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
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View3>('records');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCategories, setEditingCategories] = useState(false);

  const reload = useCallback(async (id: string) => {
    const [money, loadedProducts, special] = await Promise.all([
      loadMoney(supabase, id),
      loadHouseholdProducts(supabase, id),
      loadSpecialExpenses(supabase, id),
    ]);
    setCategories(money.categories);
    setBudgets(money.budgets);
    setWallets(money.wallets);
    setRecords(money.records);
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
          accessibilityLabel="記録を追加"
          onPress={() => setEditing('new')}
          disabled={!familyId}
          style={styles.addButton}
        >
          <Plus size={22} color={colors.moneyText} />
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
      ) : view === 'month' ? (
        <MoneyMonthView
          monthKey={monthKey}
          onMonth={setMonthKey}
          records={records}
          categories={categories}
          budgets={budgets}
          wallets={wallets}
          specialItems={specialItems}
          specialActuals={specialActuals}
          onEditCategories={() => setEditingCategories(true)}
        />
      ) : (
        <View style={styles.year}>
          <SpecialPanel familyId={familyId} onRecordsChanged={() => familyId && void reload(familyId).catch(() => {})} />
        </View>
      )}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.moneySoft,
  },
  views: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  viewTab: { paddingTop: 6, alignItems: 'center' },
  viewText: { fontSize: 15, fontWeight: '600', color: colors.textMuted, paddingHorizontal: 2 },
  viewTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 6, height: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.moneyRing },
  year: { flex: 1, paddingTop: 10 },
});
