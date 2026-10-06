// 買い出しリストへ送るときの決まりごと（暮らしタブ。docs/home.md §4.2）。
// mobile版の `mobile/src/lib/shoppingUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// - お店の名前とリストのグループ名が同じなら、そのグループへ入れる。無ければ未分類
// - まだ買っていない同じ項目が既にリストにあれば、重ねて入れない
// - 名前を比べるときは、全角・半角と前後の空白、英字の大小を気にしない（「ｲｵﾝ」と「イオン」は同じ）

/** 比べるための形に直す。全角英数を半角へ、半角カナを全角へ寄せ、前後の空白を落とし、小文字にする。 */
export const normalizeName = (value: string) => value.normalize('NFKC').trim().toLowerCase();

interface GroupLike {
  id: string;
  name: string;
}

interface ItemLike {
  groupId: string | null;
  title: string;
  done: boolean;
  position: number;
}

export type ShoppingAddPlan =
  | { kind: 'duplicate'; groupName: string | null }
  | { kind: 'add'; groupId: string | null; groupName: string | null; position: number };

/** 送り先のリスト（グループと項目）に、title をどこへ入れるかを決める。 */
export function planShoppingAdd(
  groups: GroupLike[],
  items: ItemLike[],
  title: string,
  store: string,
): ShoppingAddPlan {
  const key = normalizeName(title);
  const existing = items.find((item) => !item.done && normalizeName(item.title) === key);
  if (existing) {
    const group = groups.find((row) => row.id === existing.groupId);
    return { kind: 'duplicate', groupName: group?.name ?? null };
  }
  const storeKey = normalizeName(store);
  const group = storeKey === '' ? undefined : groups.find((row) => normalizeName(row.name) === storeKey);
  const groupId = group?.id ?? null;
  // 同じ枠の末尾へ足す（リストの追加欄で足したときと同じ並び）。
  const position = items
    .filter((item) => item.groupId === groupId)
    .reduce((max, item) => Math.max(max, item.position + 1), 0);
  return { kind: 'add', groupId, groupName: group?.name ?? null, position };
}

interface ProductLike {
  name: string;
  lastAddedAt: string | null;
}

/**
 * リストの追加欄で打っている文字から、台帳の候補を出す（docs/home.md §4.2）。
 * 名前に打った文字を含むもの。打った文字と同じものは出さない（そのまま追加すればよい）。
 * 最近送ったものほど先に出す。
 */
export function suggestProducts<T extends ProductLike>(products: T[], typed: string, limit = 4): T[] {
  const key = normalizeName(typed);
  if (key === '') return [];
  return products
    .filter((product) => {
      const name = normalizeName(product.name);
      return name !== key && name.includes(key);
    })
    .sort((a, b) => (b.lastAddedAt ?? '').localeCompare(a.lastAddedAt ?? ''))
    .slice(0, limit);
}

/** 備蓄の不足を買い出しリストへ送るときの内容（「肉（やきとり缶） 3個」）。 */
export const shortageTitle = (name: string, shortage: number, unit: string) =>
  `${name.trim()} ${Math.round(shortage * 100) / 100}${unit.trim()}`;

/** 値段の表示（「¥1,280」）。 */
export const formatPrice = (price: number) => `¥${price.toLocaleString('ja-JP')}`;
