import type { Label } from '@/types/app';

// ラベルごとのバッジ配色
export const getLabelColor = (label: Label | string): string => {
  switch (label) {
    case 'パパ':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ママ':
      return 'bg-pink-100 text-pink-700 border-pink-200';
    case '家族':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};

// カレンダーのドット表示用（ラベルごとの塗り色）
export const getLabelDotColor = (label: Label | string): string => {
  switch (label) {
    case 'パパ':
      return 'bg-blue-500';
    case 'ママ':
      return 'bg-pink-500';
    case '家族':
      return 'bg-emerald-500';
    default:
      return 'bg-gray-400';
  }
};
