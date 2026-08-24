import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/session';
import { useNursingAlarmWatcher } from '@/lib/nursingTimer';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  // 端末に控えた計測を読み戻し、前面サービスへ預け直す。どの画面を開いていても要るので、
  // アプリの一番外側で1回だけ動かす。
  useNursingAlarmWatcher();

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
