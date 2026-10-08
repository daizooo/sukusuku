'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';
import { swipeBoundary } from '../ui/useSwipeNavigation';

// 補助くじの、画面の中央に出す枠（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryDialog.tsx` と同じ組み立て。
// 賞品一覧・券・履歴・ヘルプ・くじの結果に使う。戻る操作・枠の外を押すと閉じる。

interface LotteryDialogProps {
  /** 見出し。無ければ見出しの帯を出さない（くじの結果）。 */
  title?: string;
  onClose: () => void;
  /** 中身の高さを画面に合わせて決め打ちにする（中身が自分でスクロールする券・履歴）。 */
  fill?: boolean;
  /** 下に固定で置くもの。 */
  footer?: ReactNode;
  children: ReactNode;
}

export default function LotteryDialog({ title, onClose, fill, footer, children }: LotteryDialogProps) {
  // 戻る操作（ブラウザ・スマホ）でこの枠を閉じる。
  useBackLayer(onClose);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-5" onClick={onClose} {...swipeBoundary}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`flex w-full max-w-[420px] flex-col overflow-hidden rounded-[20px] bg-white shadow-xl ${
          fill ? 'h-[80%]' : 'max-h-[85%]'
        }`}
      >
        {title !== undefined && (
          <div className="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-3.5">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
              <X size={20} />
            </button>
          </div>
        )}
        <div className={fill ? 'flex min-h-0 flex-1 flex-col px-4 pt-3' : 'min-h-0 flex-1 overflow-y-auto'}>{children}</div>
        {footer && <div className="flex-none px-5 pb-4 pt-2">{footer}</div>}
      </div>
    </div>
  );
}
