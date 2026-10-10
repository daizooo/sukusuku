'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';
import { useHokatsuVisible } from '@/lib/hokatsuVisibility';

// 保活（見学チェック）の入口。以前は育児タブの切り替えにあったが、見学のときしか
// 開かないので設定タブへ移した。見学が済んだら「表示する」を切って入口を隠せる。
// mobile版は `mobile/src/components/info/HokatsuSetting.tsx`。

interface HokatsuSettingProps {
  /** 保活の中身（HokatsuTab）。開いたときだけ描画する。 */
  children: ReactNode;
}

export default function HokatsuSetting({ children }: HokatsuSettingProps) {
  const [visible, setVisible] = useHokatsuVisible();
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => setVisible(!visible);

  return (
    <section className="bg-white rounded-2xl p-3.5 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2">
        <ClipboardCheck size={18} className="text-blue-500" />
        <h3 className="flex-1 font-extrabold text-gray-900">保活</h3>
        <span className="text-xs font-medium text-gray-500">表示する</span>
        <button
          type="button"
          onClick={toggle}
          aria-label="保活を表示"
          aria-pressed={visible}
          className={`w-11 h-6 rounded-full relative flex-none transition-colors ${
            visible ? 'bg-blue-500' : 'bg-gray-300'
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
              visible ? 'left-5.5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {visible && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="mt-2 pt-2 w-full border-t border-gray-100 flex items-center justify-between text-sm font-bold text-blue-600"
        >
          見学チェックリストを開く
          <ChevronRight size={18} className="text-gray-400" />
        </button>
      )}

      {isOpen && <HokatsuScreen onClose={() => setIsOpen(false)}>{children}</HokatsuScreen>}
    </section>
  );
}

/** 保活の画面。戻る操作（ブラウザの戻る・左上の矢印）で設定タブへ戻る。 */
function HokatsuScreen({ onClose, children }: { onClose: () => void; children: ReactNode }) {
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
