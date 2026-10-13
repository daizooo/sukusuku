'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';

/**
 * 保活（見学チェック）の画面。その他タブの「保活」の行から開く（以前は設定タブの中の HokatsuSetting が開いていた）。
 * 戻る操作（ブラウザの戻る・左上の矢印）でその他タブへ戻る。
 * mobile版は `mobile/app/nursery.tsx`。
 */
export default function HokatsuScreen({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useBackLayer(onClose);

  return (
    <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="戻る"
          className="p-1 text-blue-500 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronLeft size={24} />
        </button>
        <h2 className="font-bold text-gray-900">保活</h2>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
