import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import type { SubsidyDraw } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadMyLotteryProfile, loadSubsidyDraws } from '@/lib/api/subsidyDraws';
import { remainingDraws } from '@/lib/subsidyLotteryUtils';
import MoreRow from '@/components/more/MoreRow';

const load = (familyId: string, userId: string) =>
  Promise.all([loadSubsidyDraws(supabase, familyId), loadMyLotteryProfile(supabase, userId)]);

/**
 * 福引チャンスの入口（docs/home.md §9）。その他タブの1行（以前は家計タブの＋ボタンの中）。
 * 今月あと何回引けるかを添える（開かなくても、引ける日が分かるように）。
 * Web版の `src/components/sukusuku/living/LotteryMoreRow.tsx` と同じ項目・文言。
 */
export default function LotteryMoreRow({ familyId, userId }: { familyId: string | null; userId: string }) {
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const apply = ([loadedDraws, profile]: Awaited<ReturnType<typeof load>>) => {
    setDraws(loadedDraws);
    setBirthMonth(profile.birthMonth);
    setIsLoaded(true);
  };

  // 開くたびに読み直す（福引の画面で引いて戻ってきたときも）。
  useFocusEffect(
    useCallback(() => {
      if (!familyId) return undefined;
      let isMounted = true;
      load(familyId, userId)
        .then((result) => {
          if (!isMounted) return;
          setDraws(result[0]);
          setBirthMonth(result[1].birthMonth);
          setIsLoaded(true);
        })
        .catch(() => {
          // 圏外ならバッジは出さず、入口だけ出す。
        });
      return () => {
        isMounted = false;
      };
    }, [familyId, userId]),
  );

  // パートナーの端末での変更に追いつかせる。
  useFamilyRefresh(['subsidy_draws', 'family_members'], () => {
    if (!familyId) return;
    void load(familyId, userId)
      .then(apply)
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const remaining = remainingDraws(draws, userId, new Date(), birthMonth);

  return (
    <MoreRow
      icon={<Ticket size={20} color={colors.livingLottery} />}
      tintSurface={colors.livingLotterySurface}
      title="福引チャンス"
      description="欲しいものが買ってもらえるかも…"
      badge={isLoaded ? (remaining > 0 ? `福引券 あと${remaining}回` : '今月の福引券は使いきり') : undefined}
      badgeTone={remaining > 0 ? 'ok' : 'plain'}
      onPress={() => router.push('/lottery')}
    />
  );
}
