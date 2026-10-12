import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { ReceiptScan } from '@/types/app';

// レシートの読み取り（Edge Function money-receipt-scan。docs/kakei.md §10）。PWA版の `src/lib/api/moneyReceipt.ts` と同じ。

type SupabaseDb = SupabaseClient<Database>;

export interface ReceiptImage {
  media_type: 'image/jpeg' | 'image/png' | 'image/webp';
  /** base64（data: の前置きなし） */
  data: string;
}

interface ScanResponse {
  store: string;
  store_registered: boolean;
  receipt_store: string;
  occurred_on: string;
  wallet_id: string | null;
  items: {
    receipt_name: string;
    name: string;
    quantity: number;
    unit_price: number;
    amount: number;
    category_id: string | null;
    category_source: 'history' | 'ai' | 'none';
  }[];
  receipt_total: number;
}

/** 読み取りに失敗したときの、画面に出す一言（関数が返した error をそのまま使う）。 */
async function failureMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const body = await context.json().catch(() => null);
    if (body && typeof body.error === 'string') return body.error;
  }
  return '読み取りに失敗しました';
}

/** レシートの写真を読み取り、記録の入力に入れる内容を返す。 */
export async function scanReceipt(supabase: SupabaseDb, images: ReceiptImage[]): Promise<ReceiptScan> {
  const { data, error } = await supabase.functions.invoke<ScanResponse>('money-receipt-scan', { body: { images } });
  if (error || !data) throw new Error(await failureMessage(error));
  return {
    store: data.store,
    storeRegistered: data.store_registered,
    receiptStore: data.receipt_store,
    occurredOn: data.occurred_on,
    walletId: data.wallet_id,
    items: data.items.map((item) => ({
      receiptName: item.receipt_name,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      amount: item.amount,
      categoryId: item.category_id,
      categorySource: item.category_source,
    })),
    receiptTotal: data.receipt_total,
  };
}
