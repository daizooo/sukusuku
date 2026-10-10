'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadStockItems, loadStockPlan, loadStockTargets } from '@/lib/api/stockItems';
import { buildStockBoard, DEFAULT_STOCK_PLAN, type StockPlan } from '@/lib/stockUtils';

/**
 * 防災備蓄の入口（docs/home.md §2）。リストタブの一覧の下に置く、目立たせない細い1行。
 * 押すと防災備蓄の画面（tabs/StockScreen）へ。期限切れ・不足・期限が近い・点検の時期のどれかがあるときだけ、
 * 赤い点と件数を添える（開かなくても気づけるように）。
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
    <button
      type="button"
      aria-label={attention > 0 ? `防災備蓄（要確認 ${attention}件）` : '防災備蓄'}
      onClick={onOpen}
      className="shrink-0 mt-2 flex w-full items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50 transition"
    >
      <ShieldCheck size={15} className="text-gray-400" />
      <span className="text-xs font-semibold text-gray-500">防災備蓄</span>
      {attention > 0 && (
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-700">
          <span className="h-[7px] w-[7px] rounded-full bg-red-700" />
          要確認 {attention}
        </span>
      )}
      <span className="flex-1" />
      <ChevronRight size={16} className="text-gray-300" />
    </button>
  );
}
