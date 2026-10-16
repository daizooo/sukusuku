'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Store, Trash2 } from 'lucide-react';
import type { MoneyRecordKind, MoneyWallet } from '@/types/app';
import { formatDateWithYear } from '@/lib/dateUtils';
import { formatYen, type EditorGroup } from '@/lib/moneyUtils';
import RecordItemGroups from './RecordItemGroups';
import { NextPeriodBadge, PrimaryButton, ScreenHeader, WalletTypeIcon, incomeAmountClass } from './moneyVisual';

// 記録の詳細（読むだけ。docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/RecordDetailView.tsx` と同じ並び・文言。
// 既にある記録を開くと、まずこれを見せる（2026-10-15。Zaim と同じ）。直すときは下の「編集する」か、日付・金額・出金元・お店・品目のどこかを押して入力画面（RecordEditor）へ。
// 日付を中央、金額を一番大きく、出金元とお店はアイコンつきの2行、その下に品目一覧（カテゴリごとに内訳。RecordItemGroups）。

interface RecordDetailViewProps {
  kind: MoneyRecordKind;
  occurredOn: string;
  total: number;
  wallet: MoneyWallet | null;
  /** 振替の入金先。 */
  toWallet: MoneyWallet | null;
  store: string;
  /** カードの引き落としを翌月分に回してある。出金元の行に「翌月払い」の札で出す。 */
  cardNextPeriod: boolean;
  groups: EditorGroup[];
  groupTitle: (group: EditorGroup) => string;
  groupIconKey: (group: EditorGroup) => string;
  /** 日付の上の案内（見込み・自動で作った記録）。無ければ null。 */
  notice: ReactNode;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

const rowClass = 'flex items-center gap-4 py-2';
const iconClass = 'flex w-6 shrink-0 justify-center';
const textClass = 'min-w-0 flex-1 truncate text-base font-bold text-gray-900';

export default function RecordDetailView({
  kind,
  occurredOn,
  total,
  wallet,
  toWallet,
  store,
  cardNextPeriod,
  groups,
  groupTitle,
  groupIconKey,
  notice,
  onClose,
  onDelete,
  onEdit,
}: RecordDetailViewProps) {
  return (
    <>
      <ScreenHeader
        title="記録の詳細"
        icon="back"
        onClose={onClose}
        right={
          <button type="button" aria-label="この記録を消す" onClick={onDelete} className="text-gray-500">
            <Trash2 size={20} />
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-4">
        {notice}
        {/* 日付・金額・出金元・お店・品目のどこを押しても編集画面へ（2026-10-16）。 */}
        <div
          role="button"
          tabIndex={0}
          aria-label="この記録を編集する"
          onClick={onEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onEdit();
            }
          }}
          className="cursor-pointer"
        >
          <p className="mt-3.5 text-center text-[15px] font-bold text-gray-700">{formatDateWithYear(new Date(`${occurredOn}T00:00:00`))}</p>
          <p
            className={`mt-1.5 text-center text-[42px] font-extrabold tabular-nums ${
              kind === 'income' ? incomeAmountClass : kind === 'transfer' ? 'text-gray-500' : 'text-gray-900'
            }`}
          >
            {formatYen(total)}
          </p>
          <div className="mt-3.5">
            <div className={rowClass}>
              <span className={iconClass}>{wallet && <WalletTypeIcon type={wallet.type} size={22} color={wallet.iconColor} />}</span>
              <span className={textClass}>{wallet?.name ?? '出金元なし'}</span>
              {cardNextPeriod && <NextPeriodBadge />}
            </div>
            {kind === 'transfer' ? (
              <div className={rowClass}>
                <span className={iconClass}>
                  <ArrowRight size={20} className="text-gray-500" />
                </span>
                <span className={textClass}>{toWallet?.name ?? '入金先なし'}</span>
              </div>
            ) : (
              store !== '' && (
                <div className={rowClass}>
                  <span className={iconClass}>
                    <Store size={20} className="text-gray-500" />
                  </span>
                  <span className={textClass}>{store}</span>
                </div>
              )
            )}
          </div>
          {kind !== 'transfer' && groups.length > 0 && (
            <>
              <p className="mt-3 mb-0.5 text-center text-[13px] font-bold text-gray-500">品目一覧</p>
              <RecordItemGroups groups={groups} title={groupTitle} iconKey={groupIconKey} size="large" />
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-gray-200 px-4 pt-2.5 pb-4">
        <PrimaryButton label="編集する" onClick={onEdit} />
      </div>
    </>
  );
}
