import type { ReactNode } from 'react';

/**
 * 各タブの見出し。
 *
 * 利用の大半がスマホのため、タブを行き来しても見出しの大きさ・位置・余白が
 * 変わらないよう1か所にまとめている。アイコンは付けず文字だけを中央にそろえ、
 * そのタブの主要な操作(編集・追加など)は右端に重ねて置く(見出しの中央位置が
 * 操作の有無でずれないようにするため)。
 */
export default function TabHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative flex items-center justify-center min-h-10 mb-3 shrink-0">
      <h2 className="text-[22px] leading-tight font-bold text-gray-900 tracking-tight text-center">{title}</h2>
      {children && <div className="absolute right-0 flex items-center">{children}</div>}
    </div>
  );
}
