import { StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import { colors } from '@/lib/theme';

// App Distributionで更新したあと、実機に入っているのが本当に最新のビルドか
// 見た目だけでは分からないので、versionCode（Firebase App Distributionや
// 端末の「アプリ情報」で見えているのと同じ数字）をそのまま出す。
//
// 以前はexpo-constantsのConstants.expoConfigから読んでいたが、versionCode 88
// が実際に入っている実機で確かめても値が反映されず原因を特定できなかった。
// expo-applicationはOSのパッケージ情報（PackageInfo.versionCode）を直接読む
// ネイティブモジュールで、ビルド時の埋め込みに頼らない。
export default function VersionInfo() {
  const version = Application.nativeApplicationVersion ?? '?';
  const versionCode = Application.nativeBuildVersion;

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
