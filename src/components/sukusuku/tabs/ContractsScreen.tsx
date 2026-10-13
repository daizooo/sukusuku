'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FileText, Plus } from 'lucide-react';
import type { Contract, ContractDraft, ContractKind, Member } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { useBackLayer } from '@/lib/browserHistory';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useFamilyRefresh } from '@/lib/familySync';
import { listMembers } from '@/lib/api/members';
import { deleteContract, insertContract, loadContracts, setContractRenewal, updateContract } from '@/lib/api/contracts';
import {
  CONTRACT_KINDS,
  KIND_LABEL,
  annualTotal,
  formatYen,
  sortContracts,
} from '@/lib/contractUtils';
import ContractModal from '../modals/ContractModal';
import ContractCard from './ContractCard';

/**
 * 契約の画面（賃貸・保険・サブスクなど。docs/contracts.md §7.1）。その他タブの「契約」の行から開く。
 * 戻る操作（ブラウザの戻る・左上の矢印）でその他タブへ戻る。mobile版の `mobile/app/contracts.tsx` と同じ項目・並び・文言。
 *
 * 見出し・年間の目安・絞り込みは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 一覧は更新日の近い順（過ぎたものが先）。見えるのは、見せる相手に選ばれた契約だけ（DB のポリシー）。
 */

type Filter = 'all' | ContractKind;

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = Contract | 'new' | null;

export default function ContractsScreen({
  familyId,
  userId,
  onClose,
}: {
  familyId: string;
  userId: string;
  onClose: () => void;
}) {
  // 戻る操作（ブラウザの戻る）は、その他タブへ戻す。
  useBackLayer(onClose);

  const supabase = useMemo(() => createClient(), []);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([loadContracts(supabase, familyId), listMembers(supabase, familyId)]);

  useEffect(() => {
    let isMounted = true;
    load()
      .then(([loadedContracts, loadedMembers]) => {
        if (!isMounted) return;
        setContracts(loadedContracts);
        setMembers(loadedMembers);
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
    // load は supabase と familyId だけで決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, familyId]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  useFamilyRefresh(['contracts', 'contract_fields', 'family_members'], () => {
    load()
      .then(([loadedContracts, loadedMembers]) => {
        setContracts(loadedContracts);
        setMembers(loadedMembers);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const today = toDateStringInTimeZone(new Date());
  const myMemberId = members.find((member) => member.userId === userId)?.id ?? null;
  const memberName = (id: string | null) => members.find((member) => member.id === id)?.displayName ?? null;

  const sorted = useMemo(() => sortContracts(contracts), [contracts]);
  const shown = filter === 'all' ? sorted : sorted.filter((contract) => contract.kind === filter);
  const total = useMemo(() => annualTotal(contracts), [contracts]);
  const countOf = (kind: Filter) =>
    kind === 'all' ? contracts.length : contracts.filter((contract) => contract.kind === kind).length;

  const failed = (what: string) => setError(`${what}できませんでした。もう一度お試しください。`);

  const save = async (draft: ContractDraft) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    setError(null);
    try {
      if (target === 'new') {
        const created = await insertContract(supabase, familyId, userId, draft);
        setContracts((prev) => [...prev, created]);
      } else {
        const updated = await updateContract(supabase, target.id, draft);
        setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    setEditing(null);
    setError(null);
    const previous = contracts;
    setContracts((prev) => prev.filter((contract) => contract.id !== id));
    try {
      await deleteContract(supabase, id);
    } catch {
      setContracts(previous);
      failed('削除');
    }
  };

  /** 「更新した」。更新日だけを進める。開いているモーダルは閉じない。 */
  const renew = async (id: string, renewsOn: string) => {
    setError(null);
    try {
      const updated = await setContractRenewal(supabase, id, renewsOn);
      setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)));
    } catch {
      failed('更新');
    }
  };

  const filters: Filter[] = ['all', ...CONTRACT_KINDS];

  return (
    <div className="relative p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onClose}
          className="flex items-center gap-1.5 -ml-1 rounded-lg py-1 pr-2 hover:bg-gray-100 transition"
        >
          <ChevronLeft size={22} className="text-gray-500" />
          <FileText size={20} className="text-teal-600" />
          <h2 className="text-lg font-bold text-gray-900">契約</h2>
        </button>
        <button
          type="button"
          aria-label="契約を追加"
          onClick={() => setEditing('new')}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-teal-600 hover:bg-teal-100 transition"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="shrink-0 mb-2 flex items-center justify-between rounded-2xl border border-teal-200 bg-teal-50 px-3.5 py-2.5">
        <div>
          <p className="text-[11px] font-bold text-teal-600">年間の目安</p>
          <p className="text-[11px] text-gray-500">見えている契約の合計</p>
        </div>
        <p className="text-[22px] font-extrabold text-teal-800 tabular-nums">{formatYen(total)}</p>
      </div>

      <div className="shrink-0 mb-2 flex gap-1.5 overflow-x-auto">
        {filters.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
            className={`flex-none rounded-full border px-3 py-1 text-xs font-bold tabular-nums transition ${
              filter === kind
                ? 'border-teal-600 bg-teal-600 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {kind === 'all' ? 'すべて' : KIND_LABEL[kind]} {countOf(kind)}
          </button>
        ))}
      </div>

      {error && <p className="shrink-0 pb-2 text-xs text-red-500">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : shown.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <FileText size={32} className="text-gray-400" />
          <p className="text-base font-bold text-gray-700">
            {contracts.length === 0 ? 'まだ契約がありません' : 'この種類の契約はありません'}
          </p>
          <p className="text-[13px] text-gray-500">
            賃貸・保険・サブスクなどを控えると、更新日が近いときに知らせます。右上の＋から追加できます。
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2 pb-6">
            {shown.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                contractorName={memberName(contract.contractorId)}
                today={today}
                onOpen={() => setEditing(contract)}
              />
            ))}
          </div>
        </div>
      )}

      {editing !== null && (
        <ContractModal
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          contract={editing === 'new' ? null : editing}
          members={members}
          myMemberId={myMemberId}
          today={today}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
          onRenew={editing === 'new' ? undefined : (renewsOn) => void renew(editing.id, renewsOn)}
        />
      )}
    </div>
  );
}
