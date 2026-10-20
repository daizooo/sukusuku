import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { ChevronRight, Inbox, TriangleAlert, Undo2 } from 'lucide-react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import { groupRecordsByDay, type BalanceCheck } from '@/lib/moneyUtils';
import { RecordDayBlock, type RecordDay } from '@/components/money/RecordDayList';
import FastScrollBar, { useFastScroll } from '@/components/money/FastScrollBar';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に、**これまでの分をすべて**1本の一覧で並べる（2026-10-15。以前は月ごとだった）。
// 一覧そのものは RecordDayList の1日ぶん（RecordDayBlock）。長いので、見えるところだけ描く（FlatList）。
// **この面を開くたびに、いちばん上（新しい記録）から**見せる（2026-10-16。ほかの面から戻ったときも）。
// 右端の早送りバーは最初から出ていて、帯のどこを触っても、つかんで動かしても、その位置へ飛べる（触っているあいだだけ位置の日付が出る）。
// いちばん上から15件さかのぼると、上に「今日に戻る」を出す（押すと、いちばん上へ戻る）。
// その月に使った額は「振り返り」で見るので、ここには出さない（2026-10-08）。押すと記録の詳細。
// Gmail から取り込んだ明細の「未確認 n件」は、一覧の上に固定して出す（2026-10-18。以前は口座の面。docs/kakei.md §9.5.6.1）。
// Apps Script から1時間以上届いていなければ、その上に「Gmail の取り込みが止まっています」を出す（2026-10-20。§9.8）。

interface MoneyRecordsViewProps {
  /** この面を開いているか。false から true になったとき、いちばん上へ戻す。 */
  active: boolean;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
  /** 日の見出しの「＋」。その日（YYYY-MM-DD）で記録を足す。 */
  onAddOnDate: (date: string) => void;
  /** Gmail から取り込んだ明細のうち、片づいていないものの数（docs/kakei.md §9.5.6.1）。0 なら出さない。 */
  feedOpenCount: number;
  onOpenFeed: () => void;
  /** Apps Script から1時間以上届いていない（docs/kakei.md §9.8）。 */
  feedStalled: boolean;
}

/** 補正は口座の履歴にだけ混ぜるので、ここでは持たない。 */
const NO_CORRECTIONS: BalanceCheck[] = [];

/** いちばん上から、これだけ（記録の件数）さかのぼったら「今日に戻る」を出す。 */
const FAR_FROM_TOP = 15;

const bubbleLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}年${pad(month)}月${pad(day)}日(${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]})`;
};

const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const;

export default function MoneyRecordsView({
  active,
  records,
  categories,
  wallets,
  isLoading,
  onOpen,
  onAddOnDate,
  feedOpenCount,
  onOpenFeed,
  feedStalled,
}: MoneyRecordsViewProps) {
  const days = useMemo<RecordDay[]>(
    () => groupRecordsByDay(records).map((day) => ({ ...day, corrections: NO_CORRECTIONS })),
    [records],
  );

  const listRef = useRef<FlatList<RecordDay>>(null);
  const fastScroll = useFastScroll(listRef);
  // いま上に見えている日の位置（バーの日付・「今日に戻る」の判定に使う）。
  const [firstIndex, setFirstIndex] = useState(0);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.reduce<number | null>(
      (min, token) => (token.index !== null && (min === null || token.index < min) ? token.index : min),
      null,
    );
    if (first !== null) setFirstIndex(first);
  }).current;

  const scrollToTop = useCallback((animated: boolean) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  // ほかの面から戻ったときは、必ずいちばん上から。
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      scrollToTop(false);
      setFirstIndex(0);
    }
    wasActive.current = active;
  }, [active, scrollToTop]);

  // 日ごとの先頭までの記録の件数（いちばん上から、何件さかのぼったかを数える）。
  const recordsBefore = useMemo(() => {
    const counts: number[] = [];
    let total = 0;
    for (const day of days) {
      counts.push(total);
      total += day.records.length;
    }
    return counts;
  }, [days]);
  const farFromTop = (recordsBefore[firstIndex] ?? 0) > FAR_FROM_TOP;
  const label = days[firstIndex] ? bubbleLabel(days[firstIndex].date) : '';

  const renderItem = useCallback(
    ({ item }: { item: RecordDay }) => (
      <RecordDayBlock day={item} categories={categories} wallets={wallets} onOpen={onOpen} onAddOnDate={onAddOnDate} />
    ),
    [categories, wallets, onOpen, onAddOnDate],
  );

  return (
    <View style={styles.flex}>
      {feedStalled && (
        <View style={styles.stalled}>
          <TriangleAlert size={18} color={colors.milkBadgeText} />
          <Text style={styles.stalledText}>Gmail の取り込みが止まっています（1時間以上届いていません）</Text>
        </View>
      )}
      {feedOpenCount > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenFeed}
          style={({ pressed }) => [styles.feed, pressed && styles.feedPressed]}
        >
          <Inbox size={18} color={colors.moneyText} />
          <Text style={styles.feedText}>未確認 {feedOpenCount}件</Text>
          <Text style={styles.feedSub}>Gmail から取り込んだ明細</Text>
          <ChevronRight size={16} color={colors.moneyText} />
        </Pressable>
      )}
      <View style={styles.flex} onLayout={fastScroll.onLayout}>
        <FlatList
          ref={listRef}
          data={days}
          keyExtractor={(day) => day.date}
          renderItem={renderItem}
          style={styles.flex}
          contentContainerStyle={styles.content}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onScroll={fastScroll.onScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          ListEmptyComponent={
            <Text style={styles.message}>
              {isLoading ? '読み込み中...' : 'まだ記録がありません。右下の「＋」で記録します'}
            </Text>
          }
        />
        {farFromTop && (
          <View pointerEvents="box-none" style={styles.todayWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="今日の記録へ戻る"
              onPress={() => scrollToTop(recordsBefore[firstIndex] < 200)}
              style={({ pressed }) => [styles.today, pressed && styles.todayPressed]}
            >
              <Undo2 size={16} color="#ffffff" />
              <Text style={styles.todayText}>今日に戻る</Text>
            </Pressable>
          </View>
        )}
        <FastScrollBar controller={fastScroll} label={label} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右端のバーと、右下の「＋」に一覧の最後が隠れないよう、右と下を空ける。
  content: { paddingLeft: 16, paddingRight: 24, paddingBottom: 96 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  todayWrap: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.money,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  todayPressed: { opacity: 0.85 },
  todayText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  feed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: colors.moneySoft,
  },
  feedPressed: { opacity: 0.7 },
  feedText: { fontSize: 15, fontWeight: '800', color: colors.moneyText },
  feedSub: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.moneyText },
  stalled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: colors.milkBadge,
  },
  stalledText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.milkBadgeText },
});
