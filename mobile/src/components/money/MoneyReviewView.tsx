import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCardFeed,
  MoneyCategory,
  MoneyFeedItem,
  MoneyMonth,
  MoneyRecord,
  MoneyRecurring,
  MoneyReserve,
  MoneyWallet,
  MoneyWalletBalance,
} from '@/types/app';
import { cardMonthChecks } from '@/lib/moneyFeedUtils';
import { colors } from '@/lib/theme';
import {
  buildCategoryAnalysis,
  categoryPath,
  categorySpentIn,
  categoryYearLanding,
  buildYearLanding,
  dateKeyOfDate,
  estimateDiffsInYear,
  estimatesInMonth,
  fixedSpendInMonth,
  formatYear,
  formatYen,
  isMonthClosed,
  monthKeyOfDate,
  periodSummary,
  recordTotal,
  recurringPlanInYear,
  reserveUsage,
  topCategoryIdOf,
  unclosedMonths,
  variableTiles,
  yearActiveMonthKeys,
  yearMonthKeys,
} from '@/lib/moneyUtils';
import ReviewDetailScreen, { type ReviewDetail } from '@/components/money/ReviewDetailScreen';
import MonthCloseScreen from '@/components/money/MonthCloseScreen';
import YearTrendChart from '@/components/money/YearTrendChart';
import { yearTrendPoints } from '@/lib/yearTrend';
import { EstimateBadge, PeriodBar, SectionHeader, type, type ReviewPeriod } from '@/components/money/moneyVisual';
import {
  AmountRow,
  BalanceCard,
  SECTION_DOTS,
  SectionCard,
  remainingText,
  signedYen,
  type ChipTone,
} from '@/components/money/reviewParts';

// 家計タブの「振り返り」（docs/kakei.md §4）。PWA版の `src/components/sukusuku/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は収支＝収入 − 支出。貯金は記録なので式にも表示にも入れない。
// いちばん上の収支の枠（BalanceCard）は年間予算と同じ形（2026-10-22。docs/kakei.md §0.7）。収入・支出を切り替えて内訳の割合を出す
// （収入は大分類ごと、支出は変動費〔変動費＋予備費〕と固定費〔固定費＋変動固定費〕）。年は枠の下に年末の着地見込み。
// その下は 変動費 → 予備費 → 固定費 の枠（押すと折りたたむ。開いたときは固定費だけ閉じる）。
// - 変動費: 大分類ごとの実績と、予算の残り（超過は赤）。行を押すと、簡単な分析と、その大分類に絞った記録の一覧（ReviewDetailScreen。§4.4）
// - 予備費: 小分類ごとの年の予算の残り。月は今月使った額、年はその年に使った額
// - 固定費: 月はその月に記録があったもの（予算との差は出さない。押すと記録）。年は確定・見込みの実績と年の予算、見込みと実績の差
// 年は枠の下に推移のグラフ。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。
// 月の締め（§4.5）: 過ぎた月と今月の結論の下に「この月を締める」（月の最終週に締めることもあるため、今月も出す）（締めた月は「締めた月」）。押すと締めの画面（MonthCloseScreen）。
// 締めていない過ぎた月があれば、いちばん上に「◯月が締まっていません」と出す（押すとその月の締めの画面）。
// 年の「推移」（§4.8）: 結論とカテゴリの間に、月ごとの収支（棒）と年初からの累計（折れ線）。締めた月は実線、ほかは年末まで点線（年末の着地見込みと同じ数え方。§4.6）。
// 月を押すと吹き出しで収支と累計、吹き出しを押すとその月の振り返りへ。

interface MoneyReviewViewProps {
  /** この面を開いているか。false から true になったとき、いちばん上へ戻す。 */
  active: boolean;
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
  /** 確定した残高（月の締めで、月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 固定収入・固定費のルール（締めの画面に、これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 予備費（小分類ごとの年の額。年末の着地見込みで引く。docs/kakei.md §0.7）。 */
  reserves: MoneyReserve[];
  /** 未確認の明細（締めの画面に、その月の件数を出す）。 */
  feedItems: MoneyFeedItem[];
  /** カードの利用通知の取り込み（締めの画面で、カードの記録を明細と見比べる）。読み込み前は null。 */
  cardFeed: MoneyCardFeed | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onSetMonthClosed: (monthKey: string, closed: boolean) => void;
  onOpenFeed: () => void;
}

export default function MoneyReviewView({
  active,
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
  balances,
  onSelectMonth,
  onOpenRecord,
  months: closings,
  recurring,
  reserves,
  feedItems,
  cardFeed,
  onConfirmEstimate,
  onSetMonthClosed,
  onOpenFeed,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const year = yearProp;
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [monthDetail, setMonthDetail] = useState<{ category: MoneyCategory; monthKey: string } | null>(null);
  // 締めの画面を開いている月。
  const [closing, setClosing] = useState<string | null>(null);
  const unclosed = useMemo(() => unclosedMonths(records, closings, today), [records, closings, today]);
  const monthClosed = isMonthClosed(closings, monthKey);
  const openClosing = (target: string) => {
    if (isMonth) onMonth(target);
    else onSelectMonth(target);
    setClosing(target);
  };

  // 年の数える月（今月まで）。
  const yearKeys = useMemo(() => yearMonthKeys(year).filter((key) => key <= today), [year, today]);
  const summaryKeys = useMemo(() => (isMonth ? [monthKey] : yearKeys), [isMonth, monthKey, yearKeys]);
  const summary = useMemo(
    () => periodSummary(records, categories, budgets, reserves, recurring, summaryKeys),
    [records, categories, budgets, reserves, recurring, summaryKeys],
  );
  // 年末の着地見込みと「推移」グラフ（§4.6・§4.8）。締めた月は実額、ほかは年末まで見込み。
  const landing = useMemo(
    () => (isMonth ? null : buildYearLanding(records, categories, budgets, recurring, reserves, closings, year, dateKeyOfDate(new Date()))),
    [isMonth, records, categories, budgets, recurring, reserves, closings, year],
  );
  const trend = useMemo(() => (landing === null ? [] : yearTrendPoints(landing.months)), [landing]);
  // 見ている期間の月。月なら1つ、年なら使い始めた月から12月まで（年の予算がかかる月。使い始める前の月の予算は数えない。2026-10-15）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearActiveMonthKeys(records, year)),
    [isMonth, monthKey, records, year],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : variableTiles(records, categories, budgets, reserves, recurring, periodKeys)),
    [periodKeys, records, categories, budgets, reserves, recurring],
  );
  const reserveYear = isMonth ? Number(monthKey.slice(0, 4)) : year;
  const reserveRows = useMemo(() => {
    const usage = reserveUsage(reserves, records, reserveYear);
    const position = (id: string | null) => categories.find((category) => category.id === id)?.position ?? 0;
    return usage.rows
      .map((row) => ({ ...row, category: categories.find((category) => category.id === row.categoryId) }))
      .filter((row) => row.category !== undefined)
      .sort((a, b) => position(a.category?.parentId ?? null) - position(b.category?.parentId ?? null) || (a.category?.position ?? 0) - (b.category?.position ?? 0))
      .map((row) => ({ ...row, period: isMonth ? categorySpentIn(records, row.categoryId, [monthKey]) : row.spent }));
  }, [reserves, records, reserveYear, categories, isMonth, monthKey]);
  const fixedMonth = useMemo(
    () => (isMonth ? fixedSpendInMonth(records, categories, budgets, reserves, recurring, monthKey) : []),
    [isMonth, records, categories, budgets, reserves, recurring, monthKey],
  );
  const fixedYear = useMemo(() => {
    if (isMonth) return null;
    const todayKey = dateKeyOfDate(new Date());
    const plan = recurringPlanInYear(recurring, categories, budgets, records, year, todayKey);
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
    return {
      confirmed: total(plan.confirmed),
      estimate: total(plan.estimate),
      diffs: estimateDiffsInYear(recurring, records, year, todayKey),
    };
  }, [isMonth, recurring, categories, budgets, records, year]);
  const [open, setOpen] = useState({ variable: true, reserve: true, fixed: false });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);

  // 内訳の行を押したときの分析。見ている期間の予算（年は年の予算）・実績・小分類ごと・記録。年は締めた月ごとの実績も出す（2026-10-16）。
  const analysis = useMemo(
    () => (detail === null ? null : buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, null)),
    [detail, periodKeys, records, categories, budgets],
  );
  // 年の詳細の月ごとの行（1月から。締めていない月も入る。2026-10-16）。
  const monthRows = useMemo(
    () =>
      isMonth || analysis === null
        ? null
        : analysis.months.map((entry) => ({ ...entry, closed: isMonthClosed(closings, entry.monthKey) })),
    [isMonth, analysis, closings],
  );
  // 年の詳細の年末の着地見込み（締めた月は実績、ほかの月は月の予算）。
  const categoryLanding = useMemo(
    () =>
      isMonth || analysis === null
        ? null
        : categoryYearLanding(analysis.months, new Set(analysis.months.filter((entry) => isMonthClosed(closings, entry.monthKey)).map((entry) => entry.monthKey))),
    [isMonth, analysis, closings],
  );
  // 年の詳細の月の行を押したときの、その月のカテゴリの詳細。
  const monthAnalysis = useMemo(
    () =>
      monthDetail === null
        ? null
        : buildCategoryAnalysis(records, categories, budgets, monthDetail.category.id, [monthDetail.monthKey], null),
    [monthDetail, records, categories, budgets],
  );
  const periodLabel = isMonth ? `${Number(monthKey.slice(5, 7))}月` : formatYear(year);
  const lastYearMonth = yearKeys.length === 0 ? 0 : Number(yearKeys[yearKeys.length - 1].slice(5, 7));
  const balanceLabel = isMonth
    ? `収支（${Number(monthKey.slice(5, 7))}月）`
    : lastYearMonth === 0 || lastYearMonth === 12
      ? `収支（${formatYear(year)}）`
      : `収支（1〜${lastYearMonth}月）`;
  const budgeted = tiles.filter((tile) => tile.budget !== null);
  const variableBudget = budgeted.reduce((sum, tile) => sum + (tile.budget ?? 0), 0);
  const variableActual = budgeted.reduce((sum, tile) => sum + tile.actual, 0);
  const chipOf = (value: number, label: string): { text: string; tone: ChipTone } =>
    value < 0 ? { text: `超過 ${formatYen(value)}`, tone: 'over' } : { text: `${label} ${formatYen(value)}`, tone: 'good' };
  const variableChip = budgeted.length === 0 ? null : chipOf(variableBudget - variableActual, '残り');
  const reserveAmount = reserveRows.reduce((sum, row) => sum + row.amount, 0);
  const reserveSpent = reserveRows.reduce((sum, row) => sum + row.spent, 0);
  const reserveChip = isMonth
    ? { text: `今月 ${formatYen(reserveRows.reduce((sum, row) => sum + row.period, 0))}`, tone: 'neutral' as const }
    : chipOf(reserveAmount - reserveSpent, '残り');
  const fixedChip: { text: string; tone: ChipTone } =
    fixedYear === null
      ? { text: `今月 ${formatYen(fixedMonth.reduce((sum, entry) => sum + entry.amount, 0))}`, tone: 'neutral' }
      : fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate < 0
        ? { text: `超過 ${formatYen(fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate)}`, tone: 'over' }
        : { text: `これから ${formatYen(fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate)}`, tone: 'neutral' };
  // 予備費の行を押したとき: その小分類の大分類の詳細。
  const openTopOf = (categoryId: string) => {
    const topId = topCategoryIdOf(categories, categoryId);
    const top = categories.find((category) => category.id === topId);
    if (top) setDetail({ type: 'category', category: top });
  };

  // この面を開くたびに、いちばん上から（隠していただけの面に、前のスクロールが残らないように。2026-10-16）。
  const scrollRef = useRef<ScrollView>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) scrollRef.current?.scrollTo({ y: 0, animated: false });
    wasActive.current = active;
  }, [active]);

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
      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content}>
        {unclosed.length > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => openClosing(unclosed[0])}
            style={({ pressed }) => [styles.unclosed, pressed && styles.pressed]}
          >
            <Text style={[styles.unclosedText, styles.flex]}>
              {`${Number(unclosed[0].slice(5, 7))}月が締まっていません${unclosed.length > 1 ? `（ほか${unclosed.length - 1}か月）` : ''}。収支を確かめて締めましょう`}
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        )}
        <View style={styles.gap} />
        <BalanceCard
          label={balanceLabel}
          incomeParts={summary.income.map((part) => ({ name: part.name, amount: part.amount }))}
          expenseParts={[
            { name: '変動費', amount: summary.variable + summary.reserve, note: '変動費＋予備費' },
            { name: '固定費', amount: summary.confirmed + summary.estimate, note: '固定費＋変動固定費' },
          ]}
        >
          {estimates.count > 0 && (
            <View style={styles.cardFoot}>
              <EstimateBadge />
              <Text style={[type.faint, styles.flex]}>
                見込み {estimates.count}件（{formatYen(estimates.amount)}）
              </Text>
            </View>
          )}
          {landing !== null && (
            <View style={styles.cardFoot}>
              <Text style={styles.footLabel}>年末の着地見込み</Text>
              <Text style={[styles.footValue, landing.total < 0 && styles.over]}>{signedYen(landing.total)}</Text>
            </View>
          )}
          {isMonth && (monthClosed || monthKey <= today) && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setClosing(monthKey)}
              style={({ pressed }) => [styles.cardFoot, pressed && styles.pressed]}
            >
              <Text style={[monthClosed ? styles.closedText : styles.closeText, styles.flex]}>
                {monthClosed ? '締めた月' : 'この月を締める'}
              </Text>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          )}
        </BalanceCard>

        <View style={styles.gap} />
        <SectionCard
          title="変動費"
          dot={SECTION_DOTS.variable}
          chip={variableChip}
          progress={isMonth || variableBudget === 0 ? null : variableActual / variableBudget}
          open={open.variable}
          onToggle={() => toggle('variable')}
        >
          {tiles.length === 0 && <Text style={styles.message}>「年間予算」で変動費の予算を決めると、ここに予算との差が出ます</Text>}
          {tiles.map((tile) => (
            <AmountRow
              key={tile.category.id}
              name={tile.category.name}
              amount={formatYen(tile.actual)}
              right={tile.budget === null ? { text: '予算なし', muted: true } : remainingText(tile.diff)}
              progress={tile.budget ? tile.actual / tile.budget : null}
              onPress={() => setDetail({ type: 'category', category: tile.category })}
            />
          ))}
        </SectionCard>

        {reserveRows.length > 0 && (
          <>
            <View style={styles.gap} />
            <SectionCard
              title="予備費"
              dot={SECTION_DOTS.reserve}
              chip={reserveChip}
              progress={isMonth || reserveAmount === 0 ? null : reserveSpent / reserveAmount}
              open={open.reserve}
              onToggle={() => toggle('reserve')}
            >
              {reserveRows.map((row) => (
                <AmountRow
                  key={row.categoryId}
                  name={row.category?.name ?? ''}
                  amount={formatYen(row.period)}
                  faint={row.period === 0}
                  right={remainingText(row.amount - row.spent)}
                  progress={row.amount > 0 ? row.spent / row.amount : row.spent > 0 ? 2 : 0}
                  onPress={() => openTopOf(row.categoryId)}
                />
              ))}
            </SectionCard>
          </>
        )}

        <View style={styles.gap} />
        <SectionCard
          title="固定費"
          dot={SECTION_DOTS.fixed}
          chip={fixedChip}
          progress={fixedYear === null || fixedYear.confirmed + fixedYear.estimate === 0 ? null : (summary.confirmed + summary.estimate) / (fixedYear.confirmed + fixedYear.estimate)}
          open={open.fixed}
          onToggle={() => toggle('fixed')}
        >
          {isMonth && fixedMonth.length === 0 && <Text style={styles.message}>この月の固定費の記録はありません</Text>}
          {fixedMonth.map((entry) => (
            <AmountRow
              key={`${entry.record.id}-${entry.categoryId}`}
              name={categories.find((category) => category.id === entry.categoryId)?.name ?? ''}
              sub={`${Number(entry.record.occurredOn.slice(5, 7))}/${Number(entry.record.occurredOn.slice(8, 10))}・${entry.mode === 'confirmed' ? '確定' : '見込み'}`}
              amount={formatYen(entry.amount)}
              onPress={() => onOpenRecord(entry.record)}
            />
          ))}
          {fixedYear !== null && (
            <>
              <AmountRow name="確定" amount={formatYen(summary.confirmed)} right={{ text: `/ ${formatYen(fixedYear.confirmed)}`, muted: true }} />
              <AmountRow name="見込み" amount={formatYen(summary.estimate)} right={{ text: `/ ${formatYen(fixedYear.estimate)}`, muted: true }} />
              {fixedYear.diffs.map((entry) => (
                <AmountRow
                  key={`${entry.rule.id}-${entry.plannedMonth}`}
                  name={`${entry.rule.name.trim() || categoryPath(categories, entry.rule.categoryId)}（${Number(entry.plannedMonth.slice(5, 7))}月）`}
                  amount={formatYen(entry.actual)}
                  right={{ text: `見込みより ${signedYen(entry.actual - entry.amount)}`, over: entry.actual > entry.amount }}
                />
              ))}
            </>
          )}
        </SectionCard>

        {!isMonth && trend.length > 0 && (
          <>
            <SectionHeader compact title="推移" right={<TrendLegend />} />
            <View style={[styles.card, styles.trendCard]}>
              <YearTrendChart points={trend} initialMonthKey={today} onSelectMonth={onSelectMonth} />
            </View>
          </>
        )}
      </ScrollView>

      {closing !== null && (
        <MonthCloseScreen
          monthKey={closing}
          records={records}
          categories={categories}
          budgets={budgets}
          recurring={recurring}
          today={dateKeyOfDate(new Date())}
          feedCount={feedItems.filter((item) => item.occurredOn !== null && item.occurredOn.startsWith(`${closing}-`)).length}
          cardChecks={cardFeed && cardFeed.walletIds.length > 0 ? cardMonthChecks(records, cardFeed, closing) : null}
          wallets={wallets}
          balances={balances}
          closed={isMonthClosed(closings, closing)}
          closedAt={closings.find((entry) => entry.month === closing)?.closedAt ?? null}
          onConfirmEstimate={onConfirmEstimate}
          // 記録・未確認の明細は締めの画面の上に重ねて開く（閉じる・戻るで締めの画面へ戻る。2026-10-21）
          onOpenRecord={onOpenRecord}
          onOpenFeed={onOpenFeed}
          onCloseMonth={() => {
            onSetMonthClosed(closing, true);
            setClosing(null);
          }}
          onReopenMonth={() => onSetMonthClosed(closing, false)}
          onClose={() => setClosing(null)}
        />
      )}

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          analysis={analysis}
          monthRows={monthRows}
          landing={categoryLanding}
          onOpenMonth={(key) => setMonthDetail({ category: detail.category, monthKey: key })}
          categories={categories}
          wallets={wallets}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}

      {monthDetail !== null && (
        <ReviewDetailScreen
          detail={{ type: 'category', category: monthDetail.category }}
          periodLabel={`${Number(monthDetail.monthKey.slice(5, 7))}月`}
          analysis={monthAnalysis}
          monthRows={null}
          landing={null}
          onOpenMonth={() => undefined}
          categories={categories}
          wallets={wallets}
          onClose={() => setMonthDetail(null)}
          onOpenRecord={(record) => {
            setMonthDetail(null);
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </View>
  );
}

/** 「推移」の見出しの右の凡例（棒＝収支、折れ線＝年の累計）。 */
function TrendLegend() {
  return (
    <View style={styles.links}>
      <View style={styles.legendItem}>
        <View style={styles.legendBar} />
        <Text style={type.faint}>収支</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendLine} />
        <Text style={type.faint}>年の累計</Text>
      </View>
    </View>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・**予算との差**（予算 − 実績。黒字は緑・赤字は「−」の黒）、使った割合の帯、実績・予算（2026-10-16）。 */
const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 136 },
  gap: { height: 12 },
  links: { flexDirection: 'row', gap: 14 },
  trendCard: { paddingVertical: 4, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendBar: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.moneyRing },
  legendLine: { width: 16, height: 2, backgroundColor: colors.money },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  footLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textMuted },
  footValue: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  over: { color: '#b91c1c' },
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
  plus: { color: colors.moneyIncome },
  rowBody: { flex: 1, gap: 3 },
  // 帯と「実績 / 予算・割合」を同じ行に（行の高さを抑える）。帯は残りの幅いっぱい。
  rowBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowHeadline: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textFaint },
  // 締めていない月の注意（docs/kakei.md §4.5）。
  unclosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.moneyEstimateSurface,
  },
  unclosedText: { fontSize: 13, fontWeight: '600', color: colors.moneyEstimate },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  closeText: { fontSize: 14, fontWeight: '700', color: colors.money },
  closedText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  closedMark: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
});
