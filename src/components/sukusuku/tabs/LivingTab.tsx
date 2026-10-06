'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { StockItem, StockItemDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { deleteStockItem, insertStockItem, loadStockItems, updateStockItem } from '@/lib/api/stockItems';
import {
  categoryOptions,
  countByLevel,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  sortStockItems,
  type ExpiryLevel,
} from '@/lib/stockUtils';
import StockItemModal from '../modals/StockItemModal';

/**
 * 暮らしタブ（docs/home.md）。いまは防災備蓄だけ（フェーズ1）。
 * mobile版の `mobile/app/(tabs)/living.tsx` と同じ項目・並び・文言にしてある。
 *
 * 防災備蓄の困りごとは数を数えることではなく、期限切れに気づかないこと。
 * そこで**期限の近い順**に並べ、上に「期限切れ・3か月以内・1年以内」の件数を出す。
 * 1行＝品名×期限（ロット）。同じ品でも期限が違えば別の行になる。
 *
 * 見出し・要約・カテゴリの切り替えは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

/** 「すべて」を表すカテゴリの絞り込み。 */
const ALL = '';

const LEVEL_CLASS: Record<ExpiryLevel, { text: string; badge: string }> = {
  expired: { text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  soon: { text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  year: { text: 'text-orange-700', badge: 'bg-orange-50 text-orange-700' },
  ok: { text: 'text-gray-500', badge: '' },
  none: { text: 'text-gray-400', badge: '' },
};

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = StockItem | 'new' | null;

export default function LivingTab({ familyId }: { familyId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    let isMounted = true;
    loadStockItems(supabase, familyId)
      .then((loaded) => {
        if (isMounted) setItems(loaded);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

  const today = toDateStringInTimeZone(new Date());
  const categories = useMemo(() => categoryOptions(items), [items]);
  const counts = useMemo(() => countByLevel(items, today), [items, today]);
  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory = category === ALL || categories.includes(category) ? category : ALL;
  const visibleItems = useMemo(
    () =>
      sortStockItems(activeCategory === ALL ? items : items.filter((item) => item.category === activeCategory)),
    [items, activeCategory],
  );

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  const save = async (draft: StockItemDraft) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    try {
      if (target === 'new') {
        const created = await insertStockItem(supabase, familyId, draft);
        setItems((prev) => [...prev, created]);
      } else {
        const updated = await updateStockItem(supabase, target.id, draft);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    setEditing(null);
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await deleteStockItem(supabase, id);
    } catch {
      setItems(previous);
      failed('削除');
    }
  };

  const summary = [
    counts.expired > 0 && { level: 'expired' as const, text: `期限切れ ${counts.expired}件` },
    counts.soon > 0 && { level: 'soon' as const, text: `3か月以内 ${counts.soon}件` },
    counts.year > 0 && { level: 'year' as const, text: `1年以内 ${counts.year}件` },
  ].filter((entry) => entry !== false);

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <h2 className="text-lg font-bold text-gray-900">防災備蓄</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-500 text-white text-sm font-bold hover:bg-blue-600 transition"
        >
          <Plus size={16} />
          追加
        </button>
      </div>

      {!isLoading && items.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 pb-2">
          {summary.length === 0 ? (
            <span className="text-xs text-gray-500">1年以内に期限が来るものはありません</span>
          ) : (
            summary.map((entry) => (
              <span
                key={entry.level}
                className={`px-2 py-1 rounded-lg text-xs font-bold ${LEVEL_CLASS[entry.level].badge}`}
              >
                {entry.text}
              </span>
            ))
          )}
        </div>
      )}

      {categories.length > 1 && (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2">
          {[ALL, ...categories].map((value) => {
            const selected = value === activeCategory;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                  selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {value || 'すべて'}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">備蓄はまだありません</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
            {visibleItems.map((item) => {
              const level = expiryLevel(item.expiresOn, today);
              const sub = [item.category, item.note].filter((text) => text !== '').join('・');
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(item)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{item.name}</p>
                      {sub !== '' && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-[13px] font-bold text-gray-700">
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </p>
                      <p className={`text-[11px] font-bold mt-0.5 ${LEVEL_CLASS[level].text}`}>
                        {item.expiresOn ? `${level === 'expired' ? '切れ ' : ''}${formatExpiry(item)}` : '期限なし'}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing !== null && (
        <StockItemModal
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
        />
      )}
    </div>
  );
}
