'use client';

import { editorGroupTotal, editorLineAmount, formatBalance, formatYen, isBlankLine, type EditorGroup } from '@/lib/moneyUtils';
import { CategoryIcon } from './moneyVisual';

// 記録のカテゴリごとの品目（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/RecordItemGroups.tsx` と同じ並び・文言。
// 記録の詳細（読むだけ）と編集の両方で同じ書き方にする（2026-10-15）。
// カテゴリの行（アイコン・カテゴリ名・小計）の下に、品目を1行ずつ（品名・個数 × 単価・金額）。品目が1つでも複数でも同じ。
// 小計は黒、品目の金額は灰色（合計とのメリハリ）。onOpen があれば、カテゴリのまとまりを押せる（編集で品目の画面を開く）。
// 品目が1つだけのまとまりは、品目の金額を出さない（小計と同じ数字が2つ並ぶため。2026-10-20）。個数 × 単価は出す。

interface RecordItemGroupsProps {
  groups: EditorGroup[];
  /** カテゴリの見出し（「食費 › 食料品」）。 */
  title: (group: EditorGroup) => string;
  /** カテゴリのアイコンの key。 */
  iconKey: (group: EditorGroup) => string;
  /** large は詳細、small は編集（文字を一回り小さく）。 */
  size: 'large' | 'small';
  onOpen?: (group: EditorGroup) => void;
}

export default function RecordItemGroups({ groups, title, iconKey, size, onOpen }: RecordItemGroupsProps) {
  const large = size === 'large';
  return (
    <>
      {groups.map((group) => {
        const lines = group.lines.filter((line) => !isBlankLine(line));
        const single = lines.length === 1;
        const className = `flex w-full items-start border-b border-gray-200 text-left ${
          large ? 'gap-3.5 pt-3 pb-2.5' : 'gap-4 py-2'
        } ${onOpen ? 'hover:bg-gray-50' : ''}`;
        const content = (
          <>
            <span className="mt-px shrink-0">
              <CategoryIcon iconKey={iconKey(group)} size={large ? 30 : 24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate font-bold ${large ? 'text-sm text-gray-700' : 'text-xs text-gray-500'}`}>
                  {title(group)}
                </span>
                <span className={`font-extrabold tabular-nums text-gray-900 ${large ? 'text-base' : 'text-sm'}`}>
                  {formatBalance(editorGroupTotal(group))}
                </span>
              </span>
              {lines.map((line) => (
                <span key={line.key} className="flex items-baseline gap-2 pt-[3px]">
                  <span
                    className={`min-w-0 flex-1 truncate font-semibold ${large ? 'text-[13px]' : 'text-xs'} ${
                      line.name.trim() === '' ? 'text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    {line.name.trim() !== '' ? line.name.trim() : '品名なし'}
                  </span>
                  {line.quantity > 1 && (
                    <span className={`font-medium tabular-nums text-gray-500 ${large ? 'text-[11px]' : 'text-[10px]'}`}>
                      {formatYen(Math.abs(line.unitPrice))} × {line.quantity}
                    </span>
                  )}
                  {!single && (
                    <span className={`font-semibold tabular-nums text-gray-500 ${large ? 'text-sm' : 'text-xs'}`}>
                      {formatBalance(editorLineAmount(line))}
                    </span>
                  )}
                </span>
              ))}
            </span>
          </>
        );
        return onOpen ? (
          <button key={group.key} type="button" onClick={() => onOpen(group)} className={className}>
            {content}
          </button>
        ) : (
          <div key={group.key} className={className}>
            {content}
          </div>
        );
      })}
    </>
  );
}
