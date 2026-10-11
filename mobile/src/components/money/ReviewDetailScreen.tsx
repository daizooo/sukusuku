import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  formatSignedYen,
  formatYen,
  iconKeyOf,
  type CategoryAnalysis,
} from '@/lib/moneyUtils';
import RecordDayList from '@/components/money/RecordDayList';
import { CategoryIcon, Hero, ProgressBar, ScreenHeader, SectionHeader, StatRow, type } from '@/components/money/moneyVisual';

// 振り返りの内訳をタップしたときの画面（docs/kakei.md §4.4）。PWA版の `src/components/sukusuku/money/ReviewDetailScreen.tsx` と同じ並び・文言。
// 上に結論（実績と予算）、簡単な分析（前の期間との比べ・小分類ごとの割合・月ごと）、下にその行に絞った記録の一覧。
// 記録を押すと、この画面を閉じて記録の詳細を開く。

export type ReviewDetail = { type: 'category'; category: MoneyCategory };

interface ReviewDetailScreenProps {
  detail: ReviewDetail;
  /** 「9月」「2026年」。 */
  periodLabel: string;
  isMonth: boolean;
  /** 大分類の分析。 */
  analysis: CategoryAnalysis | null;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onClose: () => void;
  onOpenRecord: (record: MoneyRecord) => void;
}

const percentOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export default function ReviewDetailScreen({
  detail,
  periodLabel,
  isMonth,
  analysis,
  categories,
  wallets,
  onClose,
  onOpenRecord,
}: ReviewDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const title = detail.category.name;
  const records = analysis?.records ?? [];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader
          title={`${title}（${periodLabel}）`}
          icon="back"
          onClose={onClose}
          right={<CategoryIcon iconKey={iconKeyOf(detail.category)} size={28} />}
        />
        <ScrollView contentContainerStyle={styles.content}>
          {analysis !== null && <CategoryBody analysis={analysis} isMonth={isMonth} periodLabel={periodLabel} />}

          <SectionHeader title="記録" hint={`${records.length}件`} />
          {records.length === 0 ? (
            <Text style={styles.message}>この期間の記録はありません</Text>
          ) : (
            <RecordDayList
              records={records}
              categories={categories}
              wallets={wallets}
              onOpen={onOpenRecord}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function CategoryBody({
  analysis,
  isMonth,
  periodLabel,
}: {
  analysis: CategoryAnalysis;
  isMonth: boolean;
  periodLabel: string;
}) {
  const over = analysis.budget !== null && analysis.diff < 0;
  const change = analysis.previous === null ? null : analysis.actual - analysis.previous;
  const count = analysis.records.length;
  const peak = analysis.months.reduce<{ monthKey: string; amount: number } | null>(
    (best, entry) => (entry.amount > 0 && (best === null || entry.amount > best.amount) ? entry : best),
    null,
  );
  const activeMonths = analysis.months.filter((entry) => entry.amount > 0).length;
  const childTotal = analysis.children.reduce((sum, child) => sum + child.amount, 0);
  const label = isMonth ? '先月' : '前年の同じ月';

  return (
    <>
      <Hero
        label={`${periodLabel}に使った額`}
        value={formatYen(analysis.actual)}
        minus={over}
        note={
          analysis.budget === null
            ? '予算なし'
            : over
              ? `予算 ${formatYen(analysis.budget)}・${formatYen(analysis.diff)} 超過`
              : `予算 ${formatYen(analysis.budget)}・残り ${formatYen(analysis.diff)}`
        }
      >
        {analysis.budget !== null && (
          <View style={styles.progress}>
            <ProgressBar ratio={analysis.budget > 0 ? analysis.actual / analysis.budget : 0} over={over} />
          </View>
        )}
      </Hero>

      <SectionHeader title="分析" />
      <View style={styles.card}>
        <View style={styles.cardPad}>
          {change !== null && (
            <StatRow
              label={`${label}より`}
              note={`${label} ${formatYen(analysis.previous ?? 0)}`}
              value={formatSignedYen(change)}
              minus={change > 0}
            />
          )}
          <StatRow
            label="記録"
            note={count > 0 ? `1件あたり ${formatYen(Math.round(analysis.actual / count))}` : undefined}
            value={`${count}件`}
          />
          {!isMonth && activeMonths > 0 && (
            <StatRow label="月の平均" note={`記録のある${activeMonths}か月`} value={formatYen(Math.round(analysis.actual / activeMonths))} />
          )}
          {!isMonth && peak !== null && (
            <StatRow label="いちばん多い月" value={`${Number(peak.monthKey.slice(5, 7))}月 ${formatYen(peak.amount)}`} />
          )}
        </View>
      </View>

      {analysis.children.length > 0 && (
        <>
          <SectionHeader title="小分類ごと" />
          <View style={styles.card}>
            {analysis.children.map((child, index) => (
              <View key={child.id} style={[styles.childRow, index > 0 && styles.divided]}>
                <View style={styles.childTop}>
                  <Text style={[type.row, styles.flex]} numberOfLines={1}>
                    {child.name}
                  </Text>
                  <Text style={type.faint}>{percentOf(child.amount, childTotal)}%</Text>
                  <Text style={type.amount}>{formatYen(child.amount)}</Text>
                </View>
                <ProgressBar ratio={childTotal > 0 ? child.amount / childTotal : 0} />
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  progress: { gap: 6, paddingTop: 8 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardPad: { paddingHorizontal: 14, paddingVertical: 4 },
  childRow: { gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  childTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
});
