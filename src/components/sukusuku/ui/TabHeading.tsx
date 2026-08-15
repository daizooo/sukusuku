import type { ReactNode } from 'react';

/**
 * 各タブの見出し。
 *
 * 利用の大半がスマホのため、タブを行き来しても見出しの大きさ・位置・余白が
 * 変わらないよう1か所にまとめている。文字は小さくしすぎず(22px)、右側には
 * そのタブの主要な操作(編集・追加など)を置けるようにしている。
 */
export default function TabHeading({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-between items-center gap-2 mb-3 shrink-0">
      <h2 className="flex items-center gap-2 text-[22px] leading-tight font-bold text-gray-900 tracking-tight">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}
