import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, ChevronLeft, ChevronRight, Search, X } from 'lucide-react-native';
import type { ScheduleView } from '@/types/app';
import { colors } from '@/lib/theme';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';

// 予定タブの見出し（1行）。Googleカレンダーの見出しにならう（ヘルプ・設定・予定とタスクの切り替えは置かない）:
//   今日 / ‹ › / 年月（押すと月・日を選べる） / 検索 / 表示の切り替え（月・日・リスト）。予定の追加は右下の丸いボタン
// 検索中は1行まるごと検索欄に替わる。
// Web版の `src/components/sukusuku/schedule/ScheduleHeader.tsx` と同じ並び。

const VIEW_OPTIONS: SelectOption<ScheduleView>[] = [
  { value: 'month', label: '月' },
  { value: 'day', label: '日' },
  { value: 'list', label: 'リスト' },
];

interface ScheduleHeaderProps {
  view: ScheduleView;
  title: string;
  onChangeView: (view: ScheduleView) => void;
  onToday: () => void;
  /** 前へ（-1）・次へ（1）。リストには日付送りが無いので出さない。 */
  onStep: (delta: number) => void;
  /** 見出しの年月・日付を押したとき。月・日を選んで移る。 */
  onPickDate: () => void;
  /** 検索中の文字。null なら検索していない。 */
  searchQuery: string | null;
  onChangeSearchQuery: (query: string) => void;
  onStartSearch: () => void;
  onEndSearch: () => void;
}

export default function ScheduleHeader({
  view,
  title,
  onChangeView,
  onToday,
  onStep,
  onPickDate,
  searchQuery,
  onChangeSearchQuery,
  onStartSearch,
  onEndSearch,
}: ScheduleHeaderProps) {
  if (searchQuery !== null) {
    return (
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="検索を閉じる" onPress={onEndSearch} hitSlop={8}>
          <ArrowLeft size={22} color={colors.textSubtle} />
        </Pressable>
        <TextInput
          value={searchQuery}
          onChangeText={onChangeSearchQuery}
          placeholder="これからの予定を検索"
          placeholderTextColor={colors.textFaint}
          autoFocus
          returnKeyType="search"
          style={styles.searchInput}
        />
        {searchQuery !== '' && (
          <Pressable accessibilityRole="button" accessibilityLabel="検索の文字を消す" onPress={() => onChangeSearchQuery('')} hitSlop={8}>
            <X size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" onPress={onToday} style={styles.todayButton}>
        <Text style={styles.todayText}>今日</Text>
      </Pressable>
      {view !== 'list' && (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="前へ" onPress={() => onStep(-1)} hitSlop={6}>
            <ChevronLeft size={22} color={colors.textSubtle} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="次へ" onPress={() => onStep(1)} hitSlop={6}>
            <ChevronRight size={22} color={colors.textSubtle} />
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view === 'month' ? '月を選ぶ' : '日付を選ぶ'}
        onPress={onPickDate}
        disabled={view === 'list'}
        style={styles.titleButton}
      >
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="予定を検索" onPress={onStartSearch} hitSlop={8}>
        <Search size={20} color={colors.textSubtle} />
      </Pressable>
      <SelectField
        options={VIEW_OPTIONS}
        value={view}
        onChange={onChangeView}
        accessibilityLabel="表示を切り替える"
        style={styles.viewSelect}
        textStyle={styles.viewSelectText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  todayButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  todayText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  titleButton: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  viewSelect: { minHeight: 30, paddingHorizontal: 10, gap: 4, borderRadius: 999, borderColor: colors.borderStrong },
  viewSelectText: { fontSize: 12 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
