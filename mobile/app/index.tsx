import { Redirect } from 'expo-router';

// アプリを開いたときの入口。
//
// PWA版はホームから始まる（src/app/page.tsx の initialTab）。こちらはホームタブを
// まだ作っていないため、当面は中身のある記録タブへ送る。ホームを作ったらそちらへ変える。
export default function Index() {
  return <Redirect href="/log" />;
}
