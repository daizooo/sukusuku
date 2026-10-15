import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  addDays,
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  pendingRecurringInMonth,
  recordsInMonth,
  shiftMonth,
  walletBalanceOn,
} from '@/lib/moneyUtils';
import RecordDayList, { type RecordClosing } from '@/components/money/RecordDayList';
import { PrimaryButton, ProgressBar, ScreenHeader, SectionHeader, type } from '@/components/money/moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。PWA版の `src/components/sukusuku/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 月の締めは、1か月を振り返って、変な支出や収入が無いかを調べ、家族の財布の残高とカードの利用残高を合わせるもの。
// その月の記録を、記録の画面と同じ一覧で出し（カードも財布も口座の振替も）、**各記録にチェックボックス**を付ける（2026-10-15）。
// すべてチェックがついたら「この月を締める」が押せる。
// - 見込みの記録（自動で作ったまま、額を確かめていないもの）は黄色の「見込み」で、チェックボックスの代わりに「確定」を出す。
//   今の額で確定すると、確定してチェックも付く。額が違うものは、押して記録の詳細で直す（直した記録はチェックが外れる）
// - カードの利用通知を取り込んでいるカードの記録は、通知と額が違うもの・通知が来ていないものに注意を添える（docs/kakei.md §4.7）
// - 絞り込み: すべて / 未チェック / 見込み / 出金元ごと（財布・カードごとに合わせるため）。「表示中をまとめてチェック」もできる
// - 月末の残高: 出金元ごとの月末の残高を見られる（実際の残高と見比べ、違えば口座の面で補正する）
// - 年初からの累計は出さない（その月の締めなので）。これから自動で作られる記録・未確認の明細は、一覧の上下に知らせる
// 締めた月は、チェックを変えられない（「締めを外す」で外してから）。

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
  /** カードの記録を明細と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §9.6.5 の C）。 */
  cardChecks: CardMonthChecks | null;
  wallets: MoneyWallet[];
  /** 確定した残高（月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  /** 見込みの記録を今の額で確定し、チェックも付ける。 */
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  /** チェックを付ける・外す。 */
  onSetChecked: (records: MoneyRecord[], checked: boolean) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 絞り込み。'all' すべて・'unchecked' 未チェック・'estimate' 見込み・それ以外は出金元の id。 */
type Filter = string;

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
  balances,
  closed,
  closedAt,
  onConfirmEstimate,
  onSetChecked,
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
  const pending = useMemo(
    () => pendingRecurringInMonth(recurring, records, monthKey, today),
    [recurring, records, monthKey, today],
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [showBalances, setShowBalances] = useState(false);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  // 見込み以外で、チェックがついている数。見込みは確定するまで「未チェック」。
  const isDone = (record: MoneyRecord) => !record.isEstimate && record.checkedAt !== null;
  const doneCount = inMonth.filter(isDone).length;
  const remaining = inMonth.length - doneCount;

  // 利用通知と見比べた結果（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    if (cardChecks) {
      for (const { record, feedAmount } of cardChecks.mismatched) {
        map.set(record.id, `カードの利用通知は ${formatYen(feedAmount)}。額が違います`);
      }
      for (const record of cardChecks.unnotified) map.set(record.id, 'カードの利用通知が来ていません（明細で確かめる）');
    }
    return map;
  }, [cardChecks]);

  // 絞り込みに使う出金元（その月に使われているもの）。
  const usedWallets = useMemo(() => {
    const ids = new Set<string>();
    for (const record of inMonth) {
      if (record.walletId) ids.add(record.walletId);
      if (record.toWalletId) ids.add(record.toWalletId);
    }
    return wallets.filter((wallet) => ids.has(wallet.id));
  }, [inMonth, wallets]);

  const shown = useMemo(() => {
    if (filter === 'all') return inMonth;
    if (filter === 'unchecked') return inMonth.filter((record) => !isDone(record));
    if (filter === 'estimate') return inMonth.filter((record) => record.isEstimate);
    return inMonth.filter((record) => record.walletId === filter || record.toWalletId === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMonth, filter]);
  const bulkTargets = shown.filter((record) => !record.isEstimate && record.checkedAt === null);

  // 月末（その月の最終日）の出金元ごとの残高。証券は記録から出せないので入れない。
  const lastDay = addDays(`${shiftMonth(monthKey, 1)}-01`, -1);
  const balanceRows = useMemo(
    () =>
      wallets
        .filter((wallet) => !wallet.archived && wallet.type !== 'securities')
        .map((wallet) => ({ wallet, amount: walletBalanceOn(wallet.id, lastDay, records, balances).amount }))
        .filter((row) => row.amount !== 0 || usedWallets.some((wallet) => wallet.id === row.wallet.id)),
    [wallets, records, balances, lastDay, usedWallets],
  );
  const filterWallet = wallets.find((wallet) => wallet.id === filter) ?? null;
  const filterBalance = filterWallet ? balanceRows.find((row) => row.wallet.id === filterWallet.id) : undefined;

  const confirm = async (record: MoneyRecord) => {
    setConfirming(record.id);
    try {
      await onConfirmEstimate(record);
    } finally {
      setConfirming(null);
    }
  };

  const closing: RecordClosing = {
    checked: (record) => record.checkedAt !== null,
    locked: closed,
    onToggle: (record) => void onSetChecked([record], record.checkedAt === null),
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

  const closeUnchecked = () =>
    Alert.alert(
      `チェックのないものが${remaining}件あります`,
      'チェックしないまま締めます。あとから締めを外して確かめることもできます。',
      [
        { text: 'やめる', style: 'cancel' },
        { text: 'このまま締める', onPress: closeMonth },
      ],
    );

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: `すべて ${inMonth.length}` },
    { id: 'unchecked', label: `未チェック ${remaining}` },
    ...(estimates.length > 0 ? [{ id: 'estimate', label: `見込み ${estimates.length}` }] : []),
    ...usedWallets.map((wallet) => ({ id: wallet.id, label: wallet.name })),
  ];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />

        {/* 固定: 収支・チェックの進み具合・絞り込み。スクロールするのは下の一覧だけ。 */}
        <View style={styles.top}>
          <View style={styles.summary}>
            <View style={styles.flex}>
              <Text style={type.sub}>収支（{label}。見込みを含む）</Text>
              <Text style={[styles.balance, month.balance > 0 && styles.plus, month.balance < 0 && type.minus]}>
                {formatBalance(month.balance)}
              </Text>
            </View>
            <View style={styles.summarySide}>
              <Text style={type.sub}>収入 {formatYen(month.income)}</Text>
              <Text style={type.sub}>支出 {formatYen(month.living)}</Text>
            </View>
          </View>
          <View style={styles.progressRow}>
            <View style={styles.flex}>
              <ProgressBar ratio={inMonth.length > 0 ? doneCount / inMonth.length : 0} />
            </View>
            <Text style={styles.progressText}>
              チェック {doneCount} / {inMonth.length}件
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} {...swipeBoundary}>
            {chips.map((chip) => (
              <Pressable
                key={chip.id}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === chip.id }}
                onPress={() => setFilter(chip.id)}
                style={[styles.chip, filter === chip.id && styles.chipSelected]}
              >
                <Text style={[styles.chipText, filter === chip.id && styles.chipTextSelected]}>{chip.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {feedCount > 0 && (
            <Pressable accessibilityRole="button" onPress={onOpenFeed} style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
              <Text style={[styles.noticeText, styles.flex]}>未確認の明細が{feedCount}件あります。先に片づけると確かです</Text>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          )}

          <Pressable accessibilityRole="button" onPress={() => setShowBalances((open) => !open)} style={styles.balanceToggle}>
            <Text style={[type.title, styles.flex]}>月末の残高</Text>
            <Text style={type.faint}>{showBalances ? '閉じる' : '実際の残高と見比べる'}</Text>
            {showBalances ? <ChevronUp size={16} color={colors.textFaint} /> : <ChevronDown size={16} color={colors.textFaint} />}
          </Pressable>
          {showBalances && (
            <View style={styles.card}>
              {balanceRows.map((row, index) => (
                <View key={row.wallet.id} style={[styles.balanceRow, index > 0 && styles.divided]}>
                  <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                    {row.wallet.name}
                  </Text>
                  <Text style={type.faint}>{row.wallet.type === 'card' ? '利用残高' : '残高'}</Text>
                  <Text style={styles.amount}>{formatBalance(row.amount)}</Text>
                </View>
              ))}
              <Text style={[type.faint, styles.balanceNote]}>
                {lastDay.slice(5).replace('-', '/')}の終わりの、記録から出した額です。違えば、口座の面で残高を補正します
              </Text>
            </View>
          )}
          {filterWallet !== null && filterBalance !== undefined && !showBalances && (
            <Text style={[type.faint, styles.filterBalance]}>
              {filterWallet.name} の月末の{filterWallet.type === 'card' ? '利用残高' : '残高'} {formatBalance(filterBalance.amount)}
            </Text>
          )}

          <SectionHeader
            compact
            title="記録"
            hint={`${shown.length}件`}
            right={
              !closed && bulkTargets.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => void onSetChecked(bulkTargets, true)} hitSlop={8}>
                  <Text style={type.link}>表示中をまとめてチェック（{bulkTargets.length}件）</Text>
                </Pressable>
              ) : undefined
            }
          />
          {shown.length === 0 ? (
            <Text style={styles.message}>
              {inMonth.length === 0 ? 'この月の記録はありません' : filter === 'unchecked' ? 'すべてチェックしました' : 'この絞り込みの記録はありません'}
            </Text>
          ) : (
            <RecordDayList
              records={shown}
              categories={categories}
              wallets={wallets}
              onOpen={onOpenRecord}
              closing={closing}
            />
          )}
          {estimates.length > 0 && (
            <Text style={type.faint}>
              黄色の「見込み」は、まだ額を確かめていない記録です。「確定」は今の額のまま確定します。額が違うものは、押して記録の詳細で直してください
            </Text>
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
              <Text style={type.faint}>
                固定収入・固定費で、この月のうちにまだ自動で記録されていないものです。上の収支には入っていません。記録されてから締めると確かです
              </Text>
            </>
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
              <PrimaryButton label="この月を締める" onPress={closeMonth} disabled={remaining > 0} />
              {remaining > 0 ? (
                <>
                  <Text style={styles.footerNote}>あと{remaining}件チェックすると締められます</Text>
                  <Pressable accessibilityRole="button" onPress={closeUnchecked} hitSlop={8} style={styles.secondary}>
                    <Text style={styles.skipText}>チェックしないで締める</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.footerNote}>すべてチェックしました</Text>
              )}
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
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  summary: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  summarySide: { alignItems: 'flex-end' },
  // 数字を出す Text は fontWeight を必ず付ける（CLAUDE.md）。
  balance: { fontSize: 26, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { fontSize: 12, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  chips: { gap: 6, paddingBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  chipTextSelected: { color: colors.moneyText, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 4 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.moneyEstimateSurface,
  },
  noticeText: { fontSize: 13, fontWeight: '600', color: colors.moneyEstimate },
  pressed: { backgroundColor: colors.background },
  balanceToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9 },
  balanceNote: { paddingHorizontal: 14, paddingBottom: 8 },
  filterBalance: { paddingBottom: 4 },
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
  date: { width: 44, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  pendingCard: { borderColor: colors.moneyEstimateSurface, backgroundColor: colors.surface },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 4, backgroundColor: colors.surface },
  footerNote: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  closedNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  secondary: { paddingVertical: 6, alignItems: 'center' },
  reopenText: { fontSize: 13, fontWeight: '700', color: colors.danger },
  skipText: { fontSize: 12, fontWeight: '600', color: colors.textFaint },
});
