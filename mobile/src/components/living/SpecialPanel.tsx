import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import type { SpecialActual, SpecialActualDraft, SpecialItem, SpecialKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import { toDateString } from '@/lib/dateUtils';
import {
  deleteSpecialActual,
  deleteSpecialItem,
  insertSpecialActual,
  insertSpecialItem,
  insertUnplannedSpecial,
  loadSpecialExpenses,
  updateSpecialActual,
  updateSpecialItem,
} from '@/lib/api/specialExpenses';
import {
  buildYearRows,
  calendarYearOf,
  formatFiscalYear,
  fiscalYearOf,
  groupByMonth,
  isOverBudget,
  yearTotals,
  type SpecialRow,
} from '@/lib/specialUtils';
import { categoryOptions } from '@/lib/stockUtils';
import { formatYen } from '@/lib/moneyUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import SpecialItemSheet, { type SpecialItemSheetResult } from '@/components/living/SpecialItemSheet';
import SpecialActualSheet from '@/components/living/SpecialActualSheet';
import { Hero, ProgressBar, SectionHeader, YearBar, type } from '@/components/money/moneyVisual';

// 家計タブの「特別費」（docs/home.md §5.4・docs/kakei.md §4.3）。年度の予定と実績。
// PWA版の `src/components/sukusuku/living/SpecialPanel.tsx` と同じ項目・並び・文言。
//
// 年度の送りと「特別費 / 特別収入」の切り替えは固定し、下をスクロールする。
// 結論は年度に払った額（特別収入は入った額）と、予算に対する進み具合・残り。
// その下に予定と実績を月ごと（4月→3月）に。1行＝予定1回ぶん（または予定外の出費1件）。
// 行の左の丸を1回押すと、予算の額・今日の日付で実績になる（額が違えば行を押して直す）。
// 実績は家計の記録の品目（docs/kakei.md §3.2）。「済」は品目1つの記録を作り、「記録」にも出る。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '特別費' },
  { id: 'income', label: '特別収入' },
];

type EditingRow = { row: SpecialRow } | null;
type EditingItem = SpecialItem | null;

interface SpecialPanelProps {
  familyId: string | null;
  /** 年度（4月始まり）。「年」と同じ年度を見る。 */
  fiscalYear: number;
  /** 予定外の出費を足したとき、その年度へ移る。 */
  onFiscalYear: (fiscalYear: number) => void;
  /** 実績（家計の記録）を足した・直した・消した。家計タブの記録を読み直す。 */
  onRecordsChanged?: () => void;
}

export default function SpecialPanel({ familyId, fiscalYear, onFiscalYear, onRecordsChanged }: SpecialPanelProps) {
  const [items, setItems] = useState<SpecialItem[]>([]);
  const [actuals, setActuals] = useState<SpecialActual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kind, setKind] = useState<SpecialKind>('expense');
  const [editingRow, setEditingRow] = useState<EditingRow>(null);
  const [editingItem, setEditingItem] = useState<EditingItem>(null);
  const [adding, setAdding] = useState(false);
  const onAddClose = () => setAdding(false);

  useEffect(() => {
    if (!familyId) return;
    let isMounted = true;
    loadSpecialExpenses(supabase, familyId)
      .then((loaded) => {
        if (!isMounted) return;
        setItems(loaded.items);
        setActuals(loaded.actuals);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [familyId]);

  const rows = useMemo(() => buildYearRows(items, actuals, fiscalYear, kind), [items, actuals, fiscalYear, kind]);
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  const totals = useMemo(() => yearTotals(rows), [rows]);
  // まだ済にしていない予定の件数。
  const pending = useMemo(() => rows.filter((row) => row.planId !== null && row.actual === null).length, [rows]);
  const categories = useMemo(() => categoryOptions(items), [items]);
  const hasAnything = items.length > 0;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');
  const nextPosition = () => items.reduce((max, item) => Math.max(max, item.position + 1), 0);
  const withActual = (actual: SpecialActual) => {
    setActuals((prev) => [...prev.filter((a) => a.id !== actual.id), actual]);
    onRecordsChanged?.();
  };

  /** 「済」: 予算の額・今日の日付で実績にする。 */
  const markPaid = async (row: SpecialRow) => {
    if (!familyId || row.planId === null) return;
    try {
      const created = await insertSpecialActual(supabase, row.item.kind, row.item.id, row.planId, {
        occurredOn: toDateString(new Date()),
        amount: row.budget,
        note: '',
      });
      withActual(created);
    } catch {
      failed('保存');
    }
  };

  const saveActual = async (row: SpecialRow, draft: SpecialActualDraft) => {
    setEditingRow(null);
    if (!familyId) return;
    try {
      const existing = row.actuals[0];
      withActual(
        existing
          ? await updateSpecialActual(supabase, existing, draft)
          : await insertSpecialActual(supabase, row.item.kind, row.item.id, row.planId, draft),
      );
    } catch {
      failed('保存');
    }
  };

  const clearActual = async (row: SpecialRow) => {
    setEditingRow(null);
    const removed = row.actuals;
    const removedIds = removed.map((actual) => actual.id);
    const previous = { items, actuals };
    setActuals((prev) => prev.filter((actual) => !removedIds.includes(actual.id)));
    // 予定の無い項目の唯一の実績を消したら、項目も残さない。
    const orphan = row.planId === null && row.item.plans.length === 0 &&
      !actuals.some((actual) => actual.itemId === row.item.id && !removedIds.includes(actual.id));
    if (orphan) setItems((prev) => prev.filter((item) => item.id !== row.item.id));
    try {
      if (orphan) await deleteSpecialItem(supabase, row.item.id);
      else await Promise.all(removed.map((actual) => deleteSpecialActual(supabase, actual)));
      onRecordsChanged?.();
    } catch {
      setItems(previous.items);
      setActuals(previous.actuals);
      failed('削除');
    }
  };

  const saveItem = async (result: SpecialItemSheetResult) => {
    const target = editingItem;
    setEditingItem(null);
    onAddClose();
    if (!familyId) return;
    try {
      if (result.type === 'unplanned') {
        const created = await insertUnplannedSpecial(
          supabase,
          familyId,
          result.fields,
          result.actual,
          fiscalYearOf(result.actual.occurredOn),
          nextPosition(),
        );
        setItems((prev) => [...prev, created.item]);
        withActual(created.actual);
        setKind(created.item.kind);
        onFiscalYear(fiscalYearOf(result.actual.occurredOn));
      } else if (target === null) {
        const created = await insertSpecialItem(supabase, familyId, result.draft, nextPosition());
        setItems((prev) => [...prev, created]);
        setKind(created.kind);
      } else {
        const updated = await updateSpecialItem(supabase, familyId, target.id, result.draft, target.plans);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        // 予定を消した実績は予定外として残る（DBの on delete set null）。画面の実績も合わせる。
        const planIds = new Set(updated.plans.map((plan) => plan.id));
        setActuals((prev) =>
          prev.map((actual) =>
            actual.itemId === updated.id && actual.planId !== null && !planIds.has(actual.planId)
              ? { ...actual, planId: null }
              : actual,
          ),
        );
      }
    } catch {
      failed('保存');
    }
  };

  const removeItem = async (id: string) => {
    setEditingItem(null);
    const previous = { items, actuals };
    setItems((prev) => prev.filter((item) => item.id !== id));
    setActuals((prev) => prev.filter((actual) => actual.itemId !== id));
    try {
      await deleteSpecialItem(supabase, id);
      onRecordsChanged?.();
    } catch {
      setItems(previous.items);
      setActuals(previous.actuals);
      failed('削除');
    }
  };

  const monthLabel = (month: number | null) =>
    month === null ? '月未定' : `${calendarYearOf(fiscalYear, month)}年${month}月`;

  const income = kind === 'income';
  const remaining = totals.budget - totals.actual;
  // 特別費/特別収入は、帯と中身の上の左右スワイプでも切り替える。
  const swipeHandlers = useSwipeTabs(
    KIND_OPTIONS.map((option) => option.id),
    kind,
    setKind,
  );

  return (
    <View style={styles.flex}>
      <YearBar fiscalYear={fiscalYear} onChange={onFiscalYear} />
      <View style={styles.flex} {...swipeHandlers}>
        <SegmentedTabs
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
          accessibilityLabel="特別費か特別収入か"
          style={styles.kinds}
        />

        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <Hero
            label={income ? '年度に入った特別収入' : '年度に払った特別費'}
            value={formatYen(totals.actual)}
            note={
              remaining < 0
                ? `予算 ${formatYen(totals.budget)}・${formatYen(remaining)} 超過`
                : income
                  ? `予定 ${formatYen(totals.budget)}・まだ ${formatYen(remaining)}`
                  : `予算 ${formatYen(totals.budget)}・残り ${formatYen(remaining)}`
            }
          >
            <View style={styles.progress}>
              <ProgressBar ratio={totals.budget > 0 ? totals.actual / totals.budget : 0} over={!income && remaining < 0} />
              {pending > 0 && <Text style={type.faint}>まだ済にしていない予定 {pending}件</Text>}
            </View>
          </Hero>

          <SectionHeader
            title="予定と実績"
            hint="月ごと"
            right={
              <Pressable accessibilityRole="button" onPress={() => setAdding(true)} disabled={!familyId} hitSlop={8} style={styles.add}>
                <Plus size={14} color={colors.money} />
                <Text style={type.link}>項目を追加</Text>
              </Pressable>
            }
          />

          {isLoading ? (
            <Text style={styles.message}>読み込み中...</Text>
          ) : groups.length === 0 ? (
            <Text style={styles.message}>
              {hasAnything
                ? `${formatFiscalYear(fiscalYear)}の${income ? '特別収入' : '特別費'}はありません`
                : '年に数回の大きな出費や賞与を「項目を追加」で登録すると、年度ごとの予算と実績を見られます'}
            </Text>
          ) : (
            groups.map((group) => (
              <View key={group.month ?? 'none'} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupTitle}>{monthLabel(group.month)}</Text>
                  <Text style={type.faint}>
                    {formatYen(group.actual)} / {formatYen(group.budget)}
                  </Text>
                </View>
                <View style={styles.card}>
                  {group.rows.map((row, index) => {
                    const paid = row.actual !== null;
                    const over = isOverBudget(row);
                    const sub = [row.item.category, row.tentative ? '月は仮' : '', row.planId === null ? '予定外' : '']
                      .filter((text) => text !== '')
                      .join('・');
                    return (
                      <Pressable
                        key={row.key}
                        accessibilityRole="button"
                        onPress={() => setEditingRow({ row })}
                        style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                      >
                        {row.planId !== null ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={paid ? `${row.item.name}は済み。実績を直す` : `${row.item.name}を済にする`}
                            onPress={() => (paid ? setEditingRow({ row }) : void markPaid(row))}
                            hitSlop={6}
                            style={[styles.check, paid && styles.checkDone]}
                          >
                            {paid && <Check size={16} color={colors.primaryText} />}
                          </Pressable>
                        ) : (
                          <View style={[styles.check, styles.checkDone]}>
                            <Check size={16} color={colors.primaryText} />
                          </View>
                        )}
                        <View style={styles.flex}>
                          <Text style={[type.row, !paid && styles.pendingText]} numberOfLines={1}>
                            {row.item.name}
                          </Text>
                          {sub !== '' && <Text style={type.faint}>{sub}</Text>}
                        </View>
                        <View style={styles.rowRight}>
                          {paid ? (
                            <Text style={[type.amount, over && type.minus]}>{formatYen(row.actual!)}</Text>
                          ) : (
                            <Text style={[type.amount, styles.pendingText]}>{formatYen(row.budget)}</Text>
                          )}
                          <Text style={type.faint}>
                            {paid ? (row.planId !== null ? `予算 ${formatYen(row.budget)}` : '予定外') : 'まだ'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {editingRow !== null && (
        <SpecialActualSheet
          key={editingRow.row.key}
          row={editingRow.row}
          onClose={() => setEditingRow(null)}
          onSubmit={(draft) => void saveActual(editingRow.row, draft)}
          onClear={editingRow.row.actuals.length > 0 ? () => void clearActual(editingRow.row) : undefined}
          onEditItem={() => {
            const item = editingRow.row.item;
            setEditingRow(null);
            setEditingItem(item);
          }}
        />
      )}

      {(adding || editingItem !== null) && (
        <SpecialItemSheet
          key={editingItem === null ? 'new' : editingItem.id}
          item={editingItem}
          categories={categories}
          defaultKind={kind}
          fiscalYear={fiscalYear}
          onClose={() => {
            setEditingItem(null);
            onAddClose();
          }}
          onSubmit={(result) => void saveItem(result)}
          onDelete={editingItem === null ? undefined : () => void removeItem(editingItem.id)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  kinds: { marginHorizontal: 16, marginBottom: 6 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 96 },
  progress: { gap: 6, paddingTop: 8 },
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
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { borderColor: colors.money, backgroundColor: colors.money },
  pendingText: { color: colors.textMuted },
  rowRight: { alignItems: 'flex-end' },
});
