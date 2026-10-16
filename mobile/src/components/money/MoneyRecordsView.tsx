import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { Undo2 } from 'lucide-react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import { dateKeyOfDate, groupRecordsByDay, type BalanceCheck } from '@/lib/moneyUtils';
import { RecordDayBlock, type RecordDay } from '@/components/money/RecordDayList';
import FastScrollBar, { useFastScroll } from '@/components/money/FastScrollBar';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に、**これまでの分をすべて**1本の一覧で並べる（2026-10-15。以前は月ごとだった）。
// 一覧そのものは RecordDayList の1日ぶん（RecordDayBlock）。長いので、見えるところだけ描く（FlatList）。
// 右端の早送りのバーをつかんで動かすと、過去へすぐ飛べる（つかんでいるあいだだけ位置の日付が出る）。
// 今日から過去へ15件さかのぼると、上に「今日に戻る」を出す（一番上にいるときは出さない）。その月に使った額は「振り返り」で見るので、ここには出さない（2026-10-08）。
// 押すと記録の詳細。

interface MoneyRecordsViewProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
  /** 日の見出しの「＋」。その日（YYYY-MM-DD）で記録を足す。 */
  onAddOnDate: (date: string) => void;
}

/** 補正は口座の履歴にだけ混ぜるので、ここでは持たない。 */
const NO_CORRECTIONS: BalanceCheck[] = [];

/** 今日より過去へ、これだけ（記録の件数）さかのぼったら「今日に戻る」を出す（2026-10-16）。 */
const FAR_FROM_TODAY = 15;

const bubbleLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}年${pad(month)}月${pad(day)}日(${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]})`;
};

const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const;

export default function MoneyRecordsView({
  records,
  categories,
  wallets,
  isLoading,
  onOpen,
  onAddOnDate,
}: MoneyRecordsViewProps) {
  const days = useMemo<RecordDay[]>(
    () => groupRecordsByDay(records).map((day) => ({ ...day, corrections: NO_CORRECTIONS })),
    [records],
  );
  // 今日（以前の日のうち、いちばん新しいもの）の位置。先の日付の記録があるときは、その下になる。
  const todayIndex = useMemo(() => {
    const today = dateKeyOfDate(new Date());
    const index = days.findIndex((day) => day.date <= today);
    return index < 0 ? 0 : index;
  }, [days]);

  const listRef = useRef<FlatList<RecordDay>>(null);
  const fastScroll = useFastScroll(listRef);
  const daysRef = useRef(days);
  daysRef.current = days;
  // いま上に見えている日の位置（見出し・「今日に戻る」の判定に使う）。
  const [firstIndex, setFirstIndex] = useState(0);
  const openedAtToday = useRef(false);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.reduce<number | null>(
      (min, token) => (token.index !== null && (min === null || token.index < min) ? token.index : min),
      null,
    );
    if (first !== null) setFirstIndex(first);
  }).current;

  const jumpToIndex = useCallback((index: number, animated: boolean) => {
    if (index <= 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated });
      return;
    }
    listRef.current?.scrollToIndex({ index, animated, viewPosition: 0 });
  }, []);

  // 描いていない遠くへ飛ぶときは、平均の高さで近くまで動かしてから、あらためて合わせる。
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      setTimeout(() => jumpToIndex(Math.min(info.index, daysRef.current.length - 1), false), 120);
    },
    [jumpToIndex],
  );

  // 先の日付の記録があるときは、はじめに今日の位置へ合わせる（面が出て、一覧の高さが分かったとき1回だけ）。
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (openedAtToday.current || height <= 0 || daysRef.current.length === 0) return;
      openedAtToday.current = true;
      if (todayIndex > 0) {
        jumpToIndex(todayIndex, false);
        // 描いていない日は高さが定まらず位置がずれることがあるので、描いたあとにもう一度合わせる。
        setTimeout(() => jumpToIndex(todayIndex, false), 300);
      }
    },
    [todayIndex, jumpToIndex],
  );

  // 日ごとの先頭までの記録の件数（今日から過去へ、何件さかのぼったかを数える）。
  const recordsBefore = useMemo(() => {
    const counts: number[] = [];
    let total = 0;
    for (const day of days) {
      counts.push(total);
      total += day.records.length;
    }
    return counts;
  }, [days]);
  const farFromToday = firstIndex > todayIndex && recordsBefore[firstIndex] - recordsBefore[todayIndex] > FAR_FROM_TODAY;
  const label = days[firstIndex] ? bubbleLabel(days[firstIndex].date) : '';

  const renderItem = useCallback(
    ({ item }: { item: RecordDay }) => (
      <RecordDayBlock day={item} categories={categories} wallets={wallets} onOpen={onOpen} onAddOnDate={onAddOnDate} />
    ),
    [categories, wallets, onOpen, onAddOnDate],
  );

  return (
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
        onContentSizeChange={onContentSizeChange}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        onScrollToIndexFailed={onScrollToIndexFailed}
        ListEmptyComponent={
          <Text style={styles.message}>
            {isLoading ? '読み込み中...' : 'まだ記録がありません。右下の「＋」で記録します'}
          </Text>
        }
      />
      {farFromToday && (
        <View pointerEvents="box-none" style={styles.todayWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="今日の記録へ戻る"
            onPress={() => jumpToIndex(todayIndex, firstIndex - todayIndex < 40)}
            style={({ pressed }) => [styles.today, pressed && styles.todayPressed]}
          >
            <Undo2 size={16} color="#ffffff" />
            <Text style={styles.todayText}>今日に戻る</Text>
          </Pressable>
        </View>
      )}
      <FastScrollBar controller={fastScroll} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
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
});
