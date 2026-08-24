// 画面の色。Web版(Tailwind)で使っていた値を持ってきて、名前で参照できるようにする。
// 画面を作り込むのはフェーズ1以降なので、いまは土台の画面が要るぶんだけ。
export const colors = {
  background: '#f9fafb', // gray-50
  surface: '#ffffff',
  border: '#e5e7eb', // gray-200
  text: '#111827', // gray-900
  textMuted: '#6b7280', // gray-500
  primary: '#ec4899', // pink-500
  primaryText: '#ffffff',
  danger: '#ef4444', // red-500
  accentSurface: '#fdf2f8', // pink-50
} as const;
