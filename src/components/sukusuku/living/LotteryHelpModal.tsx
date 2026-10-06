'use client';

import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import LotteryDialog from './LotteryDialog';
import LotteryTestBar from './LotteryTestBar';

// 福引チャンスの「ヘルプ」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryHelpSheet.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。
// 動作確認用のテストモードも、ホームをすっきりさせるためここに置く（開発をしている夫にだけ出す）。
// 見出しは赤い印で目立たせ、各行は「・」付きの短い1行。「：」の前は太字にする。

/** 1行を「太字の頭」と「残り」に分ける（「：」が無ければ全部残り）。 */
const splitLine = (line: string) => {
  const index = line.indexOf('：');
  return index < 0 ? { head: null, rest: line } : { head: line.slice(0, index), rest: line.slice(index + 1) };
};

interface LotteryHelpModalProps {
  onClose: () => void;
  /** テストモードを出すか（夫だけ。ほかの人には見せない）。 */
  canTest: boolean;
  testMode: boolean;
  onToggleTest: (value: boolean) => void;
  testCount: number;
  onDeleteTest: () => void;
  isDeletingTest: boolean;
}

export default function LotteryHelpModal({
  onClose,
  canTest,
  testMode,
  onToggleTest,
  testCount,
  onDeleteTest,
  isDeletingTest,
}: LotteryHelpModalProps) {
  return (
    <LotteryDialog title="ヘルプ" onClose={onClose}>
      <div className="space-y-[18px] p-5">
        {lotteryHelp().map((section) => (
          <section key={section.heading} className="space-y-1.5">
            <h4 className="mb-0.5 flex items-center gap-2 text-[15px] font-extrabold text-gray-900">
              <span className="h-4 w-1 rounded-sm bg-red-600" />
              {section.heading}
            </h4>
            {section.lines.map((line) => {
              const { head, rest } = splitLine(line);
              return (
                <p key={line} className="flex pl-1 text-[13px] leading-5 text-gray-700">
                  <span className="text-gray-400">・</span>
                  <span className="flex-1">
                    {head !== null && <b className="font-extrabold text-gray-900">{head}　</b>}
                    {rest}
                  </span>
                </p>
              );
            })}
          </section>
        ))}
        {canTest && (
          <LotteryTestBar
            testMode={testMode}
            onToggle={onToggleTest}
            testCount={testCount}
            onDelete={onDeleteTest}
            isDeleting={isDeletingTest}
          />
        )}
      </div>
    </LotteryDialog>
  );
}
