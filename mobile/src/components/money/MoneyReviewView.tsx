import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  buildYearSummary,
  compareWithPreviousYear,
  estimatesInMonth,
  formatBalance,
  formatSignedYen,
  formatYear,
  formatYen,
  iconKeyOf,
  monthKeyOfDate,
  recordTotal,
  shiftMonth,
  yearMonthKeys,
  yearToDateBalance,
  type BudgetTile,
} from '@/lib/moneyUtils';
import ReviewDetailScreen, { type ReviewDetail } from '@/components/money/ReviewDetailScreen';
import YearFlowChart from '@/components/money/YearFlowChart';
import {
  CategoryIcon,
  EstimateBadge,
  Hero,
  PeriodBar,
  ProgressBar,
  SectionHeader,
  StatRow,
  type,
  type ReviewPeriod,
} from '@/components/money/moneyVisual';

// 家計タブの「振り返り」（docs/kakei.md §4）。PWA版の `src/components/sukusuku/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は収支＝収入 − 支出（生活費）。
// 貯金は記録なので式にも表示にも入れない。
// 月には年初からの累計、年には月平均・前年の同じ月ぶんとの比べ・月ごとの収支と累計のグラフを添える（§0.4）。
// 年と累計は、記録のある月だけを数える（記録は2026年10月から）。
// その下の「内訳」は、大分類の一覧（種類の並び順）。
// 内訳の行を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。

interface MoneyReviewViewProps {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  year: number;
  onYear: (year: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
}

export default function MoneyReviewView({
  period,
  onPeriod,
  monthKey,
  onMonth,
  year: yearProp,
  onYear,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
  onEditCategories,
  onOpenRecord,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const year = yearProp;
  const [detail, setDetail] = useState<ReviewDetail | null>(null);

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const yearSummary = useMemo(
    () => buildYearSummary(records, categories, budgets, year, today),
    [records, categories, budgets, year, today],
  );
  // 月: 年初からの累計。年: 前の年の同じ月ぶんとの比べ。
  const ytd = useMemo(
    () => (isMonth ? yearToDateBalance(records, categories, budgets, monthKey) : null),
    [isMonth, records, categories, budgets, monthKey],
  );
  const comparison = useMemo(
    () => (isMonth ? null : compareWithPreviousYear(records, categories, budgets, year, today)),
    [isMonth, records, categories, budgets, year, today],
  );
  // 見ている期間の月。月なら1つ、年なら記録のある月だけ（記録の無い月の予算は数えない）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearSummary.months.filter((row) => row.recorded).map((row) => row.monthKey)),
    [isMonth, monthKey, yearSummary],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : buildBudgetTiles(records, categories, budgets, periodKeys)),
    [periodKeys, records, categories, budgets],
  );

  const income = isMonth ? month.income : yearSummary.total.income;
  const living = isMonth ? month.living : yearSummary.total.living;
  const balance = isMonth ? month.balance : yearSummary.total.balance;
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);
  const months = yearSummary.months.filter((row) => row.monthKey <= today && row.recorded).reverse();

  // 内訳の行を押したときの分析。前の期間（月なら前の月、年なら前の年の同じ月ぶん）と比べる。
  const analysis = useMemo(() => {
    if (detail === null || detail.type !== 'category') return null;
    const previousKeys = isMonth ? [shiftMonth(monthKey, -1)] : periodKeys.map((key) => shiftMonth(key, -12));
    return buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, previousKeys);
  }, [detail, isMonth, monthKey, periodKeys, records, categories, budgets]);
  const periodLabel = isMonth ? `${Number(monthKey.slice(5, 7))}月` : formatYear(year);

  return (
    <View style={styles.flex}>
      <PeriodBar
        period={period}
        onPeriod={onPeriod}
        monthKey={monthKey}
        onMonth={onMonth}
        year={year}
        onYear={onYear}
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          compact
          label={isMonth ? '収支' : '収支（年）'}
          value={formatBalance(balance)}
          plus={balance > 0}
          note="収入 − 支出"
        >
          <StatRow compact label="収入" value={formatYen(income)} plus={income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(living)}`} />
          {ytd !== null && (
            <StatRow
              compact
              label="年初からの累計"
              value={formatBalance(ytd)}
              plus={ytd > 0}
            />
          )}
          {!isMonth && yearSummary.average !== null && (
            <StatRow
              compact
              label="月平均"
              note={`記録のある${yearSummary.recordedMonths}か月ぶん`}
              value={formatBalance(yearSummary.average.balance)}
              plus={yearSummary.average.balance > 0}
            />
          )}
          {comparison !== null && (
            <StatRow
              compact
              label="前年の同じ月より"
              note={`前年 ${formatBalance(comparison.previousBalance)}（${comparison.months}か月ぶん）`}
              value={formatSignedYen(comparison.diff)}
              minus={comparison.diff < 0}
            />
          )}
          {estimates.count > 0 && (
            <View style={styles.estimate}>
              <EstimateBadge />
              <Text style={[type.faint, styles.flex]}>
                見込みの額 {estimates.count}件（{formatYen(estimates.amount)}）を含みます。額を確かめて直すと確定します
              </Text>
            </View>
          )}
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
                  <Text style={type.link}>カテゴリ・予算</Text>
                </Pressable>
              }
            />
            {tiles.length === 0 && (
              <Text style={styles.message}>「カテゴリ・予算」で種類と月の予算を決めると、ここに予算との差が出ます</Text>
            )}
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  divided={index > 0}
                  onPress={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            {yearSummary.recordedMonths > 0 && (
              <>
                <SectionHeader compact title="月ごとの推移" hint="棒は月の収支・線は年初からの累計" />
                <View style={styles.card}>
                  <YearFlowChart months={yearSummary.months} />
                </View>
              </>
            )}
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
                  <Text style={type.link}>カテゴリ・予算</Text>
                </Pressable>
              }
            />
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  divided={index > 0}
                  onPress={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
            </View>
            <SectionHeader compact title="月ごと" hint="押すとその月へ" />
            {months.length === 0 ? (
              <Text style={styles.message}>この年はまだ記録がありません</Text>
            ) : (
              <View style={styles.card}>
                {months.map((row, index) => {
                  const number = Number(row.monthKey.slice(5, 7));
                  return (
                    <Pressable
                      key={row.monthKey}
                      accessibilityRole="button"
                      accessibilityLabel={`${number}月の振り返りを見る`}
                      onPress={() => onSelectMonth(row.monthKey)}
                      style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                    >
                      <Text style={styles.month}>{number}月</Text>
                      <View style={styles.flex}>
                        {row.recorded ? (
                          <Text style={type.faint} numberOfLines={1}>
                            収入 {formatYen(row.income)}・支出 {formatYen(row.living)}
                          </Text>
                        ) : (
                          <Text style={type.faint}>記録なし</Text>
                        )}
                      </View>
                      {estimatesInMonth(records, row.monthKey).length > 0 && <EstimateBadge />}
                      {row.recorded && (
                        <Text style={[styles.monthBalance, row.balance > 0 && styles.plus]}>{formatBalance(row.balance)}</Text>
                      )}
                      <ChevronRight size={16} color={colors.textFaint} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          isMonth={isMonth}
          analysis={analysis}
          categories={categories}
          wallets={wallets}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </View>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile, divided, onPress }: { tile: BudgetTile; divided: boolean; onPress: () => void }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  // 残りの額が大きく、予算を超えたら「残り −¥1,234」（符号をつけた黒。超えたことは帯の赤で見せる）。
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff === 0
        ? '予算どおり'
        : `残り ${formatBalance(tile.diff)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tile.category.name}の分析と記録を見る`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.categoryRow, divided && styles.rowDivided, pressed && styles.pressed]}
    >
      <CategoryIcon iconKey={iconKeyOf(tile.category)} size={28} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {tile.category.name}
          </Text>
          <Text style={[styles.rowHeadline, quiet && styles.muted]}>{headline}</Text>
        </View>
        <View style={styles.rowBar}>
          <View style={styles.flex}>
            <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
          </View>
          <Text style={type.faint}>
            {formatYen(tile.actual)}
            {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
            {tile.percent !== null ? `・${tile.percent}%` : ''}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  gap: { height: 12 },
  estimate: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  bar: { paddingVertical: 6 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
  categoryRow: { gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  month: { width: 40, fontSize: 15, fontWeight: '700', color: colors.text },
  monthBalance: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
  rowBody: { flex: 1, gap: 3 },
  // 帯と「実績 / 予算・割合」を同じ行に（行の高さを抑える）。帯は残りの幅いっぱい。
  rowBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowHeadline: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textFaint },
});
