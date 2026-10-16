import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  formatBalance,
  formatYen,
  iconKeyOf,
  type CategoryAnalysis,
} from '@/lib/moneyUtils';
import RecordDayList from '@/components/money/RecordDayList';
import { CategoryIcon, Hero, ProgressBar, ScreenHeader, SectionHeader, StatRow, type } from '@/components/money/moneyVisual';

// 振り返りの内訳をタップしたときの画面（docs/kakei.md §4.4）。PWA版の `src/components/sukusuku/money/ReviewDetailScreen.tsx` と同じ並び・文言。
// 上に**振り返りの画面と同じ作りの収支**（予算 − 支出を大きく、予算と支出を下に）、次に小分類ごとの割合、下にその行に絞った記録の一覧
// （2026-10-16。「分析」の欄は無くした）。
// 年のときは、小分類のあとに**締めた月ごとの実績**（月の予算と並べる）を出す。月の行を押すと、その月のカテゴリの詳細が開く。
// 記録を押すと、この画面を閉じて記録の詳細を開く。

export type ReviewDetail = { type: 'category'; category: MoneyCategory };

interface ReviewDetailScreenProps {
  detail: ReviewDetail;
  /** 「9月」「2026年」。 */
  periodLabel: string;
  /** 大分類の分析（期間の予算・実績・小分類ごと・記録）。 */
  analysis: CategoryAnalysis | null;
  /** 年のとき、締めた月ごとの実績と月の予算（新しい月から）。月のときは null。 */
  closedMonths: { monthKey: string; amount: number; budget: number | null }[] | null;
  /** 締めた月の行を押したとき、その月のカテゴリの詳細を開く。 */
  onOpenMonth: (monthKey: string) => void;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onClose: () => void;
  onOpenRecord: (record: MoneyRecord) => void;
}

const percentOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export default function ReviewDetailScreen({
  detail,
  periodLabel,
  analysis,
  closedMonths,
  onOpenMonth,
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
          {analysis !== null && <SummaryHero analysis={analysis} periodLabel={periodLabel} />}
          {analysis !== null && <ChildrenSection analysis={analysis} />}
          {closedMonths !== null && <ClosedMonths rows={closedMonths} onOpenMonth={onOpenMonth} />}

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

/** 小分類ごとの割合（多い順の帯）。 */
function ChildrenSection({ analysis }: { analysis: CategoryAnalysis }) {
  const childTotal = analysis.children.reduce((sum, child) => sum + child.amount, 0);
  if (analysis.children.length === 0) return null;
  return (
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
  );
}

/** 上の収支。振り返りの画面と同じ作りで、収支＝予算 − 支出（予算が無ければ支出だけ）。 */
function SummaryHero({ analysis, periodLabel }: { analysis: CategoryAnalysis; periodLabel: string }) {
  const hasBudget = analysis.budget !== null;
  const over = hasBudget && analysis.diff < 0;
  return (
    <Hero
      compact
      label={`収支（${periodLabel}。予算 − 支出）`}
      value={formatBalance(analysis.diff)}
      plus={hasBudget && analysis.diff > 0}
      note={hasBudget ? undefined : '予算なし'}
    >
      <StatRow compact label="予算" value={hasBudget ? formatYen(analysis.budget ?? 0) : '−'} />
      <StatRow compact label="支出" value={`−${formatYen(analysis.actual)}`} />
      {hasBudget && (
        <View style={styles.progress}>
          <ProgressBar ratio={(analysis.budget ?? 0) > 0 ? analysis.actual / (analysis.budget ?? 1) : 0} over={over} />
        </View>
      )}
    </Hero>
  );
}

/** 年のとき、締めた月ごとの実績。押すとその月のカテゴリの詳細。 */
function ClosedMonths({
  rows,
  onOpenMonth,
}: {
  rows: { monthKey: string; amount: number; budget: number | null }[];
  onOpenMonth: (monthKey: string) => void;
}) {
  return (
    <>
      <SectionHeader title="締めた月ごと" hint="押すとその月の内訳" />
      {rows.length === 0 ? (
        <Text style={styles.message}>締めた月はまだありません</Text>
      ) : (
        <View style={styles.card}>
          {rows.map((row, index) => {
            const over = row.budget !== null && row.amount > row.budget;
            return (
              <Pressable
                key={row.monthKey}
                accessibilityRole="button"
                accessibilityLabel={`${Number(row.monthKey.slice(5, 7))}月の内訳を見る`}
                onPress={() => onOpenMonth(row.monthKey)}
                style={({ pressed }) => [styles.childRow, index > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View style={styles.childTop}>
                  <Text style={[type.row, styles.flex]}>{Number(row.monthKey.slice(5, 7))}月</Text>
                  <Text style={type.faint}>{row.budget !== null ? `予算 ${formatYen(row.budget)}` : '予算なし'}</Text>
                  <Text style={type.amount}>{formatYen(row.amount)}</Text>
                  <ChevronRight size={16} color={colors.textFaint} />
                </View>
                <ProgressBar ratio={row.budget ? row.amount / row.budget : 0} over={over} />
              </Pressable>
            );
          })}
        </View>
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
  pressed: { backgroundColor: colors.background },
});
