'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ticket } from 'lucide-react';
import type { SubsidyDraw } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadMyLotteryProfile, loadSubsidyDraws } from '@/lib/api/subsidyDraws';
import { remainingDraws } from '@/lib/subsidyLotteryUtils';
import MoreRow from '../tabs/MoreRow';

/**
 * 福引チャンスの入口（docs/home.md §9）。その他タブの1行（以前は家計タブの＋ボタンの中）。
 * 今月あと何回引けるかを添える（開かなくても、引ける日が分かるように）。
 * mobile版の `mobile/src/components/more/LotteryMoreRow.tsx` と同じ項目・文言。
 */
export default function LotteryMoreRow({
  familyId,
  userId,
  onOpen,
}: {
  familyId: string;
  userId: string;
  onOpen: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const load = () => Promise.all([loadSubsidyDraws(supabase, familyId), loadMyLotteryProfile(supabase, userId)]);

  useEffect(() => {
    let isMounted = true;
    load()
      .then(([loadedDraws, profile]) => {
        if (!isMounted) return;
        setDraws(loadedDraws);
        setBirthMonth(profile.birthMonth);
        setIsLoaded(true);
      })
      .catch(() => {
        // 読めなければバッジは出さず、入口だけ出す。
      });
    return () => {
      isMounted = false;
    };
    // load は supabase・familyId・userId だけで決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, familyId, userId]);

  // パートナーの端末での変更に追いつかせる。誕生月は family_members から読む。
  useFamilyRefresh(['subsidy_draws', 'family_members'], () => {
    load()
      .then(([loadedDraws, profile]) => {
        setDraws(loadedDraws);
        setBirthMonth(profile.birthMonth);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const remaining = remainingDraws(draws, userId, new Date(), birthMonth);

  return (
    <MoreRow
      icon={<Ticket size={20} className="text-purple-600" />}
      tintClass="bg-purple-50"
      title="福引チャンス"
      description="欲しいものが買ってもらえるかも…"
      badge={isLoaded ? (remaining > 0 ? `福引券 あと${remaining}回` : '今月の福引券は使いきり') : undefined}
      badgeTone={remaining > 0 ? 'ok' : 'plain'}
      onClick={onOpen}
    />
  );
}
