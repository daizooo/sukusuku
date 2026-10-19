// かぞく手帳: レシートの写真を読み取り、記録の入力に入れる内容を返す（家計タブ。docs/kakei.md §10）
//
// 呼ぶのはアプリ（ログインの JWT）。
//   POST { images: [{ media_type: 'image/jpeg' | 'image/png' | 'image/webp', data: base64 }] }（4枚まで。長いレシートは分けて撮る）
// 返り値 {
//   store, store_registered, receipt_store, occurred_on, wallet_id,
//   items: [{ receipt_name, name, quantity, unit_price, amount, category_id, category_source }],
//   receipt_total, items_total
// }
// 写真は保存しない（読み取りに使って捨てる）。ログにも中身を出さない。
//
// 読み取りは Claude Haiku 5.5（ANTHROPIC_API_KEY を Edge Function のシークレットに入れる）。
// 使いすぎの歯止め: 家族ごとに月200枚まで（money_receipt_scans）。
// 種類・お店は、過去の記録の表記（money_items.receipt_name・money_records.receipt_store）を先に引き、無ければAIの答え（§10.3・§10.4）。
//
// 認証は関数側で確かめるので、supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import {
  buildItems,
  matchStore,
  matchWallet,
  RECEIPT_SCHEMA,
  RECEIPT_SYSTEM_PROMPT,
  type LearnedItem,
  type ReceiptReading,
  type WalletChoice,
} from '../_shared/receiptScan.ts';

const MODEL = 'claude-haiku-5-5';
const MONTHLY_LIMIT = 200;
const MAX_IMAGES = 4;
// 1枚あたりの上限（base64 の文字数。約5MB）
const MAX_IMAGE_CHARS = 7_000_000;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

/**
 * base64 を整える（前置き・改行・空白・URL形式の文字・足りない「=」）。
 * 端末のスキャナーが改行つきの base64 を返すことがあり、そのまま渡すと Anthropic が invalid base64 data で断る。
 */
const cleanBase64 = (value: string): string => {
  const body = value
    .replace(/^data:[^,]*,/, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '');
  return body + '='.repeat((4 - (body.length % 4)) % 4);
};

/** 日本時間の今月1日 0時（UTC の ISO）。 */
const monthStartJst = (now: number): string => {
  const jst = new Date(now + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000).toISOString();
};

/** 日本時間の今日（YYYY-MM-DD）。 */
const todayJst = (now: number): string => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY が設定されていない' }, 503);

  const body = await request.json().catch(() => null);
  const images: { media_type: string; data: string }[] = Array.isArray(body?.images) ? body.images : [];
  if (images.length === 0 || images.length > MAX_IMAGES) return json({ error: `写真は1〜${MAX_IMAGES}枚` }, 400);
  for (const image of images) {
    if (!MEDIA_TYPES.has(image?.media_type) || typeof image?.data !== 'string' || image.data.length > MAX_IMAGE_CHARS) {
      return json({ error: '写真の形が違う' }, 400);
    }
    image.data = cleanBase64(image.data);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4 !== 0) {
      // 何が混ざっているか分かるよう、長さと先頭だけ残す（写真の中身は含まれない）
      console.error('invalid base64', image.data.length, image.data.slice(0, 16));
      return json({ error: '写真の形が違う' }, 400);
    }
  }

  const { data: familyId, error: familyError } = await userClient.rpc('current_family_id');
  if (familyError || typeof familyId !== 'string') return json({ error: 'no family' }, 403);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const now = Date.now();

  // 月の上限と、読み取りに渡す家族の設定（種類・お店・出金元）を並べて読む
  const [scans, categories, stores, wallets] = await Promise.all([
    admin
      .from('money_receipt_scans')
      .select('images')
      .eq('family_id', familyId)
      .gte('created_at', monthStartJst(now))
      .returns<{ images: number }[]>(),
    userClient
      .from('money_categories')
      .select('id, name, parent_id, kind')
      .is('archived_at', null)
      .returns<{ id: string; name: string; parent_id: string | null; kind: string }[]>(),
    userClient.from('money_stores').select('name').is('archived_at', null).returns<{ name: string }[]>(),
    userClient.from('money_wallets').select('id, name, type').is('archived_at', null).returns<WalletChoice[]>(),
  ]);
  if (scans.error || categories.error || stores.error || wallets.error) return json({ error: 'read failed' }, 500);
  const used = scans.data.reduce((sum, row) => sum + row.images, 0);
  if (used + images.length > MONTHLY_LIMIT) return json({ error: `今月の読み取りは${MONTHLY_LIMIT}枚までです` }, 429);

  // 種類は支出の小分類だけ渡す（「大分類 › 小分類」）
  const topName = new Map(categories.data.filter((c) => c.parent_id === null).map((c) => [c.id, c.name]));
  const subs = categories.data.filter((c) => c.parent_id !== null && c.kind === 'living');
  const categoryLines = subs.map((c) => `${c.id}: ${topName.get(c.parent_id!) ?? ''} › ${c.name}`).join('\n');

  // 数えるのは呼ぶ前（失敗しても費用はかかりうるため）
  const { error: countError } = await admin
    .from('money_receipt_scans')
    .insert({ family_id: familyId, created_by: userData.user.id, images: images.length });
  if (countError) return json({ error: 'count failed' }, 500);

  const client = new Anthropic({ apiKey });
  let reading: ReceiptReading;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: RECEIPT_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((image) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.media_type as 'image/jpeg' | 'image/png' | 'image/webp',
                data: image.data,
              },
            })),
            {
              type: 'text' as const,
              text: `写真は${images.length}枚（上から順）。\n\n小分類の一覧（id: 大分類 › 小分類）:\n${categoryLines || '（なし）'}`,
            },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal') return json({ error: '読み取れませんでした' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'レシートが長すぎます' }, 422);
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') return json({ error: '読み取れませんでした' }, 422);
    reading = JSON.parse(text.text) as ReceiptReading;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: '混み合っています。少し待ってください' }, 429);
    if (error instanceof Anthropic.APIError) {
      // 400 の理由（画像の大きさ・残高など）が分かるよう、APIの返したメッセージも残す（写真の中身は含まれない）
      console.error('anthropic', error.status, error.message);
      return json({ error: '読み取りに失敗しました' }, 502);
    }
    console.error('receipt scan failed');
    return json({ error: '読み取りに失敗しました' }, 502);
  }

  // 過去の手本（同じ表記の、いちばん新しい品目・記録）
  const receiptNames = [...new Set(reading.items.map((item) => item.receipt_name.trim()).filter((name) => name !== ''))];
  const receiptStore = reading.store.trim();
  const [pastItems, pastRecord] = await Promise.all([
    receiptNames.length === 0
      ? Promise.resolve({ data: [], error: null })
      : userClient
          .from('money_items')
          .select('receipt_name, name, category_id, created_at')
          .in('receipt_name', receiptNames)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .returns<{ receipt_name: string; name: string; category_id: string | null }[]>(),
    receiptStore === ''
      ? Promise.resolve({ data: null, error: null })
      : userClient
          .from('money_records')
          .select('store')
          .eq('receipt_store', receiptStore)
          .neq('store', '')
          .order('occurred_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle<{ store: string }>(),
  ]);
  if (pastItems.error || pastRecord.error) return json({ error: 'read failed' }, 500);

  const learned = new Map<string, LearnedItem>();
  for (const item of pastItems.data ?? []) {
    if (!learned.has(item.receipt_name)) learned.set(item.receipt_name, { name: item.name, categoryId: item.category_id });
  }
  const items = buildItems(reading, learned, new Set(subs.map((c) => c.id)));

  const storeNames = stores.data.map((s) => s.name);
  const store = pastRecord.data?.store ?? matchStore(receiptStore, storeNames) ?? receiptStore;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(reading.date) && reading.date <= todayJst(now) ? reading.date : todayJst(now);

  return json({
    store,
    store_registered: storeNames.includes(store),
    receipt_store: receiptStore,
    occurred_on: date,
    wallet_id: matchWallet(reading.payment, wallets.data),
    items: items.map((item) => ({
      receipt_name: item.receiptName,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: item.amount,
      category_id: item.categoryId,
      category_source: item.categorySource,
    })),
    receipt_total: reading.total,
    items_total: items.reduce((sum, item) => sum + item.amount, 0),
  });
});
