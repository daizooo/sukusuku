-- かぞく手帳: 読めないメールを、口座・向き・日付・額を手で入れて片づける（docs/kakei.md §9.5.6.1）
--
--   money_feed_fill(明細, 口座, 向き, 日付, 額)  読めないメール（unreadable）に中身を入れ、未確認に戻して突き合わせる。
--                                              返り値は突き合わせたあとの状態（created・linked・confirm・pending など）
--
-- 行を消す文は無い。

create or replace function public.money_feed_fill(
  p_feed uuid,
  p_wallet uuid,
  p_direction text,
  p_occurred_on date,
  p_amount integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.money_feed;
  v_family uuid := public.current_family_id();
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.family_id is distinct from v_family then
    raise exception 'not found';
  end if;
  if f.status <> 'unreadable' then
    raise exception 'not unreadable';
  end if;
  if p_direction not in ('in', 'out') or p_amount is null or p_amount <= 0 or p_occurred_on is null then
    raise exception 'invalid';
  end if;
  if not exists (select 1 from public.money_wallets where id = p_wallet and family_id = v_family) then
    raise exception 'wallet not found';
  end if;
  update public.money_feed
     set wallet_id = p_wallet, direction = p_direction, occurred_on = p_occurred_on, amount = p_amount,
         status = 'pending', resolved_by = auth.uid(), resolved_at = now()
   where id = f.id;
  return public.money_feed_process(f.id);
end;
$$;

revoke execute on function public.money_feed_fill(uuid, uuid, text, date, integer) from public, anon;
grant execute on function public.money_feed_fill(uuid, uuid, text, date, integer) to authenticated;
