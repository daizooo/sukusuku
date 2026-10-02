// 画面の色。Web版(Tailwind)で使っていた値を持ってきて、名前で参照できるようにする。
export const colors = {
  // 画面の一番上の帯の色。アプリのアイコンの背景（白）に合わせる。PWA版のmanifestの theme_color と同じ。
  brand: '#ffffff',
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

  // 予定・タスクの参加者1人だけが選ばれているときの色分け。
  labelDaizoSurface: '#dbeafe', // blue-100
  labelDaizoText: '#1d4ed8', // blue-700
  labelDaizoBorder: '#bfdbfe', // blue-200
  labelIzumiSurface: '#fee2e2', // red-100
  labelIzumiText: '#b91c1c', // red-700
  labelIzumiBorder: '#fecaca', // red-200
  labelGakuSurface: '#d1fae5', // emerald-100
  labelGakuText: '#047857', // emerald-700
  labelGakuBorder: '#a7f3d0', // emerald-200
  labelDefaultText: '#4b5563', // gray-600

  // 下のタブバー。Web版の下部ナビと同じ（選択中=blue-500 / それ以外=gray-500）。
  navActive: '#3b82f6', // blue-500
  navInactive: '#6b7280', // gray-500
  navActiveText: '#2563eb', // blue-600（切り替えで選んでいる方の文字）
  selectedRing: '#60a5fa', // blue-400（カレンダーで選んでいる日の枠）
  selectedSurface: '#eff6ffb3', // blue-50/70（同じく地の色）
  dragBorder: '#93c5fd', // blue-300（長押しで持ち上げている枠）
  borderStrongSoft: '#e5e7ebcc', // gray-200/80（切り替えの下地）

  // 記録の種類ごとの色。Web版の記録タブと同じ割り当て（ミルク=琥珀・おむつ=青・搾乳=薔薇）。
  // 体温の色。Web版(src/)のTailwindの orange 系と同じ値にそろえてある。
  // 記録のバッジと、タイムラインの丸。PWA版はTailwindの100番台を使う。
  milkBadge: '#fef3c7', // amber-100
  milkBadgeText: '#92400e', // amber-800
  diaperBadge: '#dbeafe', // blue-100
  pumpingBadge: '#ffe4e6', // rose-100
  temperatureBadge: '#ffedd5', // orange-100
  neutralBadgeText: '#4b5563', // gray-600
  dangerBorder: '#fca5a5', // red-300（受診の目安の記録の枠）

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
  // ホームのショートカット。PWA版の quickActions と同じ割り当て
  // （産院=薔薇・小児科=青・相手の会社=緑・相手への連絡=紫）。
  quickHospitalSurface: '#ffe4e6', // rose-100
  quickHospitalIcon: '#e11d48', // rose-600
  quickPediatricSurface: '#dbeafe', // blue-100
  quickPediatricIcon: '#2563eb', // blue-600
  quickCompanySurface: '#dcfce7', // green-100
  quickCompanyIcon: '#16a34a', // green-600
  quickContactSurface: '#f3e8ff', // purple-100
  quickContactIcon: '#9333ea', // purple-600

  sunday: '#ef4444', // red-500（カレンダーの日曜）
  milestone: '#d97706', // amber-600（節目の日の小さな文字）
  milestoneSurface: '#fffbeb', // amber-50（節目の札）
  milestoneBorder: '#fde68a', // amber-200
  milestoneText: '#b45309', // amber-700
  gradeGood: '#22c55e', // green-500（見学チェックの「良い」・済んだ項目）
  gradeGoodSurface: '#f0fdf4', // green-50
  gradeGoodBorder: '#bbf7d0', // green-200
  gradeWatch: '#f97316', // orange-500（見学チェックの「気になる」）
  doneSurface: '#dcfce7', // green-100（完了済の札）
  doneText: '#15803d', // green-700
  noteSurface: '#eff6ff80', // blue-50/50（予定の詳細のメモ）
  noteText: '#1e40af', // blue-800
  noteBody: '#1e3a8a', // blue-900
  alertSurface: '#fee2e2', // red-100
  alertText: '#b91c1c', // red-700
  neutralSurface: '#f3f4f6', // gray-100
  borderFaint: '#e5e7ebb3', // gray-200/70（帯の細かい目盛り）
  dangerSurface: '#fef2f2', // red-50（ログイン画面の確認リンクのエラーの下地）
  holidaySurface: '#fef2f2', // red-50（祝日の札）
  holidayBorder: '#fecaca', // red-200
  holidayText: '#dc2626', // red-600
} as const;
