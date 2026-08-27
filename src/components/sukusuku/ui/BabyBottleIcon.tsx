/**
 * 授乳(ミルク)を表す哺乳瓶のアイコン。
 *
 * lucide-react には哺乳瓶のアイコンがなく、代わりに使っていたコーヒーカップは
 * 授乳のイメージと合わないため、lucide と同じ描き方(24×24・線幅2・currentColor)で
 * 自前で用意している。搾乳に使っている Milk(牛乳瓶)と見分けられるよう、
 * 乳首を付けて少し傾けた形にしている。
 */
interface BabyBottleIconProps {
  size?: number;
  className?: string;
}

export default function BabyBottleIcon({ size = 24, className }: BabyBottleIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g transform="rotate(-20 12 12)">
        <path d="M10.2 8V4.8a1.8 1.8 0 0 1 3.6 0V8" />
        <path d="M7 8h10v11a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" />
        <path d="M7 12.5h10" />
      </g>
    </svg>
  );
}
