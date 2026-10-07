import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import type { SpecialActual, SpecialActualDraft, SpecialItem, SpecialKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
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
import { formatPrice } from '@/lib/shoppingUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import SpecialItemSheet, { type SpecialItemSheetResult } from '@/components/living/SpecialItemSheet';
import SpecialActualSheet from '@/components/living/SpecialActualSheet';

// 特別費の予定と実績（docs/home.md §5.4）。家計タブの「年」の、年度の収支の下に置く（docs/kakei.md §4.2）。
// 年度は「年」の画面で選んだもの。スクロールも「年」の画面に任せる（ここは中身だけ）。
// PWA版の `src/components/sukusuku/living/SpecialPanel.tsx` と同じ項目・並び・文言。
//
// 実績は家計の記録の品目（docs/kakei.md §3.2）。「済」は品目1つの記録を作り、家計タブの記録にも出る。
//
// 年度（4月〜翌3月）ごとに、特別費（支出）と特別収入（賞与など）の「予算・実績・差異」を見る。
// 一覧は月ごと（4月→3月）で、1行＝予定1回ぶん（または予定外の出費1件）。
// 予定の行の右の「済」を1回押すと、予算の額・今日の日付で実績になる（額が違えば行を押して直す）。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '特別費（支出）' },
  { id: 'income', label: '特別収入' },
];

/** 年度の合計に出す「差異」。支出は予算−実績（あと使える額）、収入は予算−実績（まだ入っていない額）。 */
const signed = (value: number) => `${value < 0 ? '−' : ''}${formatPrice(Math.abs(value))}`;

type EditingRow = { row: SpecialRow } | null;
type EditingItem = SpecialItem | null;

interface SpecialPanelProps {
  familyId: string | null;
  /** 年度（4月始まり）。「年」の画面で選ぶ。 */
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
  // 収入と支出の差引（予算どおり・実績どおり）。
  const balance = useMemo(() => {
    const income = yearTotals(buildYearRows(items, actuals, fiscalYear, 'income'));
    const expense = yearTotals(buildYearRows(items, actuals, fiscalYear, 'expense'));
    return { budget: income.budget - expense.budget, actual: income.actual - expense.actual };
  }, [items, actuals, fiscalYear]);
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

  return (
    <>
      <View style={styles.head}>
        <Text style={styles.headTitle}>特別費</Text>
        <Text style={styles.headHint}>{formatFiscalYear(fiscalYear)}の予定と実績</Text>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setAdding(true)}
          disabled={!familyId}
          style={styles.addItem}
        >
          <Plus size={14} color={colors.livingSpecial} />
          <Text style={styles.addItemText}>項目を追加</Text>
        </Pressable>
      </View>

      <SegmentedTabs
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        accessibilityLabel="特別費か特別収入か"
        style={styles.kinds}
      />

      <View style={styles.totals}>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>予算</Text>
          <Text style={styles.totalValue}>{formatPrice(totals.budget)}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>実績</Text>
          <Text style={styles.totalValue}>{formatPrice(totals.actual)}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>差異</Text>
          <Text style={[styles.totalValue, totals.diff < 0 && kind === 'expense' && styles.over]}>
            {signed(totals.diff)}
          </Text>
        </View>
      </View>
      {hasAnything && (
        <Text style={styles.balance}>
          収入 − 支出　予算 {signed(balance.budget)} ／ 実績 {signed(balance.actual)}
        </Text>
      )}

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.message}>
            {hasAnything
              ? `${formatFiscalYear(fiscalYear)}の${kind === 'expense' ? '特別費' : '特別収入'}はありません`
              : '年に数回の大きな出費や賞与を「項目を追加」で登録すると、年度ごとの予算と実績を見られます'}
          </Text>
        </View>
      ) : (
        <View style={styles.listContent}>
          {groups.map((group) => (
            <View key={group.month ?? 'none'} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{monthLabel(group.month)}</Text>
                <Text style={styles.groupSum}>
                  予算 {formatPrice(group.budget)} ／ 実績 {formatPrice(group.actual)}
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
                      style={[styles.row, index > 0 && styles.rowDivided, !paid && styles.rowPending]}
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
                        <Text style={styles.name}>{row.item.name}</Text>
                        {sub !== '' && <Text style={styles.sub}>{sub}</Text>}
                      </View>
                      <View style={styles.rowRight}>
                        {row.planId !== null && <Text style={styles.budget}>予算 {formatPrice(row.budget)}</Text>}
                        {paid ? (
                          <Text style={[styles.actual, over && styles.over]}>実績 {formatPrice(row.actual!)}</Text>
                        ) : (
                          <Text style={styles.unpaid}>未</Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

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
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  headTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  headHint: { fontSize: 12, fontWeight: '500', color: colors.textFaint },
  addItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.livingSpecialSurface,
  },
  addItemText: { fontSize: 12, fontWeight: '700', color: colors.livingSpecial },
  kinds: { marginHorizontal: 16, marginBottom: 8 },
  totals: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 8,
  },
  totalCell: { flex: 1, alignItems: 'center' },
  totalLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  totalValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  balance: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  group: { marginBottom: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 4 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  groupSum: { fontSize: 11, fontWeight: '500', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPending: { opacity: 0.85 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { borderColor: colors.livingSpecial, backgroundColor: colors.livingSpecial },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  budget: { fontSize: 11, fontWeight: '500', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  actual: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'], marginTop: 2 },
  unpaid: { fontSize: 12, fontWeight: '700', color: colors.textFaint, marginTop: 2 },
  over: { color: colors.alertText },
});
