'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Contract } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { loadContracts } from '@/lib/api/contracts';
import { nearestRenewal } from '@/lib/contractUtils';
import MoreRow from '../tabs/MoreRow';

/**
 * 契約の入口（docs/contracts.md §7）。その他タブの1行。いちばん急ぐ更新日をバッジで添える
 * （開かなくても、更新の時期に気づけるように）。見える契約だけが数えられる（DB のポリシー）。
 * mobile版の `mobile/src/components/more/ContractMoreRow.tsx` と同じ項目・文言。
 */
export default function ContractMoreRow({ familyId, onOpen }: { familyId: string; onOpen: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [contracts, setContracts] = useState<Contract[]>([]);

  useEffect(() => {
    let isMounted = true;
    loadContracts(supabase, familyId)
      .then((loaded) => {
        if (isMounted) setContracts(loaded);
      })
      .catch(() => {
        // 読めなければバッジは出さず、入口だけ出す。
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

  // パートナーの端末での変更に追いつかせる。
  useFamilyRefresh(['contracts'], () => {
    loadContracts(supabase, familyId)
      .then(setContracts)
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const renewal = nearestRenewal(contracts, toDateStringInTimeZone(new Date()));

  return (
    <MoreRow
      icon={<FileText size={20} className="text-teal-600" />}
      tintClass="bg-teal-50"
      title="契約"
      description="賃貸・保険・サブスクなど"
      badge={renewal?.text}
      badgeTone={renewal?.tone === 'alert' ? 'alert' : renewal?.tone === 'warn' ? 'warn' : 'plain'}
      onClick={onOpen}
    />
  );
}
