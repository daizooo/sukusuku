import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Pencil } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  NO_CATEGORY,
  spanText,
  type buildStockBoard,
  type StockPlan,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { Ring, SOFT, StockIcon, TONE } from './stockVisual';

// 持ち出しバッグの点検（docs/home.md §10.2.2）。一覧の上の「バッグ」と、「確認が必要なもの」の
// 「確かめる」から開く。PWA版の `src/components/sukusuku/living/StockBagCheck.tsx` と同じ項目・文言。
// 中身を押して確かめ（チェックはこの画面の中だけ）、全部確かめたら「点検完了」で今日の日付を残す。

type Board = ReturnType<typeof buildStockBoard<StockItem, StockTarget>>;

interface StockBagCheckProps {
  board: Board;
  items: StockItem[];
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditItem: (item: StockItem) => void;
  /** 点検した日（今日）を、バッグのロットにまとめて記録する。 */
  onInspect: (items: StockItem[]) => void;
}

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

export default function StockBagCheck({ board, items, plan, today, onClose, onEditItem, onInspect }: StockBagCheckProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const bag = board.attention.bag;
  const bagDue = bag?.due === true;
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const doneCount = bagLots.filter((item) => checked.has(item.id)).length;
  const allChecked = bagLots.length > 0 && doneCount === bagLots.length;
  const shortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);
  const byCategory = bagLots.reduce<Record<string, StockItem[]>>((groups, item) => {
    const key = item.category.trim() || NO_CATEGORY;
    (groups[key] ??= []).push(item);
    return groups;
  }, {});
  const age = bag?.lastOn ? `${spanText(daysBetween(bag.lastOn, today))}前に点検` : 'まだ点検していません';

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="持ち出しバッグ"
        onClose={onClose}
        footer={
          <Pressable
            accessibilityRole="button"
            disabled={!allChecked}
            onPress={() => {
              onInspect(bagLots);
              onClose();
            }}
            style={[styles.finish, allChecked && styles.finishOn]}
          >
            <Text style={[styles.finishText, allChecked && { color: SOFT.buttonText }]}>
              {bagLots.length === 0
                ? 'バッグは空です'
                : allChecked
                  ? '点検完了（今日の日付を残す）'
                  : `あと${bagLots.length - doneCount}つ確かめましょう`}
            </Text>
          </Pressable>
        }
      >
        <View style={styles.head}>
          <Ring size={44} stroke={5} ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length} color={TONE.accent}>
            <Text style={styles.ringValue}>
              {doneCount}/{bagLots.length}
            </Text>
          </Ring>
          <View style={styles.flex}>
            <Text style={styles.title}>{plan.carryDays}日分のバッグ</Text>
            <Text style={[styles.age, bagDue && styles.alertText]}>
              {bag ? `${age}${bagDue ? '・点検の時期です' : `・次は ${dateText(bag.nextOn)} ごろ`}` : 'バッグは空です'}
            </Text>
          </View>
        </View>

        {shortages.length > 0 && (
          <View style={styles.pills}>
            <Text style={styles.shortLabel}>足りない</Text>
            {shortages.map(({ status }) => (
              <View key={status.target.id} style={styles.pill}>
                <Text style={styles.pillText}>
                  {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
                  {status.target.unit}
                </Text>
              </View>
            ))}
          </View>
        )}

        {bagLots.length === 0 ? (
          <Text style={styles.empty}>持ち出しバッグには何も入っていません</Text>
        ) : (
          Object.entries(byCategory).map(([name, rows]) => (
            <View key={name} style={styles.section}>
              <View style={styles.categoryHeader}>
                <View style={styles.categoryIcon}>
                  <StockIcon name={name} size={11} color={SOFT.icon} />
                </View>
                <Text style={styles.categoryName}>{name}</Text>
              </View>
              <View style={styles.card}>
                {rows.map((item, index) => {
                  const on = checked.has(item.id);
                  const level = expiryLevel(item.expiresOn, today);
                  const alert = level === 'expired' || level === 'soon';
                  return (
                    <View key={item.id} style={[styles.row, index > 0 && styles.divided, on && styles.rowOn]}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${item.name}を確かめた`}
                        onPress={() => toggle(item.id)}
                        style={styles.main}
                      >
                        <View style={[styles.circle, on && styles.circleOn]}>
                          {on && <Check size={14} color={SOFT.buttonText} strokeWidth={3} />}
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.name}>{item.name}</Text>
                          {item.expiresOn && (
                            <Text style={[styles.note, alert && styles.alertText]}>{expiryCountdown(item.expiresOn, today)}</Text>
                          )}
                        </View>
                        <Text style={styles.quantity}>
                          {formatQuantity(item.quantity)}
                          <Text style={styles.unit}> {item.unit}</Text>
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.name}を編集`}
                        onPress={() => onEditItem(item)}
                        hitSlop={6}
                        style={styles.edit}
                      >
                        <Pencil size={12} color={colors.textFaint} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ringValue: { fontSize: 11, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  age: { fontSize: 11, fontWeight: '700', color: colors.textFaint, marginTop: 1 },
  alertText: { color: colors.alertText },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  shortLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  pill: { borderRadius: 999, backgroundColor: colors.dangerSurface, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.alertText, fontVariant: ['tabular-nums'] },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  section: { gap: 4 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.button },
  categoryName: { fontSize: 13, fontWeight: '700', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowOn: { backgroundColor: SOFT.bg },
  divided: { borderTopWidth: 1, borderTopColor: colors.neutralSurface },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  circleOn: { borderColor: SOFT.border, backgroundColor: SOFT.button },
  name: { fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 17 },
  note: { fontSize: 10, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  quantity: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 10, fontWeight: '700', color: colors.textFaint },
  edit: { paddingHorizontal: 10, paddingVertical: 8 },
  finish: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  finishOn: { backgroundColor: SOFT.button },
  finishText: { fontSize: 14, fontWeight: '700', color: colors.textFaint },
});
