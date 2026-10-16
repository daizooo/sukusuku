// かぞく手帳: Amazon の注文メールを読み、カードの利用通知（Amazon）に品目を割り振る（家計タブ。docs/kakei.md §9.7）
//
// Amazon は注文した日ではなく発送した日にカードへ請求が立つ。メールは「注文メール → カードの利用通知」の順に届く。
// 1回の注文でも発送が分かれると、利用通知は何通かに分かれる（A500円・B300円・C250円の注文に、500円と550円の2通、など）。
// そこで注文メールの品目（品名・個数・単価）を覚えておき、利用通知の額に合う品目を割り振って記録にする。
//
// 注文メール（auto-confirm@amazon.co.jp。件名「注文済み: 「…」2点とさらに4点の商品」）の本文は、注文ごとに
//   注文番号 / 250-7991927-9006245
//   * 品名
//     数量: 2
//     1170 JPY          ← 単価（個数をかける前）
//   合計 / 4607 JPY      ← クーポンなどの値引き後の、その注文の請求額
// の形。1通に注文が何件も入ることがある。単価 × 個数の和は「合計」と一致しないことがある（値引き・送料）ので、
// その差（adjust）も覚えて、全部が1回で請求されたときの額（合計）に当てられるようにする。

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
  /** 合計 − 品目の和（値引きはマイナス、送料などはプラス）。 */
  adjust: number;
  /** まだ使っていないか（品目のどれかと一緒に請求される）。 */
  adjustOpen: boolean;
  /** まだ記録に割り振っていない品目（注文メールの並び順）。 */
  lines: { id: string; amount: number; position: number }[];
}

export interface AmazonMatch {
  orderId: string;
  lineIds: string[];
  /** 値引き・送料などの差も一緒に請求された。 */
  withAdjust: boolean;
}

/** 品目の組み合わせを数え上げる上限（これより多い注文は、残りの全部だけを当てる）。 */
const MAX_SUBSET_LINES = 16;

/**
 * カードの請求額に合う品目の組み合わせを探す。
 *   - 同じ注文の中で、まだ割り振っていない品目の和が請求額に等しい組み合わせ
 *   - 値引き・送料などの差（adjust）が残っていれば、品目の和 + 差 が等しい組み合わせ（注文全体が1回で請求されたとき）
 * 古い注文から探し、見つけた最初のものを返す。同じ額になる組み合わせが複数あるときは、注文メールで先に並んだ品目を選ぶ
 * （額は合うので、違っていても人が品目を直せばよい）。当たらなければ null（今までどおり未確認に回す）。
 */
export function matchAmazonCharge(amount: number, orders: readonly OpenAmazonOrder[]): AmazonMatch | null {
  const sorted = [...orders].sort((a, b) => a.orderedOn.localeCompare(b.orderedOn) || a.orderId.localeCompare(b.orderId));
  for (const order of sorted) {
    const lines = [...order.lines].sort((a, b) => a.position - b.position);
    if (lines.length === 0) continue;
    const useAdjust = order.adjustOpen && order.adjust !== 0;

    if (lines.length > MAX_SUBSET_LINES) {
      const sum = lines.reduce((acc, line) => acc + line.amount, 0);
      const ids = lines.map((line) => line.id);
      if (sum === amount) return { orderId: order.orderId, lineIds: ids, withAdjust: false };
      if (useAdjust && sum + order.adjust === amount) return { orderId: order.orderId, lineIds: ids, withAdjust: true };
      continue;
    }

    for (let mask = 1; mask < 1 << lines.length; mask++) {
      let sum = 0;
      for (let i = 0; i < lines.length; i++) if (mask & (1 << i)) sum += lines[i].amount;
      const withAdjust = !(sum === amount) && useAdjust && sum + order.adjust === amount;
      if (sum === amount || withAdjust) {
        const lineIds = lines.filter((_, i) => mask & (1 << i)).map((line) => line.id);
        return { orderId: order.orderId, lineIds, withAdjust };
      }
    }
  }
  return null;
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
