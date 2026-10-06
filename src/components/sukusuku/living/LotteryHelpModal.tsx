'use client';

import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import { ModalShell } from '../modals/TaskForm';

// 補助くじのルール説明（くじ画面の「？」。docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryHelpSheet.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。

export default function LotteryHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="補助くじのルール"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
        >
          とじる
        </button>
      }
    >
      <div className="space-y-4">
        {lotteryHelp().map((section) => (
          <section key={section.heading} className="space-y-1.5">
            <h4 className="text-sm font-bold text-gray-900">{section.heading}</h4>
            {section.lines.map((line) => (
              <p key={line} className="text-[13px] leading-relaxed text-gray-700">
                {line}
              </p>
            ))}
          </section>
        ))}
      </div>
    </ModalShell>
  );
}
