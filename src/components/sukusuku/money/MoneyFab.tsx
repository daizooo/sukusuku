'use client';

import { Plus, Settings } from 'lucide-react';

// 家計タブ右下の、大きな丸い＋と、その上の小さな丸い設定のボタン（docs/kakei.md §2）。mobile版の `mobile/src/components/money/MoneyFab.tsx` と同じ。
// ＋は押すとすぐ記録の入力を開く。設定も1回で開く（2026-10-20。以前は＋でメニューを開いてから選ぶ2回の操作だった）。
// レシートは記録の入力の「レシートから追加」から読む（docs/kakei.md §10）。福引チャンスは家計と連動しないので、2026-10-13にその他タブへ移した。
export default function MoneyFab({ onAdd, onSettings }: { onAdd: () => void; onSettings: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <button
        type="button"
        aria-label="家計の設定"
        onClick={onSettings}
        className="pointer-events-auto absolute bottom-[84px] right-5 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-lg active:scale-95"
      >
        <Settings size={20} />
      </button>
      <button
        type="button"
        aria-label="記録を追加"
        onClick={onAdd}
        className="pointer-events-auto absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95"
      >
        <Plus size={28} />
      </button>
    </div>
  );
}
