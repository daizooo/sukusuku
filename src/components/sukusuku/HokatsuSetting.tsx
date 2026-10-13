'use client';

import { ClipboardCheck } from 'lucide-react';
import { useHokatsuVisible } from '@/lib/hokatsuVisibility';

// 保活（見学チェック）の入口をその他タブに出すかどうかの切り替え。保活は見学のときしか
// 開かないので、見学が済んだら「表示する」を切って入口を隠せる。保活の画面への入口そのものは
// その他タブの「保活」の行（tabs/InfoTab.tsx）。
// mobile版は `mobile/src/components/info/HokatsuSetting.tsx`。

export default function HokatsuSetting() {
  const [visible, setVisible] = useHokatsuVisible();

  return (
    <section className="bg-white rounded-2xl p-3.5 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2">
        <ClipboardCheck size={18} className="text-blue-500" />
        <h3 className="flex-1 font-extrabold text-gray-900">保活</h3>
        <span className="text-xs font-medium text-gray-500">表示する</span>
        <button
          type="button"
          onClick={() => setVisible(!visible)}
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
      <p className="mt-2 text-xs text-gray-500">見学が済んだら切ると、その他タブから保活の行が消えます。</p>
    </section>
  );
}
