// かぞく手帳: カード会社の利用通知メールを読む（家計タブ。docs/kakei.md §9.6）
//
// 三井住友カード（statement@vpass.ne.jp）: 本文に「ご利用カード：」「◇利用日：2026/10/15 13:51」「◇利用先：…」「◇利用金額：4,415円」
// 楽天カード（…@mail.rakuten-card.co.jp）: 本文に「■利用日: 2026/10/15」「■利用先: …」「■利用金額: 1,234 円」。1通に何件も入ることがある
// どちらも「承認照会」の通知で、確定した請求ではない（額が変わる・届かない利用がある）。
//
// 口座名（account_name）は、取り込みの「口座の対応」で出金元に結ぶ名前。三井住友カードは、ご利用カードの名前をそのまま使う
// （「Ｏｌｉｖｅ／クレジット」「三井住友カードＶＩＳＡ（ＮＬ）」など。2026-10-20に決定。以前は Amazon とそれ以外の2つだった）。
//
// 取り込まない利用通知（isDiscardedCardMail。2026-10-20に決定。docs/kakei.md §9.9）:
//   Amazon のカード・楽天カードの利用通知。Amazon・楽天市場の買い物は注文メールから取り込むので、二重になる。
//   「一定金額に到達」の知らせ（利用の明細ではない）。

export interface CardMailEntry {
  accountName: string;
  occurredOn: string; // YYYY-MM-DD
  amount: number;
  /** 利用先（カード会社の表記。ローマ字が多い）。 */
  merchant: string;
}

export const SMBC_ACCOUNT = '三井住友カード';
export const RAKUTEN_ACCOUNT = '楽天カード';

/** 差出人から、カードの利用通知か（どのカード会社か）。 */
export function cardIssuerOf(from: string): 'smbc' | 'rakuten' | null {
  const address = from.toLowerCase();
  if (address.includes('vpass.ne.jp')) return 'smbc';
  if (address.includes('rakuten-card.co.jp')) return 'rakuten';
  return null;
}

/** 三井住友カードの「ご利用カード：」の名前（全角のまま）。無ければ「三井住友カード」。 */
export function smbcCardName(body: string): string {
  return /ご利用カード\s*[:：]\s*([^\r\n]*)/.exec(body)?.[1].trim() || SMBC_ACCOUNT;
}

/** 取り込まない利用通知か（Amazon のカード・楽天カード・「一定金額に到達」）。読んだうえで「対象外」にする。 */
export function isDiscardedCardMail(from: string, subject: string, body: string): boolean {
  const issuer = cardIssuerOf(from);
  if (issuer === 'rakuten') return true;
  if (issuer !== 'smbc') return false;
  const title = subject.normalize('NFKC');
  if (/一定(の)?金額/.test(title)) return true;
  return /amazon/i.test(`${smbcCardName(body).normalize('NFKC')} ${title}`);
}

const ENTRY_RE =
  /利用日\s*[:：]\s*(\d{4})\s*[\/年.-]\s*(\d{1,2})\s*[\/月.-]\s*(\d{1,2})[\s\S]*?利用先\s*[:：]\s*([^\r\n]*)[\s\S]*?利用金額\s*[:：]\s*([\d,]+)\s*円/g;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * 利用通知メールを読む。利用の行が1つも読めない・取消の通知は null（「読めない」として残し、人が片づける）。
 */
export function parseCardMail(from: string, subject: string, body: string): CardMailEntry[] | null {
  const issuer = cardIssuerOf(from);
  if (issuer === null) return null;
  const text = body.normalize('NFKC');
  if (subject.normalize('NFKC').includes('取消')) return null;

  const accountName = issuer === 'smbc' ? smbcCardName(body) : RAKUTEN_ACCOUNT;

  const entries: CardMailEntry[] = [];
  for (const match of text.matchAll(ENTRY_RE)) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    const amount = Number(match[5].replace(/,/g, ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    entries.push({
      accountName,
      occurredOn: `${year}-${pad(month)}-${pad(day)}`,
      amount,
      merchant: match[4].replace(/\s+/g, ' ').trim().slice(0, 200),
    });
  }
  return entries.length > 0 ? entries : null;
}

// ---- 利用先（ローマ字）と登録したお店を当てる ----

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'si', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'zi', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'ti', つ: 'tu', て: 'te', と: 'to', だ: 'da', ぢ: 'zi', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'hu', へ: 'he', ほ: 'ho', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'bu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
};

/**
 * ローマ字の書き方の違いをそろえる（ヘボン式と訓令式・「じょ」を JO と JIYO・長音・撥音）。
 * カード会社の表記は「城南店」が JIYONANTEN（小さい「ょ」を YO と書く）のように揺れるので、両側をこの形にして比べる。
 */
export function canonicalRomaji(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/sh/g, 'sy')
    .replace(/ch/g, 'ty')
    .replace(/ts/g, 't')
    .replace(/j/g, 'zy')
    .replace(/f/g, 'h')
    .replace(/(sy|ty|zy)i/g, (_m, c: string) => `${c[0]}i`)
    .replace(/([kgsztdnhbpmr])y([aou])/g, '$1iy$2')
    .replace(/m([bmp])/g, 'n$1')
    .replace(/ou|oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/nn/g, 'n')
    .replace(/([bcdfghjklmpqrstvwxyz])\1/g, '$1');
}

/** ひらがな・カタカナ・英字だけの名前をローマ字にする（ほかの文字が入っていれば null）。 */
export function romajiOf(name: string): string | null {
  let out = '';
  for (const char of name.normalize('NFKC')) {
    const code = char.codePointAt(0)!;
    const hira = code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
    if (/[a-zA-Z]/.test(hira)) out += hira;
    else if (hira === 'っ' || hira === 'ー' || /[\s\p{P}\p{S}\d]/u.test(hira)) continue;
    else if (KANA[hira] !== undefined) out += KANA[hira];
    else return null;
  }
  return out;
}

/**
 * 利用先（ローマ字）に当たる登録したお店。お店の名前をローマ字にして、利用先がその名前で始まるか同じなら当たり。
 * いちばん長く当たるもの。ひらがな・カタカナ・英字だけの名前が対象（漢字の入ったお店は AI に任せる）。3文字未満の名前は使わない。
 */
export function matchStoreByRomaji(merchant: string, stores: readonly string[]): string | null {
  const target = canonicalRomaji(merchant);
  if (target === '') return null;
  let best: { store: string; length: number } | null = null;
  for (const store of stores) {
    const romaji = romajiOf(store);
    if (romaji === null) continue;
    const key = canonicalRomaji(romaji);
    if (key.length < 3 || !target.startsWith(key)) continue;
    if (best === null || key.length > best.length) best = { store, length: key.length };
  }
  return best?.store ?? null;
}

/** 漢字の入ったお店を AI に選ばせるときの指示。答えは一覧の名前そのままか空。 */
export const STORE_PICK_SYSTEM_PROMPT = `あなたは家計簿アプリのために、クレジットカードの利用通知の「利用先」の表記（ローマ字・略称・カード会社の表記）が、
家族が登録したお店の一覧のどれに当たるかを選びます。
- 一覧にあるお店の名前をそのまま答える。同じお店（チェーンの別の店舗を含む）と言えるものが無ければ空にする
- 推測しすぎない。名前の読みや綴りが合うときだけ選ぶ`;

export const STORE_PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store'],
  properties: { store: { type: 'string', description: '一覧のお店の名前そのまま。当たらなければ空' } },
} as const;
