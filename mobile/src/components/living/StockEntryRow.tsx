import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, ShieldCheck } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadStockItems, loadStockPlan, loadStockTargets } from '@/lib/api/stockItems';
import { buildStockBoard, DEFAULT_STOCK_PLAN, type StockPlan } from '@/lib/stockUtils';

/**
 * 防災備蓄の入口（docs/home.md §2）。リストタブの一覧の下に置く、目立たせない細い1行。
 * 押すと防災備蓄の画面（app/stock.tsx）へ。期限切れ・不足・期限が近い・点検の時期のどれかがあるときだけ、
 * 赤い点と件数を添える（開かなくても気づけるように）。
 * Web版の `src/components/sukusuku/living/StockEntryRow.tsx` と同じ項目・文言。
 */
export default function StockEntryRow({ familyId }: { familyId: string | null }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);

  const load = (id: string) =>
    Promise.all([loadStockItems(supabase, id), loadStockTargets(supabase, id), loadStockPlan(supabase, id)]);

  useEffect(() => {
    if (!familyId) return;
    let isMounted = true;
    load(familyId)
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        if (!isMounted) return;
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 圏外なら件数は出さず、入口だけ出す。
      });
    return () => {
      isMounted = false;
    };
  }, [familyId]);

  // パートナーの端末での変更に追いつかせる。計画（loadStockPlan）は families の列から読む。
  useFamilyRefresh(['stock_items', 'stock_targets', 'families'], () => {
    if (!familyId) return;
    void load(familyId)
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const { counts } = buildStockBoard(items, targets, plan, toDateString(new Date()));
  const attention = counts.short + counts.expired + counts.soon + counts.inspect;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={attention > 0 ? `防災備蓄（要確認 ${attention}件）` : '防災備蓄'}
      onPress={() => router.push('/stock')}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <ShieldCheck size={15} color={colors.textFaint} />
      <Text style={styles.label}>防災備蓄</Text>
      {attention > 0 && (
        <View style={styles.attention}>
          <View style={styles.dot} />
          <Text style={styles.attentionText}>要確認 {attention}</Text>
        </View>
      )}
      <View style={styles.spacer} />
      <ChevronRight size={16} color={colors.borderStrong} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.background },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  attention: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.alertText },
  attentionText: { fontSize: 11, fontWeight: '600', color: colors.alertText },
  spacer: { flex: 1 },
});
