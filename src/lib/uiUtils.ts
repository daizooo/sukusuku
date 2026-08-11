import type { Assignee } from '@/types/app';

// 担当者ごとのバッジ配色
export const getAssigneeColor = (assignee: Assignee | string): string => {
  switch (assignee) {
    case 'パパ':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ママ':
      return 'bg-pink-100 text-pink-700 border-pink-200';
    case '二人で':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};
