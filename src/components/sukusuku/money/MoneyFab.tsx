'use client';

import { useState } from 'react';
import { Plus, Settings, Ticket } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';
import { useBackdropClose } from '../ui/useBackdropClose';

// 家計タブ右下の、1つの大きな丸いボタン（docs/kakei.md §2）。mobile版の `mobile/src/components/money/MoneyFab.tsx` と同じ。
// 押すと「記録を追加」「家計の設定」「福引チャンス」の3つが上に開く。以前は＋と、その左の小さなピル（福引｜設定）に
// 分かれていて押しづらかったので、1つにまとめて大きくした（2026-10-10）。
// 開いている間は戻る操作で閉じる。暗い部分を押しても閉じる。
export default function MoneyFab({
  onAdd,
  onSettings,
  onLottery,
}: {
  onAdd: () => void;
  onSettings: () => void;
  onLottery: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useBackLayer(close, open);
  const backdropClose = useBackdropClose(close);

  // 選んだら閉じてから動かす。
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {open && <div className="pointer-events-auto absolute inset-0 bg-black/40" aria-hidden="true" {...backdropClose} />}

      {open && (
        <div className="pointer-events-none absolute bottom-[92px] right-4 flex flex-col items-end gap-3">
          <button
            type="button"
            aria-label="福引チャンス"
            onClick={choose(onLottery)}
            className="pointer-events-auto flex h-14 items-center gap-3 rounded-full border border-gray-200 bg-purple-50 px-[22px] text-[17px] font-bold text-purple-600 shadow-lg active:scale-95"
          >
            <Ticket size={24} />
            福引チャンス
          </button>
          <button
            type="button"
            aria-label="家計の設定"
            onClick={choose(onSettings)}
            className="pointer-events-auto flex h-14 items-center gap-3 rounded-full border border-gray-200 bg-white px-[22px] text-[17px] font-bold text-gray-900 shadow-lg active:scale-95"
          >
            <Settings size={24} className="text-gray-500" />
            家計の設定
          </button>
          <button
            type="button"
            aria-label="記録を追加"
            onClick={choose(onAdd)}
            className="pointer-events-auto flex h-14 items-center gap-3 rounded-full border border-blue-600 bg-blue-600 px-[22px] text-[17px] font-bold text-white shadow-lg active:scale-95"
          >
            <Plus size={24} />
            記録を追加
          </button>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
        onClick={() => setOpen((value) => !value)}
        className="pointer-events-auto absolute bottom-4 right-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95"
      >
        {/* 開いている間は45度回して「×」にする。 */}
        <Plus size={32} className={`transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>
    </div>
  );
}
