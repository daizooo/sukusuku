import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarClock, ChevronRight, Mail, PiggyBank, Store, Tag } from 'lucide-react-native';
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
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import CategoryEditor from '@/components/money/CategoryEditor';
import BudgetEditor from '@/components/money/BudgetEditor';
import RecurringSettings from '@/components/money/RecurringSettings';
import StoreSettings from '@/components/money/StoreSettings';
import MoneyFeedSettings from '@/components/money/MoneyFeedSettings';
import { ScreenHeader } from '@/components/money/moneyVisual';

// 家計の設定（docs/kakei.md §3.5）。PWA版の `src/components/sukusuku/money/MoneySettings.tsx` と同じ並び・文言。
//
// カテゴリ・予算（年ごと。2026-10-15にカテゴリと分けた）・固定費（支出・収入〔給与・賞与〕・振替）・よく行くお店を、いつでも編集・追加できる入口（出金元は「口座」の面で足す・直す。2026-10-08）。ここで直すのは設定データだけで、記録は変わらない
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
  const insets = useSafeAreaInsets();
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
  // 設定の面の中で、さらに奥の画面を開いているときの戻り方（毎月の記録の編集など）。
  const innerBack = useRef<(() => void) | null>(null);

  const rows: { id: Exclude<Page, 'menu'>; label: string; icon: typeof Tag }[] = [
    { id: 'categories', label: 'カテゴリ', icon: Tag },
    { id: 'budget', label: '予算', icon: PiggyBank },
    { id: 'recurring', label: '固定費（支出、収入、振替）', icon: CalendarClock },
    { id: 'stores', label: 'よく行くお店', icon: Store },
    { id: 'feed', label: 'Gmail 取り込み', icon: Mail },
  ];

  const back = () => {
    setRecurringTarget(null);
    setPage('menu');
  };
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
                    <Text style={[styles.label, styles.flex]}>{row.label}</Text>
                    <ChevronRight size={18} color={colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
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
            backRef={innerBack}
          />
        )}
      </View>
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
          reserves={reserves}
          onReserves={onReserves}
          onOpenRecurring={openRecurring}
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
});
