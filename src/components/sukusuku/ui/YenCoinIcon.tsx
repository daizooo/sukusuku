/**
 * 円マーク入りの硬貨。下のタブバーの「家計」のアイコン。
 * 財布（Wallet）だと何のタブか分かりにくかったので、お金だと一目で分かる形にした。
 * lucide に円入りの丸が無いので、同じ線の太さ・丸みで自前で描いている。
 * mobile版は `mobile/src/components/ui/YenCoinIcon.tsx`。lucide のアイコンと同じく size と className を取る。
 */
export default function YenCoinIcon({ size = 24, className }: { size?: number; className?: string }) {
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
      <circle cx={12} cy={12} r={10} />
      <path d="m8.5 7 3.5 5.5L15.5 7M12 12.5V18M8.5 13.5h7M8.5 16h7" />
    </svg>
  );
}
