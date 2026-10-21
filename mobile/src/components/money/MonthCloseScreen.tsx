import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  pendingRecurringInMonth,
  recordsInMonth,
  recordTotal,
  walletDelta,
} from '@/lib/moneyUtils';
import RecordDayList, { type RecordClosing } from '@/components/money/RecordDayList';
import SelectField from '@/components/ui/SelectField';
import { EstimateBadge, Hero, PrimaryButton, ScreenHeader, SectionHeader, StatRow, type } from '@/components/money/moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。PWA版の `src/components/sukusuku/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 月の締めは、1か月を振り返って、変な支出や収入が無いかを調べ、家族の財布の残高とカードの利用残高を合わせるもの。
// 上に収支を大きく（見込みの額も含む）、その下に**その月の記録を、記録の画面と同じ一覧**で並べる（2026-10-16。チェックボックスは付けない）。
// 「見込み」は、固定収入・固定費の見込みの額で自動で作ったまま、まだ確定していない記録だけ（財布・デビット・Gmail から取り込んだカードの記録に見込みは無い）。
// 見込みの記録には「見込み」の印と「確定」（今の額のまま確定）を付ける。額が違うものは、押して記録の詳細で直す。
// カードの利用通知と額が違う記録には、その旨を添える（通知が来ていない記録は、継続払いなど通知されないものもあるので出さない）。
// 記録の一覧は、**口座（出金元）ごとに絞り込める**（財布・カードごとに見て、実際の明細と合わせるため。2026-10-16）。
// 絞ると、その口座のその月の合計（入金・出金・差し引き。振替も入れる）を一覧の上に添える（2026-10-21。月末の残高は出さない）。
// 一覧のあとに、これから自動で作られる記録・未確認の明細を出す。
// 片づいていないものが残っていても「この月を締める」で締められる。年初からの累計は出さない（その月の締めなので）。
// その月に、固定収入・固定費でこれから自動で作られる記録がある（自動の記録より前に締める）ときは、一覧で知らせ、
// 締めるときにも確かめる（締めたあとに作られた記録は、締めた収支に入っていないため）。

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  /** 固定収入・固定費のルール（これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 今日（YYYY-MM-DD）。 */
  today: string;
  /** その月の日付の、未確認の明細の件数。 */
  feedCount: number;
  /** カードの記録を利用通知と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §9.6.5 の C）。 */
  cardChecks: CardMonthChecks | null;
  wallets: MoneyWallet[];
  /** 確定した残高（今は使わない。月末の残高は出さない。2026-10-21）。 */
  balances: MoneyWalletBalance[];
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  /** 見込みの記録を今の額で確定する。 */
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 固定のルールの見出し。品名、無ければお店、無ければカテゴリ。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || (rule.kind === 'income' ? '収入' : '支出');
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  budgets,
  recurring,
  today,
  feedCount,
  cardChecks,
  wallets,
  closed,
  closedAt,
  onConfirmEstimate,
  onOpenRecord,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const insets = useSafeAreaInsets();
  const month = useMemo(() => buildMonthSummary(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const inMonth = useMemo(() => recordsInMonth(records, monthKey), [records, monthKey]);
  const estimates = useMemo(() => estimatesInMonth(records, monthKey), [records, monthKey]);
  const estimateAmount = estimates.reduce((sum, record) => sum + recordTotal(record), 0);
  const pending = useMemo(
    () => pendingRecurringInMonth(recurring, records, monthKey, today),
    [recurring, records, monthKey, today],
  );
  // 一覧の絞り込み。'all' はすべて、それ以外は出金元の id。
  const [filter, setFilter] = useState<string>('all');
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  // 利用通知と額が違う記録（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const { record, feedAmount } of cardChecks?.mismatched ?? []) {
      map.set(record.id, `カードの利用通知は ${formatYen(feedAmount)}。額が違います`);
    }
    return map;
  }, [cardChecks]);

  // 絞り込みに使う出金元（その月に使われているもの）と、絞り込んだ記録。
  const usedWallets = useMemo(() => {
    const ids = new Set<string>();
    for (const record of inMonth) {
      if (record.walletId) ids.add(record.walletId);
      if (record.toWalletId) ids.add(record.toWalletId);
    }
    return wallets.filter((wallet) => ids.has(wallet.id));
  }, [inMonth, wallets]);
  const shown = useMemo(
    () => (filter === 'all' ? inMonth : inMonth.filter((record) => record.walletId === filter || record.toWalletId === filter)),
    [inMonth, filter],
  );
  const filterWallet = wallets.find((wallet) => wallet.id === filter) ?? null;
  // 絞り込んだ口座の、その月の合計（入金・出金は件数も。振替も入れる）。
  const filterTotal = useMemo(() => {
    if (filter === 'all') return null;
    const total = { inAmount: 0, inCount: 0, outAmount: 0, outCount: 0 };
    for (const record of shown) {
      const delta = walletDelta(record, filter);
      if (delta > 0) {
        total.inAmount += delta;
        total.inCount += 1;
      } else if (delta < 0) {
        total.outAmount -= delta;
        total.outCount += 1;
      }
    }
    return total;
  }, [shown, filter]);

  const confirm = async (record: MoneyRecord) => {
    setConfirming(record.id);
    try {
      await onConfirmEstimate(record);
    } finally {
      setConfirming(null);
    }
  };

  const closing: RecordClosing = {
    locked: closed,
    onConfirm: (record) => void confirm(record),
    busyId: confirming,
    notes,
  };

  // これから自動で作られる記録があれば、締める前に確かめる。
  const closeMonth = () => {
    if (pending.length === 0) {
      onCloseMonth();
      return;
    }
    Alert.alert(
      `まだ自動で記録されていないものが${pending.length}件あります`,
      '締めたあとに作られた記録は、締めた収支に入っていません。記録されてから締め直すこともできます。このまま締めますか？',
      [
        { text: 'やめる', style: 'cancel' },
        { text: '締める', onPress: onCloseMonth },
      ],
    );
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          <Hero compact label={`収支（${label}）`} value={formatBalance(month.balance)} plus={month.balance > 0}>
            <StatRow compact label="収入" value={formatYen(month.income)} plus={month.income > 0} />
            <StatRow compact label="支出" value={formatBalance(-month.living)} />
            {estimates.length > 0 && (
              <View style={styles.estimate}>
                <EstimateBadge />
                <Text style={[type.faint, styles.flex]}>
                  見込み {estimates.length}件（{formatYen(estimateAmount)}）
                </Text>
              </View>
            )}
          </Hero>

          <SectionHeader
            compact
            title="記録"
            hint={`${shown.length}件`}
            right={
              usedWallets.length > 1 ? (
                <SelectField
                  accessibilityLabel="口座"
                  options={[{ value: 'all', label: 'すべての口座' }, ...usedWallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))]}
                  value={filter}
                  onChange={setFilter}
                  style={styles.filterField}
                  textStyle={styles.filterText}
                />
              ) : undefined
            }
          />
          {filterWallet !== null && filterTotal !== null && shown.length > 0 && (
            <View style={styles.totalCard}>
              <Text style={styles.totalTitle} numberOfLines={1}>
                {filterWallet.name} の{label}の合計
              </Text>
              {filterTotal.inCount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.flex]}>入金 {filterTotal.inCount}件</Text>
                  <Text style={[styles.amount, styles.plus]}>{formatYen(filterTotal.inAmount)}</Text>
                </View>
              )}
              {filterTotal.outCount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.flex]}>出金 {filterTotal.outCount}件</Text>
                  <Text style={styles.amount}>{formatYen(filterTotal.outAmount)}</Text>
                </View>
              )}
              <View style={[styles.totalRow, styles.divided, styles.totalSum]}>
                <Text style={[styles.totalLabel, styles.flex]}>{filterTotal.inCount > 0 && filterTotal.outCount > 0 ? '差し引き' : '合計'}</Text>
                <Text style={[styles.totalAmount, filterTotal.inAmount > filterTotal.outAmount && styles.plus]}>
                  {formatBalance(filterTotal.inAmount - filterTotal.outAmount)}
                </Text>
              </View>
            </View>
          )}
          {shown.length === 0 ? (
            <Text style={styles.message}>{inMonth.length === 0 ? 'この月の記録はありません' : 'この口座の記録はありません'}</Text>
          ) : (
            <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} />
          )}

          {pending.length > 0 && (
            <>
              <SectionHeader compact title="これから自動で記録されるもの" hint={`${pending.length}件`} />
              <View style={[styles.card, styles.pendingCard]}>
                {pending.map((entry, index) => (
                  <View key={entry.rule.id} style={[styles.row, index > 0 && styles.divided]}>
                    <Text style={styles.date}>{formatShortDate(entry.date)}</Text>
                    <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                      {ruleTitle(entry.rule, categories)}
                    </Text>
                    <Text style={[styles.amount, entry.rule.kind === 'income' && styles.plus]}>{formatYen(entry.amount)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {feedCount > 0 && (
            <Pressable accessibilityRole="button" onPress={onOpenFeed} style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
              <Text style={[styles.noticeText, styles.flex]}>未確認の明細 {feedCount}件</Text>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </ScrollView>
        <View style={styles.footer}>
          {closed ? (
            <>
              <Text style={styles.closedNote}>{closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}</Text>
              <Pressable accessibilityRole="button" onPress={onReopenMonth} style={styles.secondary}>
                <Text style={styles.reopenText}>締めを外す</Text>
              </Pressable>
            </>
          ) : (
            <>
              <PrimaryButton label="この月を締める" onPress={closeMonth} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 4 },
  estimate: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  filterField: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.neutralSurface },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  totalCard: {
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  totalTitle: { fontSize: 14, fontWeight: '700', color: colors.text, paddingBottom: 2 },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  totalSum: { marginTop: 4, paddingTop: 7 },
  totalLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  totalAmount: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  date: { width: 44, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
  pendingCard: { borderColor: colors.moneyEstimateSurface, backgroundColor: colors.surface },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.moneyEstimateSurface,
  },
  noticeText: { fontSize: 13, fontWeight: '600', color: colors.moneyEstimate },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  closedNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  reopenText: { fontSize: 13, fontWeight: '700', color: colors.danger },
});
