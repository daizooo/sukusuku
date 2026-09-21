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
//
// **2つを1行にまとめない。** 1行に続けて出していたときは、端末では
// 「バージョン 0.1.0（ビルド 92・」までで切れてコミットが読めなかった。
// 行を分ければ、横幅がどれだけ狭くてもどちらの値も最後まで出る。
//
// 行を分けてもまだ「（ビルド」「コミット」のあとが空で出ていた。原因は
// レイアウトではなく、fontWeight を指定していなかったこと（534e9e8）。
// このリポジトリでは「幅が内容で決まる文字で fontWeight 未指定のものだけが
// 欠ける／数字・英字を含むと欠ける」と分かっており、ここはその両方に当たる。
// **数字を出す文字には必ず太さを入れること。**
export default function VersionInfo() {
  const version = Application.nativeApplicationVersion ?? '?';
  // OSが持つ値。入っている .apk そのものの番号。
  const nativeBuild = Application.nativeBuildVersion;
  // JSバンドル側に焼いた値（src/lib/buildInfo.ts）。
  // 2つが食い違うのは、古いJSバンドルが再利用された .apk が入っているとき
  // （PR #133 で起きたのがこれ）。黙って古い目印を出さず、そうと分かるようにする。
  const isStaleBundle =
    nativeBuild !== null && BUILD_NUMBER !== 'dev' && nativeBuild !== BUILD_NUMBER;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        バージョン {version}
        {nativeBuild ? `（ビルド ${nativeBuild}）` : ''}
      </Text>
      <Text style={styles.text}>コミット {BUILD_COMMIT}</Text>
      {isStaleBundle && (
        <Text style={styles.text}>※画面側はビルド {BUILD_NUMBER} のままです</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // 横幅いっぱいに置いたうえで中央に寄せる。親の幅に合わせて縮められると、
  // 中の文字が途中で切れてしまうため。
  container: { alignSelf: 'stretch', alignItems: 'center', gap: 2, paddingTop: 4, paddingBottom: 12 },
  // fontWeight は必須。指定が無いとAndroidが幅を測り損ね、数字と英字が
  // 末尾から欠ける（534e9e8。このファイルはそれで3回作り直している）。
  text: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
});
