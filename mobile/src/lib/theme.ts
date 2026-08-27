// 画面の色。Web版(Tailwind)で使っていた値を持ってきて、名前で参照できるようにする。
export const colors = {
  background: '#f9fafb', // gray-50
  surface: '#ffffff',
  border: '#e5e7eb', // gray-200
  borderStrong: '#d1d5db', // gray-300
  text: '#111827', // gray-900
  textSubtle: '#374151', // gray-700
  textMuted: '#6b7280', // gray-500
  textFaint: '#9ca3af', // gray-400
  primary: '#ec4899', // pink-500
  primaryText: '#ffffff',
  danger: '#ef4444', // red-500
  accentSurface: '#fdf2f8', // pink-50

  // 記録の種類ごとの色。Web版の記録タブと同じ割り当て（ミルク=琥珀・おむつ=青・搾乳=薔薇）。
  // 体温・吐き戻しはWeb版に無い記録なので、ここで割り当てる（体温=橙・吐き戻し=菫）。
  milk: '#d97706', // amber-600
  milkSurface: '#fffbeb', // amber-50
  milkBorder: '#fde68a', // amber-200
  milkText: '#b45309', // amber-700
  diaper: '#3b82f6', // blue-500
  diaperSurface: '#eff6ff', // blue-50
  diaperText: '#1d4ed8', // blue-700
  pumping: '#f43f5e', // rose-500
  pumpingSurface: '#fff1f2', // rose-50
  pumpingBorder: '#fecdd3', // rose-200
  pumpingText: '#be123c', // rose-700
  temperature: '#ea580c', // orange-600
  temperatureSurface: '#fff7ed', // orange-50
  temperatureBorder: '#fed7aa', // orange-200
  temperatureText: '#c2410c', // orange-700
  spitup: '#7c3aed', // violet-600
  spitupSurface: '#f5f3ff', // violet-50
  spitupBorder: '#ddd6fe', // violet-200
  spitupText: '#6d28d9', // violet-700
  alertSurface: '#fee2e2', // red-100
  alertText: '#b91c1c', // red-700
  neutralSurface: '#f3f4f6', // gray-100
} as const;
