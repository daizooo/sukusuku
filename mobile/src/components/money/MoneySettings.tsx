import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banknote, CalendarClock, ChevronRight, Store, Tag } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecurring,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { budgetFor, budgetMonthKey, dateKeyOfDate, formatYear, formatYen, topCategories } from '@/lib/moneyUtils';
import CategoryEditor from '@/components/money/CategoryEditor';
import RecurringSettings from '@/components/money/RecurringSettings';
import StoreSettings from '@/components/money/StoreSettings';
import { ScreenHeader } from '@/components/money/moneyVisual';

// 家計の設定（docs/kakei.md §3.5）。PWA版の `src/components/sukusuku/money/MoneySettings.tsx` と同じ並び・文言。
//
// カテゴリ・予算・固定支出・固定収入（給与・賞与）・よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
// （お店の名前を直しても、過去の記録のお店の名前はそのまま）。
// 戻る操作（スマホの戻るボタン）は、開いている設定の面から入口へ、入口から家計タブへ。

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
  onClose: () => void;
}

type Page = 'menu' | 'categories' | 'stores' | 'recurring' | 'income';

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
  onClose,
}: MoneySettingsProps) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('menu');
  // 設定の面の中で、さらに奥の画面を開いているときの戻り方（毎月の記録の編集など）。
  const innerBack = useRef<(() => void) | null>(null);

  const tops = topCategories(categories, 'living', true).filter((top) => !top.archived);
  const totalBudget = tops.reduce((sum, top) => sum + (budgetFor(budgets, top.id, budgetMonthKey(year, dateKeyOfDate(new Date()))) ?? 0), 0);
  const storeCount = stores.filter((store) => !store.archived).length;
  const recurringCount = recurring.filter((rule) => !rule.archived && rule.kind !== 'income').length;
  const incomeCount = recurring.filter((rule) => !rule.archived && rule.kind === 'income').length;

  const rows: { id: Exclude<Page, 'menu'>; label: string; summary: string; icon: typeof Tag }[] = [
    {
      id: 'categories',
      label: 'カテゴリ・予算',
      summary: `支出の大分類 ${tops.length}個・月の予算 ${formatYen(totalBudget)}（${formatYear(year)}）`,
      icon: Tag,
    },
    { id: 'recurring', label: '固定支出', summary: `${recurringCount}件（自動で記録）`, icon: CalendarClock },
    { id: 'income', label: '固定収入', summary: `給与・賞与 ${incomeCount}件（自動で記録）`, icon: Banknote },
    { id: 'stores', label: 'よく行くお店', summary: `登録したお店 ${storeCount}件`, icon: Store },
  ];

  const back = () => setPage('menu');
  const onRequestClose = () => {
    if (page === 'menu') return onClose();
    if (innerBack.current) return innerBack.current();
    back();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onRequestClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        {page === 'menu' && (
          <>
            <ScreenHeader title="家計の設定" onClose={onClose} />
            <View style={styles.content}>
              <Text style={styles.note}>
                カテゴリ・予算・固定支出・固定収入・よく行くお店を、いつでも編集・追加できます。直すのは設定だけで、記録は変わりません。
              </Text>
              {rows.map((row) => {
                const Icon = row.icon;
                return (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    onPress={() => setPage(row.id)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <View style={styles.iconBox}>
                      <Icon size={20} color={colors.moneyText} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.label}>{row.label}</Text>
                      <Text style={styles.summary}>{row.summary}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
        {page === 'stores' && <StoreSettings familyId={familyId} stores={stores} onStores={onStores} onBack={back} />}
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
            backRef={innerBack}
          />
        )}
      </View>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
  note: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.neutralSurface },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.moneySoft,
  },
  label: { fontSize: 16, fontWeight: '700', color: colors.text },
  summary: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
});
