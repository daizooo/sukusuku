// かぞく手帳: Amazon の注文メールを読み、カードの利用通知（Amazon）に品目を割り振る（家計タブ。docs/kakei.md §9.7）
//
// Amazon は注文した日ではなく発送した日にカードへ請求が立つ。メールは「注文メール → カードの利用通知」の順に届く。
// 1回の注文でも発送が分かれると、利用通知は何通かに分かれる（A500円・B300円・C250円の注文に、500円と550円の2通、など）。
// そこで注文メールの品目（品名・個数・単価）を覚えておき、利用通知の額に合う品目を割り振って記録にする。
// クーポン・定期おトク便などの値引きは商品ごとに掛かり、どの商品かは注文メールに出ない。注文メールの合計と品目の和の差を「値引きの予算」として、請求との差がその範囲に収まる組み合わせを当てる。
//
// 注文メール（auto-confirm@amazon.co.jp。件名「注文済み: 「…」2点とさらに4点の商品」）の本文は、注文ごとに
//   注文番号 / 250-7991927-9006245
//   * 品名
//     数量: 2
//     1170 JPY          ← 単価（個数をかける前）
//   合計 / 4607 JPY      ← クーポンなどの値引き後の、その注文の請求額
// の形。1通に注文が何件も入ることがある。単価 × 個数の和は「合計」と一致しないことがある（値引き・送料）ので、
// その差（adjust）も覚える。マイナス（クーポンなどの値引き）なら値引きの予算、プラス（送料など）なら残りの全部をまとめた請求に足す額として使う。

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

/** カードの利用が Amazon か（利用先の表記、またはカード名に Amazon が入っている）。 */
export const isAmazonCharge = (merchant: string, accountName: string): boolean =>
  /amazon|アマゾン/i.test(`${merchant} ${accountName}`.normalize('NFKC'));

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

// ---- カードの利用通知への割り振り ----

export interface OpenAmazonOrder {
  orderId: string;
  /** 注文した日（古い注文から当てる）。 */
  orderedOn: string;
  /**
   * 残りの値引きの予算。注文メールの「合計」が品目の和より安いぶん（クーポン・定期おトク便など）から、これまでの請求に割り振った値引きを引いたもの。
   * 値引きは**商品ごと**に掛かる（実物: 定期おトク便のアタックだけが 1,379円 → 1,241円。ほかの商品は値引きなし）。
   * どの商品に掛かるかは注文メールに出ないので、「発送の値引き ＝ 品目の和 − 請求」が 0 以上・残りの予算以下、という条件で当てる。
   */
  discountLeft: number;
  /** 送料などの上乗せ（注文メールの合計が品目の和より高いぶん）。無ければ 0。残りの全部をまとめた請求に足す。 */
  fee: number;
  /** fee をまだ使っていないか。 */
  feeOpen: boolean;
  /** まだ記録に割り振っていない品目（注文メールの並び順）。 */
  lines: { id: string; amount: number; position: number }[];
}

export interface AmazonMatch {
  orderId: string;
  lineIds: string[];
  /** 送料などの上乗せ（fee）も一緒に請求された。 */
  withFee: boolean;
  /** この請求の値引き額（品目の和 −（請求 − 送料など））。値引きが無ければ 0。 */
  discount: number;
}

/**
 * 注文メールの値引きの予算を超える値引き（Amazon ポイントの利用など。額は載らない）として許す上限（品目の和に対する、超えたぶんの割合）。
 * 注文メールにも発送メールにもポイントの利用額は出ない（「注文時にポイント残高から差し引かれます」とあるだけ）。これを超える差は別の請求とみなし当てない。
 */
export const MAX_UNKNOWN_DISCOUNT = 0.2;

/** 品目の組み合わせを数え上げる上限（これより多い注文は、残りの全部だけを当てる）。 */
const MAX_SUBSET_LINES = 16;

interface Subset {
  lineIds: string[];
  /** 品目の和（値引き前）。 */
  base: number;
  /** 注文の残りの全部か。 */
  all: boolean;
}

/** 注文の、割り振っていない品目の組み合わせ（数え上げられない大きな注文は、残りの全部だけ）。 */
function subsetsOf(order: OpenAmazonOrder): Subset[] {
  const lines = [...order.lines].sort((a, b) => a.position - b.position);
  if (lines.length === 0) return [];
  const make = (chosen: typeof lines): Subset => ({
    lineIds: chosen.map((line) => line.id),
    base: chosen.reduce((acc, line) => acc + line.amount, 0),
    all: chosen.length === lines.length,
  });
  if (lines.length > MAX_SUBSET_LINES) return [make(lines)];
  return Array.from({ length: (1 << lines.length) - 1 }, (_, i) => make(lines.filter((_, j) => (i + 1) & (1 << j))));
}

/** 送料などを足す場合の選択肢（足さない・足す）。 */
const feeOptions = (order: OpenAmazonOrder, subset: Subset): number[] =>
  subset.all && order.feeOpen && order.fee > 0 ? [0, order.fee] : [0];

/**
 * カードの請求額に合う品目の組み合わせを探す（同じ注文の中で。注文をまたぐ組み合わせは当てない）。
 * 組み合わせ S の値引き δ ＝（S の品目の和）−（請求 − 送料など）を考える。次の順に見て、最初に当たったものを使う。
 *   ① δ = 0（値引きなしで、額が合う）。古い注文・先に並んだ品目から。同じ額になる組み合わせが複数あるときは、注文メールで先に並んだ品目
 *      （額は合うので、違っていれば人が品目を直す）
 *   ② 0 < δ ≤ 残りの値引きの予算（discountLeft）。値引きのある商品が当たる。**額の違う候補が複数あれば、当てない**（紛れるので未確認に回す）
 *   ③ δ が予算を超える（ポイントの利用など）。超えたぶんが品目の和の MAX_UNKNOWN_DISCOUNT 以下の候補のうち、超えた割合がいちばん小さいもの。
 *      ただし**額の違う別の候補が、割合で2倍以内に並ぶときは当てない**
 * 注文の残りの全部を請求するときは、値引きの予算を使い切るはずなので、δ が予算より小さいものは外す（δ ＝ 予算なら②、超えれば③）。
 * δ < 0（請求の方が品目の和より高い）は当てない。当たらなければ null（今までどおり未確認に回す）。
 */
export function matchAmazonCharge(amount: number, orders: readonly OpenAmazonOrder[]): AmazonMatch | null {
  const sorted = [...orders].sort((a, b) => a.orderedOn.localeCompare(b.orderedOn) || a.orderId.localeCompare(b.orderId));

  interface Candidate extends AmazonMatch {
    base: number;
    /** 予算を超えたぶんの、品目の和に対する割合（予算内は 0）。 */
    ratio: number;
  }
  const exact: Candidate[] = [];
  const inBudget: Candidate[] = [];
  const beyond: Candidate[] = [];
  for (const order of sorted) {
    for (const subset of subsetsOf(order)) {
      for (const fee of feeOptions(order, subset)) {
        const paid = amount - fee;
        const discount = subset.base - paid;
        if (paid <= 0 || discount < 0) continue;
        if (subset.all && discount < order.discountLeft) continue;
        const excess = discount - order.discountLeft;
        const candidate: Candidate = {
          orderId: order.orderId,
          lineIds: subset.lineIds,
          withFee: fee > 0,
          discount,
          base: subset.base,
          ratio: excess > 0 ? excess / subset.base : 0,
        };
        if (discount === 0) exact.push(candidate);
        else if (excess <= 0) inBudget.push(candidate);
        else if (candidate.ratio <= MAX_UNKNOWN_DISCOUNT) beyond.push(candidate);
      }
    }
  }
  const result = (c: Candidate): AmazonMatch => ({ orderId: c.orderId, lineIds: c.lineIds, withFee: c.withFee, discount: c.discount });

  if (exact.length > 0) return result(exact[0]);
  if (inBudget.length > 0) {
    // 額の違う候補が複数あれば紛れる（同じ額の品目どうしなら、先に並んだ方で足りる）
    return inBudget.some((other) => other.base !== inBudget[0].base) ? null : result(inBudget[0]);
  }
  if (beyond.length === 0) return null;
  // 超えた割合の小さい順（同じなら古い注文・先に並んだ品目。Array.sort は安定なので、数え上げた順がそのまま同順位の順）
  beyond.sort((a, b) => a.ratio - b.ratio);
  const best = beyond[0];
  if (beyond.some((other) => other.base !== best.base && other.ratio <= best.ratio * 2)) return null;
  return result(best);
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
