import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { colors } from '@/lib/theme';

// App Distributionで更新したあと、実機に入っているのが本当に最新のビルドか
// 見た目だけでは分からないので、コミットのSHAを出して見比べられるようにする。
// EXPO_PUBLIC_BUILD_SHA はCI（.github/workflows/mobile-apk.yml）がビルド時に
// 埋め込む。手元でnpm start（Expo Go）したときは未設定なので出さない。
const buildSha = (process.env.EXPO_PUBLIC_BUILD_SHA ?? '').slice(0, 7);

export default function VersionInfo() {
  const version = Constants.expoConfig?.version ?? '?';

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        バージョン {version}
        {buildSha !== '' ? `（ビルド ${buildSha}）` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: 4, paddingBottom: 12 },
  text: { fontSize: 11, color: colors.textFaint },
});
