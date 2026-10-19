// レシートの読み取り（docs/kakei.md §10）の、AIの答えを記録の入力の形に直す部分。
// Edge Function money-receipt-scan から使う。試せるよう外に出してある（receiptScan.test.ts）。

/** AIに返させる形（output_config.format の JSON Schema と同じ）。 */
export interface ReceiptReading {
  store: string;
  /** YYYY-MM-DD。読めなければ空。 */
  date: string;
  payment: { method: 'cash' | 'card' | 'other' | 'unknown'; card_name: string; last4: string };
  items: {
    receipt_name: string;
    name: string;
    quantity: number;
    unit_price: number;
    amount: number;
    /** 8 か 10。分からなければ 0。 */
    tax_rate: number;
    /** 渡した小分類の id。当てはまらなければ空。 */
    category_id: string;
  }[];
  total: number;
  tax: { mode: 'inclusive' | 'exclusive' | 'unknown'; rate8_tax: number; rate10_tax: number };
}

export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'date', 'payment', 'items', 'total', 'tax'],
  properties: {
    store: { type: 'string', description: 'レシートに印字された店名そのまま。無ければ空' },
    date: { type: 'string', description: '買った日 YYYY-MM-DD。読めなければ空' },
    payment: {
      type: 'object',
      additionalProperties: false,
      required: ['method', 'card_name', 'last4'],
      properties: {
        method: { type: 'string', enum: ['cash', 'card', 'other', 'unknown'] },
        card_name: { type: 'string', description: 'カード・電子マネーの名前。無ければ空' },
        last4: { type: 'string', description: 'カード番号の下4桁。無ければ空' },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['receipt_name', 'name', 'quantity', 'unit_price', 'amount', 'tax_rate', 'category_id'],
        properties: {
          receipt_name: { type: 'string', description: 'レシートに印字された品名そのまま（記号・半角カナもそのまま）' },
          name: { type: 'string', description: '読みやすく整えた品名（半角カナは全角に）' },
          quantity: { type: 'integer' },
          unit_price: { type: 'integer', description: '単価（円）。値引きはマイナス' },
          amount: { type: 'integer', description: '金額（円）＝個数×単価。値引きはマイナス' },
          tax_rate: { type: 'integer', description: '8 か 10。分からなければ 0' },
          category_id: { type: 'string', description: '渡した小分類の id。当てはまらなければ空' },
        },
      },
    },
    total: { type: 'integer', description: 'レシートの合計（円）' },
    tax: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'rate8_tax', 'rate10_tax'],
      properties: {
        mode: { type: 'string', enum: ['inclusive', 'exclusive', 'unknown'], description: '内税か外税か' },
        rate8_tax: { type: 'integer', description: '外税のときの8%の税額。内税なら0' },
        rate10_tax: { type: 'integer', description: '外税のときの10%の税額。内税なら0' },
      },
    },
  },
} as const;

export const RECEIPT_SYSTEM_PROMPT = `あなたは家計簿アプリのために、日本のレシートの写真を読み取ります。
決められた形の JSON だけを返してください。

- 品目は印字された順に、1行ずつ入れる。「2コ × 単319」のような行は、直前の品目の個数と単価として読む
- 値引き・割引・クーポンの行は、マイナスの金額の品目として入れる（品目の値引きは、その品目の直後に置く）
- 税の内訳の欄（10%対象・08%対象・内税）と合計が2回写っていても、1回として読む。写真が複数枚なら、境目で同じ行を二重に読まない
- レジ袋も品目として入れる
- 税: 金額に税が含まれている（内税）なら mode は inclusive。本体の価格と別に税が足されている（外税）なら exclusive で、税率ごとの税額を入れる。
  「内税対象」などの文言に惑わされず、品目の金額の合計（小計）にレシートの税額を足すと合計になるなら exclusive（例: 小計1,841 ＋ 税146 ＝ 合計1,987）
- 品目の tax_rate: 軽減税率の印（* など）があれば 8、無ければ 10。分からなければ 0
- 種類（category_id）は、渡した小分類の一覧から、この家族の分け方に合うものを選ぶ。当てはまるものが無ければ空にする
- 読めない文字は推測しすぎない。店名・日付が写っていなければ空にする`;

/** 名前を比べるためにそろえる（全角半角・大文字小文字・空白と記号の違いをなくす）。 */
export const normalizeName = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');

/** 外税の税額を、その税率の品目へ金額の比で配る（端数はいちばん金額の大きい品目）。合計に合わせる（§10.5）。 */
export function distributeTax(
  items: readonly { amount: number; tax_rate: number }[],
  tax: ReceiptReading['tax'],
): number[] {
  const amounts = items.map((item) => item.amount);
  if (tax.mode !== 'exclusive') return amounts;
  const rated = items.some((item) => item.tax_rate === 8 || item.tax_rate === 10);
  const groups = rated
    ? [
        { tax: tax.rate8_tax, members: items.flatMap((item, index) => (item.tax_rate === 8 ? [index] : [])) },
        { tax: tax.rate10_tax, members: items.flatMap((item, index) => (item.tax_rate !== 8 ? [index] : [])) },
      ]
    : [{ tax: tax.rate8_tax + tax.rate10_tax, members: items.map((_, index) => index) }];
  for (const group of groups) {
    const base = group.members.reduce((sum, index) => sum + items[index].amount, 0);
    if (group.tax === 0 || group.members.length === 0 || base <= 0) continue;
    let given = 0;
    for (const index of group.members) {
      const share = Math.floor((group.tax * items[index].amount) / base);
      amounts[index] += share;
      given += share;
    }
    const largest = group.members.reduce((best, index) => (items[index].amount > items[best].amount ? index : best));
    amounts[largest] += group.tax - given;
  }
  return amounts;
}

/**
 * 配るときの税。AIが内税（または不明）と答えても、品目の合計よりレシートの合計が大きく、その差が税で説明できる（11%以内）なら外税として扱う
 * （レシートの「※8%内税対象」の文言に引きずられて、外税のレシートを内税と読むため。§10.5）。
 * 差が AIの読んだ税額の和と同じならその内訳を使い、違えば差の全部を、品目のある税率（8を優先）へ入れる。
 */
export function effectiveTax(reading: ReceiptReading): ReceiptReading['tax'] {
  const { tax } = reading;
  if (tax.mode === 'exclusive') return tax;
  const sum = reading.items.reduce((total, item) => total + item.amount, 0);
  const gap = reading.total - sum;
  if (gap <= 0 || gap > sum * 0.11) return tax;
  if (tax.rate8_tax + tax.rate10_tax === gap) return { ...tax, mode: 'exclusive' };
  const reduced = reading.items.some((item) => item.tax_rate === 8);
  return { mode: 'exclusive', rate8_tax: reduced ? gap : 0, rate10_tax: reduced ? 0 : gap };
}

/** 登録したお店から、レシートの店名に当たるものを探す（同じ名前 → どちらかがもう片方を含む）。 */
export function matchStore(receiptStore: string, stores: readonly string[]): string | null {
  const target = normalizeName(receiptStore);
  if (target === '') return null;
  const exact = stores.find((store) => normalizeName(store) === target);
  if (exact) return exact;
  const contained = stores
    .filter((store) => {
      const name = normalizeName(store);
      return name !== '' && (target.includes(name) || name.includes(target));
    })
    // 長い名前（より詳しく当たるもの）を先に
    .sort((a, b) => b.length - a.length);
  return contained[0] ?? null;
}

export interface WalletChoice {
  id: string;
  name: string;
  type: string;
}

/** 支払いの欄から出金元を当てる。当たらなければ null（前回の出金元を使う。§10.4）。 */
export function matchWallet(payment: ReceiptReading['payment'], wallets: readonly WalletChoice[]): string | null {
  if (payment.method === 'cash') {
    const cash = wallets.filter((wallet) => wallet.type === 'cash');
    return cash.length === 1 ? cash[0].id : null;
  }
  if (payment.method !== 'card') return null;
  const cards = wallets.filter((wallet) => wallet.type === 'card' || wallet.type === 'prepaid' || wallet.type === 'qr');
  const last4 = payment.last4.replace(/\D/g, '');
  if (last4.length === 4) {
    const byNumber = cards.filter((wallet) => wallet.name.includes(last4));
    if (byNumber.length === 1) return byNumber[0].id;
  }
  const cardName = normalizeName(payment.card_name);
  if (cardName === '') return null;
  const byName = cards.filter((wallet) => {
    const name = normalizeName(wallet.name);
    return name !== '' && (name.includes(cardName) || cardName.includes(name));
  });
  return byName.length === 1 ? byName[0].id : null;
}

/** 過去の品目（レシートの表記ごとの、いちばん新しいもの）。 */
export interface LearnedItem {
  name: string;
  categoryId: string | null;
}

export interface ScannedItem {
  receiptName: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  categoryId: string | null;
  /** 種類をどこから決めたか。none は「種類を選んでください」の印。 */
  categorySource: 'history' | 'ai' | 'none';
}

/** AIの答えと過去の手本から、記録の入力に入れる品目を作る。 */
export function buildItems(
  reading: ReceiptReading,
  learned: ReadonlyMap<string, LearnedItem>,
  categoryIds: ReadonlySet<string>,
): ScannedItem[] {
  const amounts = distributeTax(reading.items, effectiveTax(reading));
  return reading.items.map((item, index) => {
    const amount = amounts[index];
    const quantity = Math.min(9999, Math.max(1, Math.round(item.quantity) || 1));
    // 税を足した品目は、単価で割り切れなければ1個として扱う（記録の品目は 個数 × 単価 = 金額）
    const unitPrice = amount % quantity === 0 ? amount / quantity : amount;
    const fixedQuantity = amount % quantity === 0 ? quantity : 1;
    const past = learned.get(item.receipt_name.trim());
    const pastCategory = past?.categoryId && categoryIds.has(past.categoryId) ? past.categoryId : null;
    const aiCategory = categoryIds.has(item.category_id) ? item.category_id : null;
    return {
      receiptName: item.receipt_name.trim(),
      name: (past?.name || item.name || item.receipt_name).trim(),
      quantity: fixedQuantity,
      unitPrice,
      amount,
      categoryId: pastCategory ?? aiCategory,
      categorySource: pastCategory ? 'history' : aiCategory ? 'ai' : 'none',
    };
  });
}
