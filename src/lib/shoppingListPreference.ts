// 暮らしタブから買い出しリストへ送るときの送り先（docs/home.md §4.2）。
// 端末ごとに覚える（初回だけ選ぶ）。家族で共有しないのは、夫婦で別のリストへ
// 送りたいこともあるため。消えたリストを指していたら、選び直してもらう。
// mobile版は `mobile/src/lib/shoppingListPreference.ts`（AsyncStorage）。

const KEY = 'living.shoppingListId';

export function readShoppingListId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeShoppingListId(listId: string): void {
  try {
    window.localStorage.setItem(KEY, listId);
  } catch {
    // 保存できなくてもこの場では送れる。次に開いたときにもう一度選ぶだけ。
  }
}
