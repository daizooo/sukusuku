import AsyncStorage from '@react-native-async-storage/async-storage';

// 保活（見学チェック）の入口を設定タブに出すかどうか。
//
// 保活は見学のときだけ開く機能で、見学が済んだら要らなくなる。日常の画面に置かず
// 設定タブへ移し、要らなくなったら入口ごと隠せるようにする。端末ごとの設定で、
// 家族では共有しない（片方だけ見学の準備をしていることもあるため）。
// 未設定のときは出す（これまで使っていた人の入口が黙って消えないように）。

const KEY = 'hokatsu.visible';

export async function readHokatsuVisible(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'false';
  } catch {
    return true;
  }
}

export async function writeHokatsuVisible(visible: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, visible ? 'true' : 'false');
  } catch {
    // 保存できなくてもこの場の表示は切り替わる。次に開いたときは元に戻るだけ。
  }
}
