import { StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import { BUILD_COMMIT, BUILD_NUMBER } from '@/lib/buildInfo';
import { colors } from '@/lib/theme';

// App Distributionで更新したあと、実機に入っているのが本当に最新のビルドか
// 見た目だけでは分からないので、ここで確かめられるようにする。
//
// 出すのは2つ。どちらか片方では「最新かどうか」を確かめきれない。
//
//   ビルド番号 … OSのパッケージ情報(versionCode)をそのまま読む。Firebase App
//                Distributionや端末の「アプリ情報」に出ているのと同じ数字。
//                expo-applicationはネイティブモジュールなので、JSバンドルの
//                作り直しに関わらず必ず入っている .apk の値になる。
//   コミット   … その .apk がどのコミットから作られたか。ビルド番号
//                （ワークフローの実行回数）はコミットと結び付かないため、
//                期待した変更が入っているかはこちらでしか確かめられない。
export default function VersionInfo() {
  const version = Application.nativeApplicationVersion ?? '?';
  // OSが持つ値。入っている .apk そのものの番号。
  const nativeBuild = Application.nativeBuildVersion;
  // JSバンドル側に焼いた値（src/lib/buildInfo.ts）。
  // 2つが食い違うのは、古いJSバンドルが再利用された .apk が入っているとき
  // （PR #133 で起きたのがこれ）。黙って古い目印を出さず、そうと分かるようにする。
  const isStaleBundle = nativeBuild !== null && BUILD_NUMBER !== 'dev' && nativeBuild !== BUILD_NUMBER;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        バージョン {version}
        {nativeBuild ? `（ビルド ${nativeBuild}・${BUILD_COMMIT}）` : `（${BUILD_COMMIT}）`}
      </Text>
      {isStaleBundle && (
        <Text style={styles.text}>※画面側はビルド {BUILD_NUMBER} のままです</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: 4, paddingBottom: 12 },
  text: { fontSize: 11, color: colors.textFaint },
});
