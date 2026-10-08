import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, SpecialActual, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildSpecialReview,
  buildYearSummary,
  fiscalYearOfMonth,
  formatSignedYen,
  formatYen,
  iconKeyOf,
  monthKeyOfDate,
  type BudgetTile,
  type SpecialReview,
} from '@/lib/moneyUtils';
import { buildYearRows } from '@/lib/specialUtils';
import {
  CategoryIcon,
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
// 結論は生活費の収支（特別費は入れない）＝収入 − 生活費（特別費以外の支出。種類の名前が「その他」でも生活費）。
// 貯金は記録なので式にも表示にも入れない。
// その下の「内訳」は、月なら生活費の大分類の一覧（予算を超えた順）の最後に特別費の1行、年なら特別費の1行。
// 特別費の行はその期間に払った額と年度の予算の残り（月ならその月までの累計）だけで、押すと「特別費」の面へ
// （2026-10-08に、生活費と同じ大きさの結論から内訳の1行にした。大部分は「特別費」の面で見る）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。

interface MoneyReviewViewProps {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 内訳の特別費の行を押したとき。「特別費」の面へ。 */
  onOpenSpecial: () => void;
}

export default function MoneyReviewView({
  period,
  onPeriod,
  monthKey,
  onMonth,
  fiscalYear,
  onFiscalYear,
  records,
  categories,
  budgets,
  specialItems,
  specialActuals,
  onSelectMonth,
  onEditCategories,
  onOpenSpecial,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const viewYear = isMonth ? fiscalYearOfMonth(monthKey) : fiscalYear;

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const year = useMemo(
    () => buildYearSummary(records, categories, budgets, fiscalYear, today),
    [records, categories, budgets, fiscalYear, today],
  );
  const tiles = useMemo(
    () => (isMonth ? buildBudgetTiles(records, categories, budgets, monthKey) : []),
    [isMonth, records, categories, budgets, monthKey],
  );
  const specialRows = useMemo(
    () => buildYearRows(specialItems, specialActuals, viewYear, 'expense'),
    [specialItems, specialActuals, viewYear],
  );
  const special = useMemo(() => buildSpecialReview(specialRows, isMonth ? monthKey : null), [specialRows, isMonth, monthKey]);

  const income = isMonth ? month.income : year.total.income;
  const living = isMonth ? month.living : year.total.living;
  const balance = isMonth ? month.balance : year.total.balance;
  const livingDiff = isMonth ? month.livingBudget - month.living : year.total.livingDiff;
  const planned = isMonth ? month.plannedBalance : null;
  const months = year.months.filter((row) => row.monthKey <= today && (row.recorded || row.special > 0)).reverse();

  return (
    <View style={styles.flex}>
      <PeriodBar
        period={period}
        onPeriod={onPeriod}
        monthKey={monthKey}
        onMonth={onMonth}
        fiscalYear={fiscalYear}
        onFiscalYear={onFiscalYear}
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          label={isMonth ? '生活費の収支' : '生活費の収支（年度）'}
          value={formatSignedYen(balance)}
          minus={balance < 0}
          note={
            planned !== null
              ? `収入 − 特別費以外の支出・予算どおりなら ${formatSignedYen(planned)}`
              : `収入 − 特別費以外の支出・記録のある${year.recordedMonths}か月ぶん`
          }
        >
          <StatRow label="収入" note="給与・臨時収入など" value={`+${formatYen(income)}`} />
          <StatRow
            label="生活費"
            note={
              isMonth
                ? `予算 ${formatYen(month.livingBudget)}（${livingDiff < 0 ? `${formatYen(livingDiff)} 超過` : `残り ${formatYen(livingDiff)}`}）`
                : livingDiff < 0
                  ? `予算より ${formatYen(livingDiff)} 多い`
                  : `予算より ${formatYen(livingDiff)} 少ない`
            }
            noteMinus={livingDiff < 0}
            value={`−${formatYen(living)}`}
          />
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              title="内訳"
              hint="予算を超えた順・特別費は最後"
              right={
                <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
                  <Text style={type.link}>種類と予算</Text>
                </Pressable>
              }
            />
            {tiles.length === 0 && (
              <Text style={styles.message}>「種類と予算」で種類と月の予算を決めると、ここに予算との差が出ます</Text>
            )}
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow key={tile.category.id} tile={tile} divided={index > 0} />
              ))}
              <SpecialRow special={special} isMonth divided={tiles.length > 0} onPress={onOpenSpecial} />
            </View>
          </>
        ) : (
          <>
            <SectionHeader title="内訳" />
            <View style={styles.card}>
              <SpecialRow special={special} isMonth={false} divided={false} onPress={onOpenSpecial} />
            </View>
            <SectionHeader title="月ごと" hint="押すとその月へ" />
            {months.length === 0 ? (
              <Text style={styles.message}>この年度はまだ記録がありません</Text>
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
                          <>
                            <Text style={type.faint}>収入 {formatYen(row.income)}</Text>
                            <Text style={[type.faint, row.livingDiff < 0 && type.minus]}>
                              生活費 {formatYen(row.living)}
                              {row.livingDiff < 0 ? '（予算超え）' : ''}
                            </Text>
                          </>
                        ) : (
                          <Text style={type.faint}>生活費の記録なし</Text>
                        )}
                        {row.special > 0 && <Text style={type.faint}>特別費 {formatYen(row.special)}</Text>}
                      </View>
                      {row.recorded && (
                        <Text style={[type.amount, row.balance < 0 && type.minus]}>{formatSignedYen(row.balance)}</Text>
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
    </View>
  );
}

/** 内訳の特別費の1行。その期間に払った額と、年度の予算の残り。押すと「特別費」の面へ。 */
function SpecialRow({
  special,
  isMonth,
  divided,
  onPress,
}: {
  special: SpecialReview;
  isMonth: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const over = special.remaining < 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="特別費を見る"
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.categoryRow, divided && styles.rowDivided, pressed && styles.pressed]}
    >
      <CategoryIcon iconKey="star" />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            特別費
          </Text>
          <Text style={[styles.rowHeadline, special.spent === 0 && styles.muted]}>
            {isMonth ? 'この月' : '年度'} {formatYen(special.spent)}
          </Text>
        </View>
        {special.yearBudget > 0 && <ProgressBar ratio={special.spentToDate / special.yearBudget} over={over} />}
        <Text style={[type.faint, over && type.minus]}>
          {special.yearBudget > 0
            ? `年度 ${formatYen(special.spentToDate)} / ${formatYen(special.yearBudget)}・${over ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}`
            : '「特別費」で予定を決めると、予算の残りが出ます'}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile, divided }: { tile: BudgetTile; divided: boolean }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff < 0
        ? `${formatYen(tile.diff)} 超過`
        : tile.diff === 0
          ? '予算どおり'
          : `残り ${formatYen(tile.diff)}`;
  return (
    <View style={[styles.row, styles.categoryRow, divided && styles.rowDivided]}>
      <CategoryIcon iconKey={iconKeyOf(tile.category)} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {tile.category.name}
          </Text>
          <Text style={[styles.rowHeadline, over && type.minus, quiet && styles.muted]}>{headline}</Text>
        </View>
        <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
        <Text style={type.faint}>
          {formatYen(tile.actual)}
          {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
          {tile.percent !== null ? `・${tile.percent}%` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  gap: { height: 12 },
  bar: { paddingVertical: 6 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  categoryRow: { gap: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  month: { width: 40, fontSize: 15, fontWeight: '700', color: colors.text },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowHeadline: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textFaint },
});
