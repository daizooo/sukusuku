'use client';

import { ChevronLeft, FileText } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';

/**
 * 契約の画面（賃貸・保険など）。その他タブの「契約」の行から開く。
 * いまは入口だけで、中身（項目・更新日の知らせ）はこれから作る（docs/family-app.md §4.5）。
 * mobile版の `mobile/app/contracts.tsx` と同じ項目・文言。
 */
export default function ContractsScreen({ onClose }: { onClose: () => void }) {
  // 戻る操作（ブラウザの戻る）は、その他タブへ戻す。
  useBackLayer(onClose);

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center pb-2">
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
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center">
        <FileText size={32} className="text-gray-400" />
        <p className="text-base font-bold text-gray-700">準備中です</p>
        <p className="text-[13px] text-gray-500">賃貸や保険などの契約を、更新日の知らせつきで控えられるようにします。</p>
      </div>
    </div>
  );
}
