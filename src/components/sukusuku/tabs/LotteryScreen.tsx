'use client';

import { ChevronLeft, Ticket } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';
import LotteryPanel from '../living/LotteryPanel';

/**
 * 福引チャンスの画面（docs/home.md §9）。家計タブの帯の右端のチケットから開く
 * （以前は暮らしタブのメニュー。2026-10-10に暮らしタブを廃止）。戻る操作（ブラウザの戻る・左上の矢印）で
 * 家計タブへ戻る。mobile版の `mobile/app/lottery.tsx` と同じ項目・並び・文言。
 */
export default function LotteryScreen({
  familyId,
  userId,
  onClose,
}: {
  familyId: string;
  userId: string;
  onClose: () => void;
}) {
  // 戻る操作（ブラウザの戻る）は、家計タブへ戻す。
  useBackLayer(onClose);

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
          <Ticket size={20} className="text-purple-600" />
          <h2 className="text-lg font-bold text-gray-900">福引チャンス</h2>
        </button>
      </div>
      <LotteryPanel familyId={familyId} userId={userId} />
    </div>
  );
}
