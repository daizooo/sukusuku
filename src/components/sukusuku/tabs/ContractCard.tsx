'use client';

import type { Contract, ContractKind } from '@/types/app';
import { KIND_LABEL, amountText, renewalBadge, type RenewalTone } from '@/lib/contractUtils';

// 契約の一覧の1枚（docs/contracts.md §7.1）。種類・名称・（見せる相手が限られているときの錠前）、
// 会社・契約者・金額、更新日のバッジ。mobile版は `mobile/src/components/contracts/ContractCard.tsx`。

const KIND_CLASS: Record<ContractKind, string> = {
  rent: 'bg-blue-100 text-blue-700',
  insurance: 'bg-rose-100 text-rose-700',
  subscription: 'bg-violet-100 text-violet-700',
  other: 'bg-gray-100 text-gray-600',
};

const BADGE_CLASS: Record<RenewalTone, string> = {
  alert: 'bg-red-100 text-red-700',
  warn: 'bg-orange-100 text-orange-700',
  plain: 'bg-gray-100 text-gray-600',
};

interface ContractCardProps {
  contract: Contract;
  contractorName: string | null;
  today: string;
  onOpen: () => void;
}

export default function ContractCard({ contract, contractorName, today, onOpen }: ContractCardProps) {
  const badge = renewalBadge(contract.renewsOn, today);
  const meta = [contract.company, contractorName, amountText(contract)].filter((part): part is string => !!part);

  return (
    <button
      type="button"
      aria-label={`${contract.title}を開く`}
      onClick={onOpen}
      className={`w-full text-left grid gap-1 rounded-2xl border bg-white px-3 py-2.5 hover:bg-gray-50 transition ${
        badge?.overdue ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`rounded-md px-2 py-px text-[11px] font-extrabold ${KIND_CLASS[contract.kind]}`}>
          {KIND_LABEL[contract.kind]}
        </span>
        <span className="flex-1 min-w-0 text-[15px] font-bold text-gray-900 break-words">{contract.title}</span>
      </span>
      {meta.length > 0 && <span className="text-xs text-gray-500 tabular-nums">{meta.join(' ・ ')}</span>}
      {badge && (
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold tabular-nums ${BADGE_CLASS[badge.tone]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {badge.text}
        </span>
      )}
    </button>
  );
}
