// かぞく手帳: Amazon の注文メールを読み、カードの利用通知（Amazon）に品目を割り振る（家計タブ。docs/kakei.md §9.7）
//
// Amazon は注文した日ではなく発送した日にカードへ請求が立つ。メールは「注文メール → カードの利用通知」の順に届く。
// 1回の注文でも発送が分かれると、利用通知は何通かに分かれる（A500円・B300円・C250円の注文に、500円と550円の2通、など）。
// そこで注文メールの品目（品名・個数・単価）を覚えておき、利用通知の額に合う品目を割り振って記録にする。
// クーポン・ポイントの値引きは、注文の各商品の価格に比例して按分される（同じ注文の請求は同じ割引率）。記録の品目の額も、按分した額で入れる。
//
// 注文メール（auto-confirm@amazon.co.jp。件名「注文済み: 「…」2点とさらに4点の商品」）の本文は、注文ごとに
//   注文番号 / 250-7991927-9006245
//   * 品名
//     数量: 2
//     1170 JPY          ← 単価（個数をかける前）
//   合計 / 4607 JPY      ← クーポンなどの値引き後の、その注文の請求額
// の形。1通に注文が何件も入ることがある。単価 × 個数の和は「合計」と一致しないことがある（値引き・送料）ので、
// その差（adjust）も覚える。マイナス（クーポンなどの値引き）なら割引率、プラス（送料など）なら残りの全部をまとめた請求に足す額として使う。

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
const LINE_RE =
  /^[ \t]*[*・●■-][ \t]*([^\r\n]+?)[ \t]*\r?\n[ \t]*数量\s*[:：]\s*(\d+)[ \t]*\r?\n[ \t]*(?:(?:¥|￥)\s*([\d,]+)|([\d,]+)\s*(?:JPY|円))/gm;
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
 * 取消・発送のメールは件名が違うので、ここには来ない（Apps Script が件名「注文済み」で探す）。
 */
export function parseAmazonOrderMail(subject: string, body: string): AmazonOrder[] | null {
  if (!subject.normalize('NFKC').includes('注文済み')) return null;

  const heads = [...body.matchAll(ORDER_NO_RE)];
  const orders: AmazonOrder[] = [];
  for (const [index, head] of heads.entries()) {
    const start = (head.index ?? 0) + head[0].length;
    const end = heads[index + 1]?.index ?? body.length;
    const block = body.slice(start, end);

    const lines: AmazonOrderLine[] = [];
    for (const match of block.matchAll(LINE_RE)) {
      const quantity = Math.min(9999, Math.max(1, Number(match[2])));
      const unitPrice = toInt(match[3] ?? match[4]);
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) continue;
      const receiptName = match[1].trim();
      lines.push({ receiptName, name: shortItemName(receiptName), quantity, unitPrice, amount: unitPrice * quantity });
    }
    if (lines.length === 0) continue;

    const totalMatch = TOTAL_RE.exec(block);
    const sum = lines.reduce((acc, line) => acc + line.amount, 0);
    const total = totalMatch ? toInt(totalMatch[1] ?? totalMatch[2]) : sum;
    orders.push({ orderNo: head[1], lines, total: Number.isSafeInteger(total) && total > 0 ? total : sum });
  }
  return orders.length > 0 ? orders : null;
}

// ---- カードの利用通知への割り振り ----

export interface OpenAmazonOrder {
  orderId: string;
  /** 注文した日（古い注文から当てる）。 */
  orderedOn: string;
  /**
   * 割引率（0〜1）。Amazon はクーポン・ポイントの値引きを、注文の各商品の価格に**比例して按分**する。
   * なので同じ注文の請求は、発送が分かれても同じ割引率になる（品目の和 × (1 − 割引率) ≒ 請求）。
   * 注文メールの「合計」が品目の和より安ければ、その差（クーポンなど）から出した値が初めの値。
   * 利用通知を割り振ったあとは、そのときの請求から確かめた値（rateObserved）。
   */
  rate: number;
  /** rate が、これまでの請求から確かめた値か。そうなら以後の請求は rate の按分どおりのはずで、外れたものは当てない。 */
  rateObserved: boolean;
  /** 送料などの上乗せ（注文メールの合計が品目の和より高いぶん）。無ければ 0。按分せず、残りの全部をまとめた請求に足す。 */
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
  /** 推定される値引き額（品目の和 −（請求 − 送料など））。値引きが無ければ 0。 */
  discount: number;
}

/**
 * 注文メールに出ない追加の値引き（Amazon ポイントの利用など）として許す上限（品目の和の按分後に対する割合）。
 * 注文メール・発送メールの品目の額は値引き前で、ポイントの利用額は載らない（「注文時にポイント残高から差し引かれます」とあるだけ）。
 * これを超える差は別の請求とみなし当てない。
 */
export const MAX_UNKNOWN_DISCOUNT = 0.2;

/** 品目の組み合わせを数え上げる上限（これより多い注文は、残りの全部だけを当てる）。 */
const MAX_SUBSET_LINES = 16;

/** 割引率をかけた額。 */
const expectedAmount = (base: number, rate: number): number => Math.round(base * (1 - rate));

interface Subset {
  lineIds: string[];
  /** 品目の和（値引き前）。 */
  base: number;
  /** 注文の残りの全部か。 */
  all: boolean;
  /** 按分の端数（品目ごとに1円のずれ）として許す幅。割引が無ければ 0。 */
  tolerance: (rate: number) => number;
}

/** 注文の、割り振っていない品目の組み合わせ（数え上げられない大きな注文は、残りの全部だけ）。 */
function subsetsOf(order: OpenAmazonOrder): Subset[] {
  const lines = [...order.lines].sort((a, b) => a.position - b.position);
  if (lines.length === 0) return [];
  const make = (chosen: typeof lines): Subset => ({
    lineIds: chosen.map((line) => line.id),
    base: chosen.reduce((acc, line) => acc + line.amount, 0),
    all: chosen.length === lines.length,
    tolerance: (rate) => (rate > 0 ? chosen.length : 0),
  });
  if (lines.length > MAX_SUBSET_LINES) return [make(lines)];
  return Array.from({ length: (1 << lines.length) - 1 }, (_, i) => make(lines.filter((_, j) => (i + 1) & (1 << j))));
}

/** 送料などを足す場合の選択肢（足さない・足す）。 */
const feeOptions = (order: OpenAmazonOrder, subset: Subset): number[] =>
  subset.all && order.feeOpen && order.fee > 0 ? [0, order.fee] : [0];

/**
 * カードの請求額に合う品目の組み合わせを探す（同じ注文の中で。注文をまたぐ組み合わせは当てない）。2段で探す。
 * ① 按分どおりの額（品目の和 × (1 − 割引率) + 送料など。端数は品目ごとに1円まで）
 *   - 割引が無い注文は、品目の和そのもの。古い注文から探し、見つけた最初のものを返す。
 *     同じ額になる組み合わせが複数あるときは、注文メールで先に並んだ品目を選ぶ（額は合うので、違っていれば人が品目を直す）
 * ② ①で当たらないとき（割引率をまだ確かめていない注文だけ）: 追加の値引き（ポイントの利用など）があったものとして、
 *   請求が按分後の額より安い組み合わせを探す。差が MAX_UNKNOWN_DISCOUNT 以下のものが候補で、差の割合がいちばん小さいものを選ぶ。
 *   ただし**ほかに有力な候補（別の額の組み合わせで、差の割合が2倍以内）があれば、当てない**（誤って割り振らず、未確認に回す）
 *   割引率を確かめた注文（rateObserved）は、按分どおりでない請求を当てない
 * 当たらなければ null（今までどおり未確認に回す）。
 */
export function matchAmazonCharge(amount: number, orders: readonly OpenAmazonOrder[]): AmazonMatch | null {
  const sorted = [...orders].sort((a, b) => a.orderedOn.localeCompare(b.orderedOn) || a.orderId.localeCompare(b.orderId));

  for (const order of sorted) {
    for (const subset of subsetsOf(order)) {
      const tolerance = subset.tolerance(order.rate);
      for (const fee of feeOptions(order, subset)) {
        const paid = amount - fee;
        if (paid > subset.base || paid <= 0) continue;
        if (Math.abs(paid - expectedAmount(subset.base, order.rate)) <= tolerance) {
          return { orderId: order.orderId, lineIds: subset.lineIds, withFee: fee > 0, discount: subset.base - paid };
        }
      }
    }
  }

  interface Candidate extends AmazonMatch {
    expected: number;
    ratio: number;
  }
  const candidates: Candidate[] = [];
  for (const order of sorted) {
    if (order.rateObserved) continue;
    for (const subset of subsetsOf(order)) {
      for (const fee of feeOptions(order, subset)) {
        const paid = amount - fee;
        const expected = expectedAmount(subset.base, order.rate);
        if (paid <= 0 || paid >= expected) continue;
        const ratio = (expected - paid) / expected;
        if (ratio > MAX_UNKNOWN_DISCOUNT) continue;
        candidates.push({
          orderId: order.orderId,
          lineIds: subset.lineIds,
          withFee: fee > 0,
          discount: subset.base - paid,
          expected,
          ratio,
        });
      }
    }
  }
  if (candidates.length === 0) return null;
  // 差の割合の小さい順（同じなら古い注文・先に並んだ品目。Array.sort は安定なので、数え上げた順がそのまま同順位の順）
  candidates.sort((a, b) => a.ratio - b.ratio);
  const best = candidates[0];
  // 額の違う別の組み合わせが、同じくらい有力なら当てない（同じ額の品目どうしなら、先に並んだ方で足りる）
  if (candidates.some((other) => other.expected !== best.expected && other.ratio <= best.ratio * 2)) return null;
  return { orderId: best.orderId, lineIds: best.lineIds, withFee: best.withFee, discount: best.discount };
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
