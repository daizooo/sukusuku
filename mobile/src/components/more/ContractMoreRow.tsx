import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FileText } from 'lucide-react-native';
import type { Contract } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadContracts } from '@/lib/api/contracts';
import { nearestRenewal } from '@/lib/contractUtils';
import MoreRow from '@/components/more/MoreRow';

/**
 * 契約の入口（docs/contracts.md §7）。その他タブの1行。いちばん急ぐ更新日をバッジで添える
 * （開かなくても、更新の時期に気づけるように）。見える契約だけが数えられる（DB のポリシー）。
 * Web版の `src/components/sukusuku/living/ContractMoreRow.tsx` と同じ項目・文言。
 */
export default function ContractMoreRow({ familyId }: { familyId: string | null }) {
  const [contracts, setContracts] = useState<Contract[]>([]);

  // 開くたびに読み直す（契約の画面で直して戻ってきたときも）。
  useFocusEffect(
    useCallback(() => {
      if (!familyId) return undefined;
      let isMounted = true;
      loadContracts(supabase, familyId)
        .then((loaded) => {
          if (isMounted) setContracts(loaded);
        })
        .catch(() => {
          // 圏外ならバッジは出さず、入口だけ出す。
        });
      return () => {
        isMounted = false;
      };
    }, [familyId]),
  );

  // パートナーの端末での変更に追いつかせる。
  useFamilyRefresh(['contracts'], () => {
    if (!familyId) return;
    void loadContracts(supabase, familyId)
      .then(setContracts)
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const renewal = nearestRenewal(contracts, toDateString(new Date()));

  return (
    <MoreRow
      icon={<FileText size={20} color={colors.contract} />}
      tintSurface={colors.contractSurface}
      title="契約"
      description="賃貸・保険・サブスクなど"
      badge={renewal?.text}
      badgeTone={renewal?.tone === 'alert' ? 'alert' : renewal?.tone === 'warn' ? 'warn' : 'plain'}
      onPress={() => router.push('/contracts')}
    />
  );
}
