'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadStockItems, loadStockPlan, loadStockTargets } from '@/lib/api/stockItems';
import MoreRow from '../tabs/MoreRow';
import { buildStockBoard, DEFAULT_STOCK_PLAN, type StockPlan } from '@/lib/stockUtils';

/**
 * 防災備蓄の入口（docs/home.md §2）。その他タブの1行（以前はリストタブの一覧の下）。
 * 押すと防災備蓄の画面（tabs/StockScreen）へ。期限切れ・不足・期限が近い・点検の時期のどれかがあるときだけ、
 * 赤いバッジで件数を添える（開かなくても気づけるように）。
 * mobile版の `mobile/src/components/living/StockEntryRow.tsx` と同じ項目・文言。
 */
export default function StockEntryRow({ familyId, onOpen }: { familyId: string; onOpen: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);

  const load = () =>
    Promise.all([loadStockItems(supabase, familyId), loadStockTargets(supabase, familyId), loadStockPlan(supabase, familyId)]);

  useEffect(() => {
    let isMounted = true;
    load()
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        if (!isMounted) return;
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 読めなければ件数は出さず、入口だけ出す。
      });
    return () => {
      isMounted = false;
    };
    // load は supabase と familyId だけで決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, familyId]);

  // パートナーの端末での変更に追いつかせる。計画（loadStockPlan）は families の列から読む。
  useFamilyRefresh(['stock_items', 'stock_targets', 'families'], () => {
    load()
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const { counts } = buildStockBoard(items, targets, plan, toDateStringInTimeZone(new Date()));
  const attention = counts.short + counts.expired + counts.soon + counts.inspect;

  return (
    <MoreRow
      icon={<ShieldCheck size={20} className="text-orange-600" />}
      tintClass="bg-orange-50"
      title="防災備蓄"
      description="期限・不足・持ち出しバッグ"
      badge={attention > 0 ? `要確認 ${attention}` : undefined}
      badgeTone="alert"
      onClick={onOpen}
    />
  );
}
