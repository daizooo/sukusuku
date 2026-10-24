-- かぞく手帳: 変動費の予算を「大分類だけ」にそろえる（docs/kakei.md §0.8。2026-10-24）
--
-- 変動費は大分類の1行にだけ予算を持つ。小分類は記録の分類だけで、予算を持たない。
-- 今ある、変動費の小分類ごとの予算を、次のとおり整理する（削除はしない。使わなくした印〔archived_at〕を付けるだけ）。
--
-- 1. 水道光熱費（電気代・ガス代・水道代）は、小分類ごとに予算を持って毎月の記録を自動で作っている。
--    大分類だけの予算では持てないので、小分類を固定費（見込み）の大分類へ移す。空になった大分類「水道光熱費」は使わなくする。
-- 2. 小分類にだけ予算の行がある変動費の大分類（日用品費の消耗品・雑貨など）は、毎月ずっと続く行を1つの大分類の行に合算する。
--    残す行は、いちばん先頭の行（カテゴリを大分類に付け替え、額を合計に、開始月は一番早い月〔無期限の行があれば無期限〕に）。
--    ほかの行は使わなくする（archived_at）。自動記録をしている行・月や期間や◯年ごとを持つ行は、触らない。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。何度流しても、2回目以降は何も変わらない。

-- 1. 水道光熱費の小分類を、固定費（見込み）へ移す。
with util as (
  select u.id as util_id, u.family_id, e.id as est_id
    from public.money_categories u
    join public.money_categories e
      on e.family_id = u.family_id and e.parent_id is null and e.kind = 'living' and e.budget_group = 'estimate' and e.archived_at is null
   where u.parent_id is null and u.kind = 'living' and u.name = '水道光熱費' and u.budget_group is null and u.archived_at is null
), moved as (
  select c.id, f.est_id,
         row_number() over (partition by f.est_id order by c.position, c.name) as n,
         coalesce((select max(k.position) from public.money_categories k where k.parent_id = f.est_id), -1) as base
    from util f
    join public.money_categories c on c.parent_id = f.util_id
)
update public.money_categories c
   set parent_id = m.est_id, position = m.base + m.n
  from moved m
 where c.id = m.id;

-- 小分類も予算もなくなった「水道光熱費」の大分類は、使わなくする。
update public.money_categories u
   set archived_at = now()
 where u.parent_id is null and u.kind = 'living' and u.name = '水道光熱費' and u.budget_group is null and u.archived_at is null
   and not exists (select 1 from public.money_categories k where k.parent_id = u.id)
   and not exists (select 1 from public.money_recurring r where r.category_id = u.id and r.archived_at is null);

-- 2. 小分類にだけ予算がある変動費の大分類は、毎月ずっと続く行を1つの大分類の行に合算する。
with kid_rules as (
  select r.id, r.amount, r.start_month, r.position, c.parent_id as top_id
    from public.money_recurring r
    join public.money_categories c on c.id = r.category_id
    join public.money_categories p on p.id = c.parent_id and p.kind = 'living' and p.budget_group is null
   where r.archived_at is null and r.kind = 'expense' and r.makes_record = false
     and r.months is null and r.interval_years is null and r.no_month = false and r.end_month is null
     and not exists (select 1 from public.money_recurring t where t.category_id = c.parent_id and t.archived_at is null)
), grouped as (
  select top_id,
         (array_agg(id order by position, id))[1] as keep_id,
         sum(amount)::int as total,
         case when bool_or(start_month is null) then null else min(start_month) end as start_month
    from kid_rules
   group by top_id
  having count(*) >= 2
), kept as (
  update public.money_recurring r
     set category_id = g.top_id, amount = g.total, start_month = g.start_month
    from grouped g
   where r.id = g.keep_id
  returning r.id
)
update public.money_recurring r
   set archived_at = now()
  from kid_rules k
  join grouped g on g.top_id = k.top_id
 where r.id = k.id and r.id <> g.keep_id;
