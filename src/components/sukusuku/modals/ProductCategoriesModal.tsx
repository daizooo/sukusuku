'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { HouseholdProductCategory } from '@/types/app';
import { ModalShell } from './TaskForm';

// 日用品のカテゴリの一覧を直す（docs/home.md §4.1）。mobile版の
// `mobile/src/components/living/ProductCategoriesSheet.tsx` と同じ項目・同じ文言。
//
// 家族で共有する一覧。追加・名前を直す・並べ替え・削除ができる。品の編集では、ここから選ぶ。
// 名前を直すと、そのカテゴリの品も新しい名前になる。一覧にある名前へ直すと、1つにまとめる。
// 削除すると、そのカテゴリの品は「なし」になる。

interface ProductCategoriesModalProps {
  categories: HouseholdProductCategory[];
  /** カテゴリごとの品の数（削除の確認に出す）。 */
  counts: Record<string, number>;
  onClose: () => void;
  onAdd: (name: string) => void;
  onRename: (category: HouseholdProductCategory, name: string) => void;
  onDelete: (category: HouseholdProductCategory) => void;
  onMove: (category: HouseholdProductCategory, offset: -1 | 1) => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

function CategoryRow({
  category,
  isFirst,
  isLast,
  count,
  onRename,
  onDelete,
  onMove,
}: {
  category: HouseholdProductCategory;
  isFirst: boolean;
  isLast: boolean;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const [name, setName] = useState(category.name);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === category.name) {
      setName(category.name);
      return;
    }
    onRename(trimmed);
  };

  const confirmDelete = () => {
    const detail = count > 0 ? `\nこのカテゴリの日用品${count}品は「なし」になります。` : '';
    if (window.confirm(`「${category.name}」を削除しますか？${detail}`)) onDelete();
  };

  const iconClass = 'p-1.5 text-gray-500 disabled:text-gray-200';

  return (
    <li className="flex items-center gap-1 pl-1 pr-2">
      <input
        className="flex-1 min-w-0 px-2 py-2.5 text-sm font-bold text-gray-900 bg-transparent focus:outline-none"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-label={`${category.name}の名前`}
      />
      <span className="shrink-0 mr-1 text-[11px] font-bold tabular-nums text-gray-400">{count}品</span>
      <button type="button" aria-label={`${category.name}を上へ`} disabled={isFirst} onClick={() => onMove(-1)} className={iconClass}>
        <ChevronUp size={18} />
      </button>
      <button type="button" aria-label={`${category.name}を下へ`} disabled={isLast} onClick={() => onMove(1)} className={iconClass}>
        <ChevronDown size={18} />
      </button>
      <button type="button" aria-label={`${category.name}を削除`} onClick={confirmDelete} className="p-1.5 text-red-500">
        <Trash2 size={18} />
      </button>
    </li>
  );
}

export default function ProductCategoriesModal({
  categories,
  counts,
  onClose,
  onAdd,
  onRename,
  onDelete,
  onMove,
}: ProductCategoriesModalProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    if (categories.some((category) => category.name === trimmed)) {
      window.alert(`「${trimmed}」は一覧にあります`);
      return;
    }
    onAdd(trimmed);
    setDraft('');
  };

  return (
    <ModalShell
      title="日用品のカテゴリ"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
            placeholder="例: 紙類"
          />
          <button
            type="button"
            onClick={add}
            className="shrink-0 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-bold hover:bg-blue-600"
          >
            追加
          </button>
        </div>
      }
    >
      <p className="text-[11px] text-gray-400 mb-3">
        家族で共有する一覧です。日用品の編集では、ここから選びます。名前を直すと、そのカテゴリの品も新しい名前になります
      </p>
      {categories.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">まだありません</p>
      ) : (
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
          {categories.map((category, index) => (
            <CategoryRow
              key={`${category.id}:${category.name}`}
              category={category}
              isFirst={index === 0}
              isLast={index === categories.length - 1}
              count={counts[category.name] ?? 0}
              onRename={(name) => onRename(category, name)}
              onDelete={() => onDelete(category)}
              onMove={(offset) => onMove(category, offset)}
            />
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
