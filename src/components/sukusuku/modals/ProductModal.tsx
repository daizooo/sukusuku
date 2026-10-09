'use client';

import { useState } from 'react';
import { ChevronRight, Store } from 'lucide-react';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { ModalShell } from './TaskForm';
import { FullScreen } from '../money/moneyVisual';
import StorePicker from '../money/StorePicker';

// 日用品の台帳の1品を足す・直す（docs/home.md §4.1）。mobile版の
// `mobile/src/components/living/ProductSheet.tsx` と同じ項目・同じ文言。
//
// お店は、家計の記録と同じ選択画面（StorePicker。docs/kakei.md §3.2・§3.5）で選ぶ。自由入力ではない。
// 候補は、最近使ったお店・登録したお店（家計の設定）・前に使ったお店。
// 買い出しリストのグループ名と同じ名前のお店を選ぶと、送ったときにそのグループへ入る。

/** カテゴリを選ばないときのチップ。 */
const NO_CATEGORY = 'なし';

const followRenames = (name: string, renames: Record<string, string>): string => {
  let current = name;
  for (let step = 0; step < 20 && renames[current] !== undefined && renames[current] !== current; step += 1) {
    current = renames[current];
  }
  return current;
};

interface FormState {
  name: string;
  category: string;
  store: string;
  price: string;
  note: string;
}

const initialState = (product: HouseholdProduct | null): FormState =>
  product
    ? {
        name: product.name,
        category: product.category,
        store: product.store,
        price: product.price === null ? '' : String(product.price),
        note: product.note,
      }
    : { name: '', category: '', store: '', price: '', note: '' };

function toProductDraft(form: FormState): HouseholdProductDraft | string {
  if (form.name.trim() === '') return '品名を入れてください';
  const priceText = form.price.trim().replace(/[¥,円]/g, '');
  const price = priceText === '' ? null : Number(priceText);
  if (price !== null && (!Number.isInteger(price) || price < 0)) return '値段は0以上の整数（円）で入れてください';
  return { name: form.name, category: form.category, store: form.store, price, note: form.note };
}

interface ProductModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  product: HouseholdProduct | null;
  /** カテゴリの一覧（家族で共有。docs/home.md §4.1）の名前。ここから選ぶ。 */
  categories: string[];
  /** お店の候補（家計の記録と同じ。最近使った・登録した・前に使った）。 */
  storeChoices: { registered: string[]; recent: string[]; others: string[] };
  onClose: () => void;
  /** registerStore: お店の選択で「お店に登録して使う」を選んだか（docs/kakei.md §3.5）。 */
  onSubmit: (draft: HouseholdProductDraft, registerStore: boolean) => void;
  onDelete?: () => void;
  /** 一覧で直した・消したカテゴリ（前の名前 → 新しい名前。消したら空）。選んでいるカテゴリを追従させる。 */
  categoryRenames: Record<string, string>;
  /** カテゴリの一覧を直す画面を開く。 */
  onEditCategories: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

function Chips({ options, value, onPick }: { options: string[]; value: string; onPick: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
      {options.map((option) => {
        const selected = option === value.trim();
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(option)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
              selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export default function ProductModal({
  product,
  categories,
  storeChoices,
  onClose,
  onSubmit,
  onDelete,
  categoryRenames,
  onEditCategories,
}: ProductModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  // 一覧で直した・消したカテゴリを、選んでいるカテゴリに当てる（続けて直したときは最後の名前まで辿る）。
  const category = followRenames(form.category.trim(), categoryRenames);
  const [error, setError] = useState<string | null>(null);
  const [isPickingStore, setIsPickingStore] = useState(false);
  const [registerStore, setRegisterStore] = useState(false);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = () => {
    const draft = toProductDraft({ ...form, category });
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft, form.store.trim() !== '' && registerStore);
  };

  const handleDelete = () => {
    if (window.confirm('この日用品を削除しますか？')) onDelete?.();
  };

  return (
    <>
      <ModalShell
        title={product ? '日用品を編集' : '日用品を追加'}
        onClose={onClose}
        footer={
          <div className="space-y-1">
            <button
              type="button"
              onClick={handleSubmit}
              className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
            >
              {product ? '保存する' : '追加する'}
            </button>
            {product && onDelete && (
              <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
                削除する
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className={labelClass}>品名</span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="例: トイレットペーパー ダブル 12ロール"
            />
          </label>
  
          <div>
            <span className={labelClass}>お店</span>
            <button
              type="button"
              onClick={() => setIsPickingStore(true)}
              className={`${inputClass} flex items-center gap-2 text-left hover:bg-gray-50`}
            >
              <Store size={18} className="text-gray-500" />
              <span className={`flex-1 ${form.store === '' ? 'text-gray-400' : 'text-gray-900'}`}>
                {form.store || 'お店を選ぶ'}
              </span>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <span className="block text-[11px] text-gray-400 mt-1">
              買い出しリストのグループと同じ名前にすると、送ったときにそのグループへ入ります
            </span>
          </div>
  
          <label className="block">
            <span className={labelClass}>いつもの値段（円）</span>
            <input
              className={inputClass}
              value={form.price}
              onChange={(event) => update({ price: event.target.value })}
              inputMode="numeric"
              placeholder="例: 598"
            />
          </label>
  
          <div>
            <div className="flex items-center justify-between">
              <span className={labelClass}>カテゴリ</span>
              <button type="button" onClick={onEditCategories} className="mb-1.5 text-xs font-bold text-blue-500">
                一覧を編集
              </button>
            </div>
            {/* 一覧から選ぶ（自由に書くと人によって書き方がばらつくため）。一覧に無い前の値は、そのまま残して出す。 */}
            <Chips
              options={[
                NO_CATEGORY,
                ...categories,
                ...(category !== '' && !categories.includes(category) ? [category] : []),
              ]}
              value={category === '' ? NO_CATEGORY : category}
              onPick={(category) => update({ category: category === NO_CATEGORY ? '' : category })}
            />
            {categories.length === 0 && (
              <span className="block text-[11px] text-gray-400 mt-1">「一覧を編集」でカテゴリを作ると、ここで選べます</span>
            )}
          </div>
  
          <label className="block">
            <span className={labelClass}>メモ</span>
            <input
              className={inputClass}
              value={form.note}
              onChange={(event) => update({ note: event.target.value })}
              placeholder="例: セールなら¥398"
            />
          </label>
  
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </ModalShell>
      {isPickingStore && (
        <FullScreen onBack={() => setIsPickingStore(false)}>
          <StorePicker
            value={form.store}
            registered={storeChoices.registered}
            recent={storeChoices.recent}
            others={storeChoices.others}
            canRegister
            subject="日用品"
            onPick={(store, register) => {
              update({ store });
              setRegisterStore(register);
              setIsPickingStore(false);
            }}
            onClose={() => setIsPickingStore(false)}
          />
        </FullScreen>
      )}
    </>
  );
}
