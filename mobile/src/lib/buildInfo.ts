// 端末に入っているのが「どのコミットの .apk か」を設定タブで確かめるための目印。
//
// このファイルの中身はCIが .apk を作る前に書き換える
// （.github/workflows/mobile-apk.yml の「ビルドの目印を書き出す」）。
// 手元のビルドでは書き換わらないので 'dev' のまま。
//
// 環境変数で渡すやり方（PR #133）はうまくいかなかった。Gradle Build Cache は
// 環境変数を鍵に含めないため、ソースが変わらないビルドでは古いJSバンドルが
// そのまま再利用され、目印が更新されなかった。**ソースファイルなら中身が
// 変わった時点でバンドルの作り直しになる**ので、同じ取りこぼしが起きない。

/** ビルドのもとになったコミット（短縮SHA）。 */
export const BUILD_COMMIT: string = 'dev';

/**
 * ビルドの通し番号。versionCode と同じ値をJS側にも持たせている。
 * OSが持つ versionCode（expo-application）と食い違ったら、入っている .apk と
 * 画面のJSがずれている（古いバンドルが再利用された）ことがその場で分かる。
 */
export const BUILD_NUMBER: string = 'dev';
