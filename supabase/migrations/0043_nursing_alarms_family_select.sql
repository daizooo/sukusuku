-- すくすく手帳: 「いま授乳中・記録待ち」を家族の端末からも読めるようにする
--
-- 授乳の記録(care_logs)が入るのは、母乳のストップウォッチを止めて入力画面で
-- 保存したあと。止めてから保存するまでの「記録待ち」の間、前回の授乳は1つ前の
-- ままに見える。通知の側はこの隙間を 0027 で手当てしてあるが(nursing_alarms に
-- 行がある家族には「そろそろ次の授乳」を送らない)、**画面には伝わっていなかった**。
--
-- そのため、妻が授乳を測り終えて記録がまだのとき、夫の端末のホームでは
-- 「次の授乳の目安」が前の授乳のまま赤く「◯分すぎ」と出ていた。
--
-- nursing_alarms は自分の行しか読めない(0021)ので、家族の端末からは授乳中で
-- あることすら分からない。そこで**参照だけ**家族に広げる。
-- 書き込み(insert/update/delete)は今までどおり本人の行だけ
-- （パートナーのお知らせを勝手に止められないようにするため）。

-- ============================================================
-- 1. 端末(購読) -> 家族 を引く関数
-- ============================================================
-- ポリシーの中から push_subscriptions を直接見ると、あちらのRLS（自分の行だけ）に
-- 阻まれて家族の行が引けない。current_family_id() と同じく SECURITY DEFINER で包む。
-- 返すのは family_id だけなので、通知の宛先(endpoint)は家族にも見えない。
create or replace function public.push_subscription_family_id(subscription uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select family_id from public.push_subscriptions where id = subscription;
$$;

comment on function public.push_subscription_family_id(uuid) is
  '端末(push_subscriptions)の家族を引く。nursing_alarms を家族で参照するためのもの。';

-- ============================================================
-- 2. 家族なら参照できるようにする
-- ============================================================
-- 既存の nursing_alarms_own_select はそのまま残す（ポリシーはORで足し合わされる）。
-- 通知をオフにしている端末には push_subscriptions の行が無く、授乳中の印も
-- 預けられないので、そのときは今までどおり記録が入るまで分からない。
create policy "nursing_alarms_family_select" on public.nursing_alarms
  for select using (
    public.push_subscription_family_id(subscription_id) = public.current_family_id()
  );

-- ログイン前(anon)から呼ぶ必要はないので、RPCとしては叩けないようにしておく。
-- ポリシーの中の呼び出しは問い合わせている本人の権限で動くため、
-- サインイン済み(authenticated)にだけ実行を許す。
revoke execute on function public.push_subscription_family_id(uuid) from public, anon;
grant execute on function public.push_subscription_family_id(uuid) to authenticated;
