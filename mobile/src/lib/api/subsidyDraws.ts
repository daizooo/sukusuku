import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type {
  LotteryCoupon,
  LotteryCouponKind,
  SubsidyBallId,
  SubsidyDraw,
  SubsidyDrawDraft,
  SubsidyRate,
} from '@/types/app';
import { subsidyFor } from '@/lib/subsidyLotteryUtils';

type DrawRow = Tables<'subsidy_draws'>;
type CouponRow = Tables<'lottery_coupons'>;
type SupabaseDb = SupabaseClient<Database>;

// 補助くじの記録と券（暮らしタブ。docs/home.md §9）。
// PWA版の `src/lib/api/subsidyDraws.ts` と同じ。

const rowToDraw = (row: DrawRow): SubsidyDraw => ({
  id: row.id,
  drawnBy: row.drawn_by,
  itemName: row.item_name,
  price: row.price,
  ball: row.ball as SubsidyBallId,
  rate: row.rate as SubsidyRate,
  rateUpUsed: row.rate_up_used,
  subsidy: row.subsidy,
  drawnAt: row.drawn_at,
  isTest: row.is_test,
});

const rowToCoupon = (row: CouponRow): LotteryCoupon => ({
  id: row.id,
  ownerId: row.owner_id,
  kind: row.kind as LotteryCouponKind,
  cycle: row.cycle,
  slot: row.slot,
  obtainedAt: row.obtained_at,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
  isTest: row.is_test,
});

/** 履歴に出す件数の上限。月2〜3回×家族なら、数年分。 */
const HISTORY_LIMIT = 200;

/** 家族の記録を新しい順に読む（アカウントごとの履歴・救済の計算に使う）。 */
export async function loadSubsidyDraws(supabase: SupabaseDb, familyId: string): Promise<SubsidyDraw[]> {
  const { data, error } = await supabase
    .from('subsidy_draws')
    .select('*')
    .eq('family_id', familyId)
    .order('drawn_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []).map(rowToDraw);
}

/**
 * くじの結果を記録する。結果を見せる前に必ず記録して、引き直しを防ぐ。
 * 月の回数（1人あたり月2回、誕生月は3回）と使うひと押し券の確認は、DBのトリガーが行う
 * （超えると失敗する）。25%が出たときのひと押し券も、DBが渡す。
 */
export async function insertSubsidyDraw(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  draft: SubsidyDrawDraft,
): Promise<SubsidyDraw> {
  const { data, error } = await supabase
    .from('subsidy_draws')
    .insert({
      family_id: familyId,
      drawn_by: userId,
      item_name: draft.itemName.trim(),
      price: draft.price,
      ball: draft.ball,
      rate: draft.rate,
      push_coupon_id: draft.pushCouponId,
      is_test: draft.isTest,
      subsidy: subsidyFor(draft.rate, draft.price),
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToDraw(data);
}

/** 自分の券を新しい順に読む（使った券・期限切れも含む。図鑑の進み具合に使う）。 */
export async function loadMyCoupons(supabase: SupabaseDb, userId: string): Promise<LotteryCoupon[]> {
  const { data, error } = await supabase
    .from('lottery_coupons')
    .select('*')
    .eq('owner_id', userId)
    .order('obtained_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToCoupon);
}

/** 100%の箱を開ける。出た券（6つ目なら日帰り旅行券も）を返す。 */
export async function openLotteryBox(supabase: SupabaseDb, drawId: string): Promise<LotteryCoupon[]> {
  const { data, error } = await supabase.rpc('lottery_open_box', { p_draw_id: drawId });
  if (error) throw error;
  return (data ?? []).map(rowToCoupon);
}

/** お菓子・映画・カフェ・ピクニック・日帰り旅行の券を「使った」にする。 */
export async function markCouponUsed(supabase: SupabaseDb, couponId: string): Promise<LotteryCoupon> {
  const { data, error } = await supabase.rpc('lottery_use_coupon', { p_coupon_id: couponId });
  if (error) throw error;
  return rowToCoupon(data);
}

/** 補助率アップ券を使って、結果を1段上げる（25%・50%の結果だけ）。 */
export async function applyRateUpCoupon(supabase: SupabaseDb, drawId: string, couponId: string): Promise<SubsidyDraw> {
  const { data, error } = await supabase.rpc('lottery_use_rate_up', { p_draw_id: drawId, p_coupon_id: couponId });
  if (error) throw error;
  return rowToDraw(data);
}

export interface MyLotteryProfile {
  /** 誕生月（1〜12）。誕生月は引ける回数が+1回になる。分からなければ null。 */
  birthMonth: number | null;
  /** テストモードを出してよいか。開発をしている夫だけ（docs/home.md §9.6）。 */
  canTest: boolean;
}

/** 自分の家族の情報のうち、くじに使うもの（誕生月・テストモードを使えるか）。 */
export async function loadMyLotteryProfile(supabase: SupabaseDb, userId: string): Promise<MyLotteryProfile> {
  const { data, error } = await supabase
    .from('family_members')
    .select('birth_date, relation')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const month = data?.birth_date ? Number(data.birth_date.split('-')[1]) : NaN;
  return {
    birthMonth: month >= 1 && month <= 12 ? month : null,
    canTest: data?.relation === 'husband',
  };
}

/**
 * 自分のテストのくじと券をまとめて消す（本物には触らない）。消したくじの数を返す。
 * テストモードで確認し終えたあとに使う（docs/home.md §9）。
 */
export async function deleteMyTestLotteryData(supabase: SupabaseDb): Promise<number> {
  const { data, error } = await supabase.rpc('lottery_delete_my_test_data');
  if (error) throw error;
  return data ?? 0;
}
