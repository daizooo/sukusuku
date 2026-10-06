'use client';

import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import LotteryDialog from './LotteryDialog';
import LotteryTestBar from './LotteryTestBar';

// 補助くじの「ヘルプ」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryHelpSheet.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。
// 動作確認用のテストモードも、ホームをすっきりさせるためここに置く。

interface LotteryHelpModalProps {
  onClose: () => void;
  testMode: boolean;
  onToggleTest: (value: boolean) => void;
  testCount: number;
  onDeleteTest: () => void;
  isDeletingTest: boolean;
}

export default function LotteryHelpModal({
  onClose,
  testMode,
  onToggleTest,
  testCount,
  onDeleteTest,
  isDeletingTest,
}: LotteryHelpModalProps) {
  return (
    <LotteryDialog title="ヘルプ" onClose={onClose}>
      <div className="space-y-4 p-5">
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
        <LotteryTestBar
          testMode={testMode}
          onToggle={onToggleTest}
          testCount={testCount}
          onDelete={onDeleteTest}
          isDeleting={isDeletingTest}
        />
      </div>
    </LotteryDialog>
  );
}
