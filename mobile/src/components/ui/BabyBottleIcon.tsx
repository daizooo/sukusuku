import Svg, { G, Path } from 'react-native-svg';

/**
 * 授乳(ミルク)を表す哺乳瓶のアイコン。
 *
 * Web版の `src/components/sukusuku/ui/BabyBottleIcon.tsx` と同じ形。
 * lucide には哺乳瓶のアイコンが無いため、lucide と同じ描き方(24×24・線幅2)で
 * 自前で用意している。搾乳に使っている Milk(牛乳瓶)と見分けられるよう、
 * 乳首を付けて少し傾けた形にしている。
 */
interface BabyBottleIconProps {
  size?: number;
  color?: string;
}

export default function BabyBottleIcon({ size = 24, color = 'currentColor' }: BabyBottleIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <G rotation={-20} origin="12, 12">
        <Path d="M10.2 8V4.8a1.8 1.8 0 0 1 3.6 0V8" />
        <Path d="M7 8h10v11a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" />
        <Path d="M7 12.5h10" />
      </G>
    </Svg>
  );
}
