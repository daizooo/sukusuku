import AsyncStorage from '@react-native-async-storage/async-storage';

// 暮らしタブから買い出しリストへ送るときの送り先（docs/home.md §4.2）。
// 端末ごとに覚える（初回だけ選ぶ）。家族で共有しないのは、夫婦で別のリストへ
// 送りたいこともあるため。消えたリストを指していたら、選び直してもらう。
// PWA版は `src/lib/shoppingListPreference.ts`（localStorage）。

const KEY = 'living.shoppingListId';

export async function readShoppingListId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function writeShoppingListId(listId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, listId);
  } catch {
    // 保存できなくてもこの場では送れる。次に開いたときにもう一度選ぶだけ。
  }
}
