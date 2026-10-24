-- かぞく手帳: 残高の補正を「日付つきの残高」から「ただの補正（増減）」にする（docs/kakei.md §9.3）
--
-- これまでの補正は「その日の終わりの残高」で、その日以前の記録は残高に使われなかった。
-- そのため、補正より前の日付の記録を足しても残高が変わらなかった。
-- 補正を「記録から出した残高に足す増減（adjustment）」に変え、日付に関係なく全部の記録を数える。
--   残高 = 今日までの記録の合計 + 補正の増減の合計
-- balance_on は補正した日（履歴に出す日）。残高の計算には使わない。
--
-- 既存の amount（その日の残高）は残す（古いアプリは今までどおり読める）。
-- 既存の補正は、これまでの数え方と今の残高が変わらないように adjustment へ変換する。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。

alter table public.money_wallet_balances
  add column if not exists adjustment integer not null default 0;

comment on column public.money_wallet_balances.adjustment is
  '補正の増減（円）。残高 = 今日までの記録の合計 + 補正の増減の合計。amount は補正したときの残高（古いアプリ用）。';

-- 既存の補正を変換する。増減 = その日の残高 − これまでの数え方で記録から出した額
-- （前の補正の残高 + そのあとの記録。前の補正が無ければ、その日までの記録の全部）。
with moves as (
  select r.wallet_id, r.occurred_on,
         case when r.kind = 'income' then t.total else -t.total end as delta
    from public.money_records r
    cross join lateral (select coalesce(sum(i.amount), 0)::int as total from public.money_items i where i.record_id = r.id) t
   where r.wallet_id is not null
  union all
  select r.to_wallet_id, r.occurred_on, t.total
    from public.money_records r
    cross join lateral (select coalesce(sum(i.amount), 0)::int as total from public.money_items i where i.record_id = r.id) t
   where r.kind = 'transfer' and r.to_wallet_id is not null
),
ordered as (
  select b.id, b.wallet_id, b.balance_on, b.amount,
         lag(b.balance_on) over w as prev_on,
         lag(b.amount) over w as prev_amount
    from public.money_wallet_balances b
  window w as (partition by b.wallet_id order by b.balance_on)
),
converted as (
  select o.id,
         o.amount - (
           coalesce(o.prev_amount, 0)
           + coalesce((select sum(m.delta) from moves m
                        where m.wallet_id = o.wallet_id
                          and m.occurred_on <= o.balance_on
                          and (o.prev_on is null or m.occurred_on > o.prev_on)), 0)
         ) as adjustment
    from ordered o
)
update public.money_wallet_balances b
   set adjustment = c.adjustment
  from converted c
 where c.id = b.id;
