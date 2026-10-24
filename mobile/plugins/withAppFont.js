// アプリの文字を M PLUS 1p にする（2026-10-24）。Android だけ（このアプリは Android 版だけを出している）。
//
// assets/fonts の太さごとのファイルを res/font に写し、1つのフォントファミリー（XML）にまとめて
// ReactFontManager に "MPLUS1p" の名前で登録する。こうすると style の fontWeight（400〜800）で太さが選ばれる。
// 600 のファイルは無いので、近い太さ（500 か 700）になる。
// 既定のフォントにするのは patches/react-native+0.81.5.patch（Text・TextInput の style の先頭に fontFamily を足す）。
// expo-font の設定プラグインと同じ仕組みを、依存を増やさずに書いたもの。
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainApplication } = require('expo/config-plugins');

const FAMILY = 'MPLUS1p';
const RESOURCE = 'xml_mplus1p';
const FONTS = [
  { file: 'MPLUS1p-Regular.ttf', weight: 400 },
  { file: 'MPLUS1p-Medium.ttf', weight: 500 },
  { file: 'MPLUS1p-Bold.ttf', weight: 700 },
  { file: 'MPLUS1p-ExtraBold.ttf', weight: 800 },
];

// res/font のファイル名は小文字・数字・_ だけ。
const resourceName = (file) => path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_]/g, '_');

function fontFamilyXml() {
  const fonts = FONTS.map(
    ({ file, weight }) =>
      `    <font app:font="@font/${resourceName(file)}" app:fontStyle="normal" app:fontWeight="${weight}" />`,
  ).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<font-family xmlns:app="http://schemas.android.com/apk/res-auto">
${fonts}
</font-family>
`;
}

const withFontResources = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const fontDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/font');
      fs.mkdirSync(fontDir, { recursive: true });
      for (const { file } of FONTS) {
        fs.copyFileSync(
          path.join(config.modRequest.projectRoot, 'assets/fonts', file),
          path.join(fontDir, `${resourceName(file)}.ttf`),
        );
      }
      fs.writeFileSync(path.join(fontDir, `${RESOURCE}.xml`), fontFamilyXml());
      return config;
    },
  ]);

const withFontRegistration = (config) =>
  withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(`R.font.${RESOURCE}`)) return config;
    if (config.modResults.language !== 'kt') {
      throw new Error('withAppFont: MainApplication が Kotlin ではない');
    }
    contents = contents.replace(
      /^(package [^\n]+\n)/,
      `$1\nimport com.facebook.react.common.assets.ReactFontManager\n`,
    );
    if (!/super\.onCreate\(\)\n/.test(contents)) {
      throw new Error('withAppFont: MainApplication に super.onCreate() が見つからない');
    }
    contents = contents.replace(
      /super\.onCreate\(\)\n/,
      `super.onCreate()\n    ReactFontManager.getInstance().addCustomFont(this, "${FAMILY}", R.font.${RESOURCE})\n`,
    );
    config.modResults.contents = contents;
    return config;
  });

module.exports = (config) => withFontRegistration(withFontResources(config));
