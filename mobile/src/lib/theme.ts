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

  // 予定のラベルの色。Web版の getLabelColor と同じ割り当て。
  labelPapaSurface: '#dbeafe', // blue-100
  labelPapaText: '#1d4ed8', // blue-700
  labelPapaBorder: '#bfdbfe', // blue-200
  labelMamaSurface: '#fce7f3', // pink-100
  labelMamaText: '#be185d', // pink-700
  labelMamaBorder: '#fbcfe8', // pink-200
  labelFamilySurface: '#d1fae5', // emerald-100
  labelFamilyText: '#047857', // emerald-700
  labelFamilyBorder: '#a7f3d0', // emerald-200
  labelDefaultText: '#4b5563', // gray-600

  // 下のタブバー。Web版の下部ナビと同じ（選択中=blue-500 / それ以外=gray-500）。
  navActive: '#3b82f6', // blue-500
  navInactive: '#6b7280', // gray-500
  navActiveText: '#2563eb', // blue-600（切り替えで選んでいる方の文字）
  borderStrongSoft: '#e5e7ebcc', // gray-200/80（切り替えの下地）

  // 記録の種類ごとの色。Web版の記録タブと同じ割り当て（ミルク=琥珀・おむつ=青・搾乳=薔薇）。
  // 体温の色。Web版(src/)のTailwindの orange 系と同じ値にそろえてある。
  milk: '#d97706', // amber-600
  milkSurface: '#fffbeb', // amber-50
  milkBorder: '#fde68a', // amber-200
  milkText: '#b45309', // amber-700
  milkProgress: '#fbbf24', // amber-400（次の授乳までの進み具合）
  milkMark: '#f59e0b', // amber-500（24時間の帯に出す授乳の印）
  diaper: '#3b82f6', // blue-500
  diaperSurface: '#eff6ff', // blue-50
  diaperBorder: '#bfdbfe', // blue-200
  diaperText: '#1d4ed8', // blue-700
  pumping: '#f43f5e', // rose-500
  pumpingSurface: '#fff1f2', // rose-50
  pumpingBorder: '#fecdd3', // rose-200
  pumpingText: '#be123c', // rose-700
  temperature: '#ea580c', // orange-600
  temperatureSurface: '#fff7ed', // orange-50
  temperatureBorder: '#fed7aa', // orange-200
  temperatureText: '#c2410c', // orange-700
  sunday: '#ef4444', // red-500（カレンダーの日曜）
  milestone: '#d97706', // amber-600（節目の日の小さな文字）
  milestoneSurface: '#fffbeb', // amber-50（節目の札）
  milestoneBorder: '#fde68a', // amber-200
  milestoneText: '#b45309', // amber-700
  doneSurface: '#dcfce7', // green-100（完了済の札）
  doneText: '#15803d', // green-700
  noteSurface: '#eff6ff80', // blue-50/50（予定の詳細のメモ）
  noteText: '#1e40af', // blue-800
  noteBody: '#1e3a8a', // blue-900
  alertSurface: '#fee2e2', // red-100
  alertText: '#b91c1c', // red-700
  neutralSurface: '#f3f4f6', // gray-100
  borderFaint: '#e5e7ebb3', // gray-200/70（帯の細かい目盛り）
} as const;
