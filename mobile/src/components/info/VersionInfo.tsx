import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { colors } from '@/lib/theme';

// App Distributionで更新したあと、実機に入っているのが本当に最新のビルドか
// 見た目だけでは分からないので、versionCode（Firebase App Distributionや
// 端末の「アプリ情報」で見えているのと同じ数字）をそのまま出す。
//
// 以前はコミットのSHAをJSへ埋め込んでいたが、Gradle Build Cacheを有効化した
// 後（.github/workflows/mobile-apk.yml）、ソースコードが変わらないビルドでは
// JSバンドルがキャッシュから再利用され、SHAが更新されないことがあった。
// versionCodeはexpo prebuildがandroid/を毎回作り直す際にネイティブ側へ直接
// 焼き込まれる値で、このキャッシュの影響を受けない。
export default function VersionInfo() {
  const version = Constants.expoConfig?.version ?? '?';
  const versionCode = Constants.expoConfig?.android?.versionCode;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        バージョン {version}
        {versionCode ? `（ビルド ${versionCode}）` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: 4, paddingBottom: 12 },
  text: { fontSize: 11, color: colors.textFaint },
});
