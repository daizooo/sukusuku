// 実行: npm run test:card-mail
import assert from 'node:assert/strict';

import {
  canonicalRomaji,
  cardIssuerOf,
  isDiscardedCardMail,
  matchStoreByRomaji,
  parseCardMail,
  RAKUTEN_ACCOUNT,
  romajiOf,
  SMBC_ACCOUNT,
  smbcCardName,
} from './cardMail.ts';

// 2026-10-15に届いた三井住友カード（家族カード）の通知の形（宛名は伏せた）
const smbcSubject = '家族カードご利用のお知らせ【三井住友カード】';
const smbcBody = `○○　様

いつも三井住友カードをご利用頂きありがとうございます。
ご家族会員さまのカードご利用内容をお知らせいたします。'

ご利用カード：三井住友カードＶＩＳＡ（ＮＬ）

◇利用日：2026/10/15 13:51
◇利用先：YOKAMONNE JIYONANTEN
◇利用取引：買物
◇利用金額：4,415円

ご利用内容について、万が一身に覚えのない場合は、以下URLにてお問い合わせ先のご案内をしております。`;

assert.equal(cardIssuerOf('三井住友カード <statement@vpass.ne.jp>'), 'smbc');
assert.equal(cardIssuerOf('info@mail.rakuten-card.co.jp'), 'rakuten');
assert.equal(cardIssuerOf('info@zaim.net'), null);

assert.deepEqual(parseCardMail('statement@vpass.ne.jp', smbcSubject, smbcBody), [
  { accountName: '三井住友カードＶＩＳＡ（ＮＬ）', occurredOn: '2026-10-15', amount: 4415, merchant: 'YOKAMONNE JIYONANTEN' },
]);
// 口座名はご利用カードの名前そのまま（全角のまま）。無ければ「三井住友カード」
const oliveBody = smbcBody.replace('三井住友カードＶＩＳＡ（ＮＬ）', 'Ｏｌｉｖｅ／クレジット');
assert.equal(parseCardMail('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】', oliveBody)?.[0].accountName, 'Ｏｌｉｖｅ／クレジット');
assert.equal(smbcCardName('ご利用カード:Ｏｌｉｖｅ／デビット\n'), 'Ｏｌｉｖｅ／デビット');
assert.equal(smbcCardName(smbcBody.replace(/ご利用カード：.*\n/, '')), SMBC_ACCOUNT);

// 取り込まない利用通知: Amazon のカード・楽天カード・「一定金額に到達」
const amazonBody = smbcBody.replace('三井住友カードＶＩＳＡ（ＮＬ）', 'Ａｍａｚｏｎ　Ｍａｓｔｅｒｃａｒｄ');
assert.equal(isDiscardedCardMail('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】', amazonBody), true);
assert.equal(isDiscardedCardMail('info@mail.rakuten-card.co.jp', 'カード利用のお知らせ(本人ご利用分)', ''), true);
assert.equal(isDiscardedCardMail('statement@vpass.ne.jp', 'ご利用金額が一定金額に到達しました【三井住友カード】', ''), true);
assert.equal(isDiscardedCardMail('statement@vpass.ne.jp', smbcSubject, smbcBody), false);
assert.equal(isDiscardedCardMail('statement@vpass.ne.jp', 'ご利用のお知らせ【三井住友カード】', oliveBody), false);
assert.equal(isDiscardedCardMail('info@zaim.net', smbcSubject, amazonBody), false);
// 取消・利用の行が無いメールは読めない
assert.equal(parseCardMail('statement@vpass.ne.jp', 'ご利用取消のお知らせ【三井住友カード】', smbcBody), null);
assert.equal(parseCardMail('statement@vpass.ne.jp', 'ETCカード追加お申し込み受付のお知らせ', 'お申し込みを受付いたしました'), null);
assert.equal(parseCardMail('info@zaim.net', smbcSubject, smbcBody), null);

// 楽天カード: 1通に何件も入る形（半角・全角のコロンの揺れも読む）
const rakutenBody = `カード利用お知らせメール
《ショッピングご利用分》
■利用日: 2026/10/14
■利用先: 楽天市場
■利用者: 本人
■支払方法: 1回
■利用金額: 3,280 円
■支払月: 2026/11

■利用日：2026/10/15
■利用先：ラクテンモバイル
■利用者：本人
■支払方法：1回
■利用金額：1,078 円`;
assert.deepEqual(parseCardMail('info@mail.rakuten-card.co.jp', 'カード利用のお知らせ(本人ご利用分)', rakutenBody), [
  { accountName: RAKUTEN_ACCOUNT, occurredOn: '2026-10-14', amount: 3280, merchant: '楽天市場' },
  { accountName: RAKUTEN_ACCOUNT, occurredOn: '2026-10-15', amount: 1078, merchant: 'ラクテンモバイル' },
]);

// ローマ字のそろえ方
assert.equal(romajiOf('よかもんね'), 'yokamonne');
assert.equal(romajiOf('ヨカモンネ'), 'yokamonne');
assert.equal(romajiOf('業務スーパー'), null, '漢字の入った名前は対象外');
assert.equal(canonicalRomaji('JIYONANTEN'), canonicalRomaji(romajiOf('じょうなんてん')!), '小さい「ょ」の JIYO と長音');
assert.equal(canonicalRomaji('JONANTEN'), canonicalRomaji('JIYONANTEN'));
assert.equal(canonicalRomaji('SHIMAMURA'), canonicalRomaji(romajiOf('しまむら')!));
assert.equal(canonicalRomaji('TSURUHA'), canonicalRomaji(romajiOf('ツルハ')!));
assert.equal(canonicalRomaji('KITTE'), canonicalRomaji(romajiOf('きって')!));

// 登録したお店に当てる
const stores = ['よかもんね', 'しまむら', '業務スーパー', 'ゆめタウン', 'AEON'];
assert.equal(matchStoreByRomaji('YOKAMONNE JIYONANTEN', stores), 'よかもんね');
assert.equal(matchStoreByRomaji('SHIMAMURA KUMAMOTO', stores), 'しまむら');
assert.equal(matchStoreByRomaji('YUMETOWN HIKARINOMORI', stores), null, 'ゆめタウン（YUMETAUN）とローマ字の綴りが違うものは AI に任せる');
assert.equal(matchStoreByRomaji('AEON KUMAMOTO', stores), 'AEON');
assert.equal(matchStoreByRomaji('GYOMU SUPER', stores), null, '漢字の入ったお店は当てない');
assert.equal(matchStoreByRomaji('', stores), null);
assert.equal(matchStoreByRomaji('MOS BURGER', ['も']), null, '短すぎる名前では当てない');

console.log('cardMail: ok');
