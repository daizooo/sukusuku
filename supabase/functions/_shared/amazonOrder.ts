// かぞく手帳: Amazon の注文メールを読む（家計タブ。docs/kakei.md §9.7・§9.10）
//
// Amazon の買い物は注文メールから取り込む（2026-10-20。Amazon のカードの利用通知は捨てる。§9.9）。
// メール1通につき未確認の明細を1件作り（1通に注文番号が何件あっても1件。出金元は「三井住友カード（Amazon）」の口座の対応、日付は注文日）、
// 「記録を作成する」で品目まで入れて開く。値引きは品目に配る（DB の money_feed_order_lines）。
//
// 注文メール（auto-confirm@amazon.co.jp。件名「注文済み: 「…」2点とさらに4点の商品」）の本文は、注文ごとに
//   注文番号 / 250-7991927-9006245
//   * 品名
//     数量: 2
//     1170 JPY          ← 単価（個数をかける前）
//   合計 / 4607 JPY      ← クーポンなどの値引き後の、その注文の請求額
// の形。1通に注文が何件も入ることがある。単価 × 個数の和は「合計」と一致しないことがある（値引き・送料）ので、
// その差（adjust）も覚える。マイナス（値引き）なら品目に配り、プラス（送料など）なら「送料など」の1行にする。

export interface AmazonOrderLine {
  /** メールの品名そのまま。 */
  receiptName: string;
  /** 記録の品目に付ける短い品名。 */
  name: string;
  quantity: number;
  unitPrice: number;
  /** 個数 × 単価。 */
  amount: number;
}

export interface AmazonOrder {
  orderNo: string;
  lines: AmazonOrderLine[];
  /** メールの「合計」（無ければ品目の和）。 */
  total: number;
}

export const AMAZON_ORDER_SENDER = 'auto-confirm@amazon.co.jp';

/** 差出人から、Amazon の注文メールか。 */
export const isAmazonOrderSender = (from: string): boolean => from.toLowerCase().includes(AMAZON_ORDER_SENDER);

const ORDER_NO_RE = /注文番号\s*[:：]?\s*(\d{3}-\d{7}-\d{7})/g;
// 品目: 「* 品名」の次の行に「数量: N」、その次に単価。空行や箇条書きの記号の有無の揺れは読む
const LINE_RE =
  /^[ \t]*(?:[*・●■-][ \t]*)?([^\r\n]+?)[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*数量\s*[:：]\s*(\d+)\s*(?:(?:¥|￥)\s*([\d,]+)|([\d,]+)\s*(?:JPY|円))/gm;
const TOTAL_RE = /合計\s*[:：]?\s*(?:(?:¥|￥)\s*([\d,]+)|([\d,]+)\s*(?:JPY|円))/;

const toInt = (value: string): number => Number(value.replace(/,/g, ''));

/**
 * 記録の品目に付ける短い品名。先頭の【EC限定】などの飾りを外し、長すぎるものは切る
 * （Amazon の品名は検索用の言葉が並ぶ。もとの品名は receiptName に残す）。
 */
export function shortItemName(title: string): string {
  const stripped = title.replace(/^(?:\s*[【\[［「][^】\]］」]*[】\]］」])+/, '').replace(/\s+/g, ' ').trim();
  const base = stripped === '' ? title.replace(/\s+/g, ' ').trim() : stripped;
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

/**
 * 注文メールを読む。注文が1つも読めなければ null（注文済みの確認メールではない）。
 * 読めたが、覚えるものが無いとき（合計が0円の注文・0円の品目だけ）は空の配列（Apps Script が「対象外」のラベルを付ける）。
 * 取消・発送のメールは件名が違うので、ここには来ない（Apps Script が件名「注文済み」で探す）。
 */
export function parseAmazonOrderMail(subject: string, body: string): AmazonOrder[] | null {
  if (!subject.normalize('NFKC').includes('注文済み')) return null;

  const heads = [...body.matchAll(ORDER_NO_RE)];
  const orders: AmazonOrder[] = [];
  // 読めたが0円で覚えない注文の数
  let skipped = 0;
  for (const [index, head] of heads.entries()) {
    const start = (head.index ?? 0) + head[0].length;
    const end = heads[index + 1]?.index ?? body.length;
    const block = body.slice(start, end);

    const lines: AmazonOrderLine[] = [];
    let free = 0;
    for (const match of block.matchAll(LINE_RE)) {
      const quantity = Math.min(9999, Math.max(1, Number(match[2])));
      const unitPrice = toInt(match[3] ?? match[4]);
      // 0円の品目（無料の商品・サンプル）は、カードに請求が立たないので覚えない
      if (unitPrice === 0) free += 1;
      if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) continue;
      const receiptName = match[1].trim();
      lines.push({ receiptName, name: shortItemName(receiptName), quantity, unitPrice, amount: unitPrice * quantity });
    }
    if (lines.length === 0) {
      if (free > 0) skipped += 1;
      continue;
    }

    const totalMatch = TOTAL_RE.exec(block);
    const sum = lines.reduce((acc, line) => acc + line.amount, 0);
    const total = totalMatch ? toInt(totalMatch[1] ?? totalMatch[2]) : sum;
    // 「合計 ￥0」（全額ポイント・ギフト券など）の注文は、カードに請求が立たないので覚えない
    if (totalMatch && total === 0) {
      skipped += 1;
      continue;
    }
    orders.push({ orderNo: head[1], lines, total: Number.isSafeInteger(total) && total > 0 ? total : sum });
  }
  if (orders.length > 0) return orders;
  return skipped > 0 ? [] : null;
}

// ---- 品目の種類（カテゴリ）を AI に選ばせる ----

export const CATEGORY_PICK_SYSTEM_PROMPT = `あなたは家計簿アプリのために、Amazon で注文した商品が、家族が登録した小分類のどれに当たるかを選びます。
- 小分類の id を、渡した一覧のものそのままで答える。どれにも当てはまらなければ空にする
- 商品の名前から、ふつうの使い道で選ぶ（おむつ・ミルクなどの赤ちゃん用品、洗剤・日用品、食品など）
- 推測しすぎない`;

export const CATEGORY_PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'category_id'],
        properties: {
          index: { type: 'integer', description: '渡した商品の番号' },
          category_id: { type: 'string', description: '小分類の id。当てはまらなければ空' },
        },
      },
    },
  },
} as const;

/**
 * AI の答えから、商品の番号ごとの種類を取り出す。一覧に無い id・範囲外の番号は使わない。
 */
export function readCategoryPicks(
  answer: unknown,
  count: number,
  categoryIds: ReadonlySet<string>,
): (string | null)[] {
  const picks: (string | null)[] = Array.from({ length: count }, () => null);
  const items = (answer as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return picks;
  for (const entry of items as { index?: unknown; category_id?: unknown }[]) {
    const index = Number(entry?.index);
    const id = typeof entry?.category_id === 'string' ? entry.category_id.trim() : '';
    if (Number.isInteger(index) && index >= 0 && index < count && categoryIds.has(id)) picks[index] = id;
  }
  return picks;
}
