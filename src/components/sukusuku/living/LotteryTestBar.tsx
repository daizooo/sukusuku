'use client';

// 補助くじの「テストモード」の切り替えと、テストデータの削除（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryTestBar.tsx` と同じ項目・文言。
// 動作確認のために引いたくじ・券を、本物と分けて持ち、確認が済んだらまとめて消す。ヘルプの枠の下に置く。

interface LotteryTestBarProps {
  testMode: boolean;
  onToggle: (value: boolean) => void;
  /** 消せるテストのくじ・券の件数（0なら削除ボタンは押せない）。 */
  testCount: number;
  onDelete: () => void;
  isDeleting: boolean;
}

export default function LotteryTestBar({ testMode, onToggle, testCount, onDelete, isDeleting }: LotteryTestBarProps) {
  const canDelete = testCount > 0 && !isDeleting;
  return (
    <div
      className={`space-y-2 rounded-xl border px-3 py-2 ${
        testMode ? 'border-amber-500 bg-amber-100' : 'border-gray-200 bg-white'
      }`}
    >
      <label className="flex items-center gap-2">
        <span className="flex-1 min-w-0">
          <span className={`block text-[13px] font-bold ${testMode ? 'text-amber-800' : 'text-gray-900'}`}>
            テストモード
          </span>
          <span className="block text-[11px] text-gray-700">
            {testMode
              ? 'テスト中。回数・履歴・券は本物と別で、あとで消せます'
              : '動作確認用。ONで引いても、本物の回数や履歴に残りません'}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={testMode}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-amber-600"
        />
      </label>
      {testMode && (
        <button
          type="button"
          disabled={!canDelete}
          onClick={onDelete}
          className="w-full rounded-lg bg-red-500 py-2 text-[13px] font-bold text-white transition hover:bg-red-600 disabled:bg-gray-300"
        >
          {isDeleting ? '削除中…' : `テストデータを削除（${testCount}件）`}
        </button>
      )}
    </div>
  );
}
