import { Redirect } from 'expo-router';

// アプリを開いたときの入口。PWA版と同じくホームタブから始める
// （src/app/page.tsx の initialTab）。
export default function Index() {
  return <Redirect href="/home" />;
}
