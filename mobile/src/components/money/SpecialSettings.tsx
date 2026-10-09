import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type { SpecialItem, SpecialItemDraft, SpecialKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { deleteSpecialItem, insertSpecialItem, updateSpecialItem } from '@/lib/api/specialExpenses';
import { appliesInYear, buildYearRows, formatYear, groupByMonth, yearTotals } from '@/lib/specialUtils';
import { categoryOptions } from '@/lib/stockUtils';
import { formatYen } from '@/lib/moneyUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import SpecialItemSheet from '@/components/money/SpecialItemSheet';
import { ScreenHeader, SectionHeader, YearBar, type } from '@/components/money/moneyVisual';

// 特別費の予定（家計の設定。docs/kakei.md §3.5・§4.3）。PWA版の `src/components/sukusuku/money/SpecialSettings.tsx` と同じ並び・文言。
//
// 支出予定と収入予定（年に数回の大きな出費・賞与など）の編集だけを持つ。年（1月〜12月）で送り、予定を月ごとに並べる。
// 「済」にする・実績を直す操作は無い。払った額は家計の記録に特別費の項目として入れ、いまどのくらい使っているかは
// 振り返りの内訳の「特別費」から追う。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '支出予定' },
  { id: 'income', label: '収入予定' },
];

interface SpecialSettingsProps {
  familyId: string;
  /** はじめに見る年（暦年）。 */
  year: number;
  items: SpecialItem[];
  onItems: (update: (prev: SpecialItem[]) => SpecialItem[]) => void;
  /** 項目を消すと、その項目で記録した特別費の記録も消える。家計タブの記録を読み直す。 */
  onRecordsChanged: () => void;
  onBack: () => void;
}

export default function SpecialSettings({ familyId, year: initialYear, items, onItems, onRecordsChanged, onBack }: SpecialSettingsProps) {
  const [year, setYear] = useState(initialYear);
  const [kind, setKind] = useState<SpecialKind>('expense');
  const [editing, setEditing] = useState<SpecialItem | 'new' | null>(null);

  // 予定の行だけ（実績は渡さない）。
  const rows = useMemo(() => buildYearRows(items, [], year, kind), [items, year, kind]);
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  const total = useMemo(() => yearTotals(rows).budget, [rows]);
  // この年には出ない項目（編集・削除ができるよう、別に並べる）。
  const others = useMemo(
    () => items.filter((item) => item.kind === kind && !appliesInYear(item, year)),
    [items, kind, year],
  );
  const categories = useMemo(() => categoryOptions(items), [items]);
  const label = kind === 'income' ? '収入予定' : '支出予定';

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');
  const nextPosition = () => items.reduce((max, item) => Math.max(max, item.position + 1), 0);

  const save = async (draft: SpecialItemDraft) => {
    const target = editing;
    setEditing(null);
    try {
      if (target === 'new' || target === null) {
        const created = await insertSpecialItem(supabase, familyId, draft, nextPosition());
        onItems((prev) => [...prev, created]);
        setKind(created.kind);
      } else {
        const updated = await updateSpecialItem(supabase, familyId, target.id, draft, target.plans);
        onItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setKind(updated.kind);
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (item: SpecialItem) => {
    setEditing(null);
    try {
      await deleteSpecialItem(supabase, item.id);
      onItems((prev) => prev.filter((entry) => entry.id !== item.id));
      onRecordsChanged();
    } catch {
      failed('削除');
    }
  };

  const monthLabel = (month: number | null) => (month === null ? '月未定' : `${year}年${month}月`);

  return (
    <View style={styles.flex}>
      <ScreenHeader title="特別費の予定" icon="back" onClose={onBack} />
      <YearBar year={year} onChange={setYear} />
      <SegmentedTabs
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        accessibilityLabel="支出予定か収入予定か"
        style={styles.kinds}
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <Text style={type.sub}>
            {formatYear(year)}の{label}
          </Text>
          <Text style={type.hero}>{formatYen(total)}</Text>
        </View>

        <SectionHeader
          title="予定"
          hint="月ごと"
          right={
            <Pressable accessibilityRole="button" onPress={() => setEditing('new')} hitSlop={8} style={styles.add}>
              <Plus size={14} color={colors.money} />
              <Text style={type.link}>項目を追加</Text>
            </Pressable>
          }
        />

        {groups.length === 0 ? (
          <Text style={styles.message}>
            {items.length > 0
              ? `${formatYear(year)}の${label}はありません`
              : '年に数回の大きな出費や賞与を「項目を追加」で登録すると、振り返りの内訳で予算と使った額を見られます'}
          </Text>
        ) : (
          groups.map((group) => (
            <View key={group.month ?? 'none'} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{monthLabel(group.month)}</Text>
                <Text style={type.faint}>{formatYen(group.budget)}</Text>
              </View>
              <View style={styles.card}>
                {group.rows.map((row, index) => {
                  const sub = [row.item.category, row.tentative ? '月は仮' : ''].filter((text) => text !== '').join('・');
                  return (
                    <Pressable
                      key={row.key}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.item.name}を編集`}
                      onPress={() => setEditing(row.item)}
                      style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                    >
                      <View style={styles.flex}>
                        <Text style={type.row} numberOfLines={1}>
                          {row.item.name}
                        </Text>
                        {sub !== '' && <Text style={type.faint}>{sub}</Text>}
                      </View>
                      <Text style={type.amount}>{formatYen(row.budget)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {others.length > 0 && (
          <>
            <SectionHeader title={`${formatYear(year)}は予定のない項目`} />
            <View style={styles.card}>
              {others.map((item, index) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}を編集`}
                  onPress={() => setEditing(item)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                >
                  <Text style={[type.row, styles.flex]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={type.faint}>{item.category}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {editing !== null && (
        <SpecialItemSheet
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          defaultKind={kind}
          year={year}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  kinds: { marginHorizontal: 16, marginBottom: 6 },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 32 },
  summary: { gap: 2, paddingVertical: 8 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  group: { marginBottom: 16 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
});
