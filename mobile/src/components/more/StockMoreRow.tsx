import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import MoreRow from '@/components/more/MoreRow';
import { toDateString } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadStockItems, loadStockPlan, loadStockTargets } from '@/lib/api/stockItems';
import { buildStockBoard, DEFAULT_STOCK_PLAN, type StockPlan } from '@/lib/stockUtils';

const load = (id: string) =>
  Promise.all([loadStockItems(supabase, id), loadStockTargets(supabase, id), loadStockPlan(supabase, id)]);

/**
 * 防災備蓄の入口（docs/home.md §2）。その他タブの1行（以前はリストタブの一覧の下）。
 * 押すと防災備蓄の画面（app/stock.tsx）へ。期限切れ・不足・期限が近い・点検の時期のどれかがあるときだけ、
 * 赤いバッジで件数を添える（開かなくても気づけるように）。
 * Web版の `src/components/sukusuku/living/StockEntryRow.tsx` と同じ項目・文言。
 */
export default function StockMoreRow({ familyId }: { familyId: string | null }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);

  // 開くたびに読み直す（備蓄の画面で直して戻ってきたときも）。
  useFocusEffect(
    useCallback(() => {
      if (!familyId) return undefined;
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
    }, [familyId]),
  );

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
    <MoreRow
      icon={<ShieldCheck size={20} color={colors.livingStock} />}
      tintSurface={colors.livingStockSurface}
      title="防災備蓄"
      description="期限・不足・持ち出しバッグ"
      badge={attention > 0 ? `要確認 ${attention}` : undefined}
      badgeTone="alert"
      onPress={() => router.push('/stock')}
    />
  );
}
