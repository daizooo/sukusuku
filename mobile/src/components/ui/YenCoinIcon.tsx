import Svg, { Circle, Path } from 'react-native-svg';

/**
 * 円マーク入りの硬貨。下のタブバーの「家計」のアイコン。
 * 財布（Wallet）だと何のタブか分かりにくかったので、お金だと一目で分かる形にした。
 * lucide に円入りの丸が無いので、同じ線の太さ・丸みで自前で描いている。
 * Web版は `src/components/sukusuku/ui/YenCoinIcon.tsx`。
 */
export default function YenCoinIcon({ size = 24, color = '#000000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} />
      <Path
        d="m8.5 7 3.5 5.5L15.5 7M12 12.5V18M8.5 13.5h7M8.5 16h7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
