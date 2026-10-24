-- 予算・自動記録ルール・変動費の月の予算を1つの表（money_recurring）にまとめる（docs/kakei.md §0.8。2026-10-23）
--
-- 予算が本体。予算1件＝money_recurring の1行（単価 × 発生月・頻度・期間）で、自動記録はその行のオン／オフ（makes_record）。
-- オンなら日・休日・出金元・お店で、サーバーがその日に記録を作る（make_money_recurring_records は変えない）。オフは記録なし。
-- - no_month: 発生月なし（月に置かず、その年に1回ぶんを見込み支出として数える）。自動記録はできない（月が無いため）
-- - 予算の明細（money_budget_lines。0129）: 同じ小分類・額・発生月・頻度・期間のルールがあれば、その行に結びつける
--   （ルールの名前が空なら明細の名前を入れる）。無ければ自動記録オフの行として足す
-- - 変動費の月の予算（money_budgets）: 大分類の行として足す。小分類にずっと続く毎月の行（電気・ガス・水道など）があれば、
--   その分を引く（大分類の月の予算 ＝ 大分類の行 ＋ 小分類の行）。年の途中で額を変えていた年は、額ごとにその年だけの行にする
-- money_budget_lines・money_budgets は使わなくなる（あとで SQL Editor で消す）。money_bootstrap は to_jsonb(r) で返すので変えない。
-- 何度流しても同じ結果になる（足した行が、次に流したときは同じものとして結びつく）。

alter table public.money_recurring
  add column if not exists no_month boolean not null default false;

alter table public.money_recurring drop constraint if exists money_recurring_no_month_check;
alter table public.money_recurring
  add constraint money_recurring_no_month_check check (not no_month or (months is null and not makes_record));

comment on column public.money_recurring.no_month is
  '発生月なし（その年に1回ぶんを見込み支出として数える。自動記録はしない）。docs/kakei.md §0.8';

-- 1. 予算の明細
with lines as (
  select l.*,
         row_number() over (
           partition by l.family_id, l.category_id, l.amount, l.months, l.no_month, l.interval_years, l.start_month, l.end_month
           order by l.position, l.created_at, l.id
         ) as n
    from public.money_budget_lines l
),
rules as (
  select r.id, r.family_id, r.category_id, r.amount, r.months, r.no_month, r.interval_years, r.start_month, r.end_month,
         row_number() over (
           partition by r.family_id, r.category_id, r.amount, r.months, r.no_month, r.interval_years, r.start_month, r.end_month
           order by r.position, r.created_at, r.id
         ) as n
    from public.money_recurring r
   where r.archived_at is null and r.kind <> 'transfer' and r.category_id is not null
),
pairs as (
  select l.id as line_id, r.id as rule_id, l.name
    from lines l
    join rules r
      on r.family_id = l.family_id
     and r.category_id = l.category_id
     and r.amount = l.amount
     and r.months is not distinct from (case when l.no_month then null else l.months end)
     and r.no_month = l.no_month
     and r.interval_years is not distinct from l.interval_years
     and r.start_month is not distinct from l.start_month
     and r.end_month is not distinct from l.end_month
     and r.n = l.n
),
named as (
  update public.money_recurring r
     set name = btrim(p.name)
    from pairs p
   where r.id = p.rule_id and btrim(r.name) = '' and btrim(p.name) <> ''
  returning r.id
)
insert into public.money_recurring (
  family_id, kind, day, months, holiday, amount_mode, amount, category_id, name, position,
  start_month, end_month, makes_record, interval_years, day_known, no_month, created_at
)
select l.family_id,
       case when c.kind = 'income' then 'income' else 'expense' end,
       1,
       case when l.no_month then null else l.months end,
       'next',
       case when c.kind = 'income' or coalesce(t.budget_group, c.budget_group) = 'estimate' then 'estimate' else 'fixed' end,
       l.amount,
       l.category_id,
       btrim(l.name),
       1000 + l.position,
       l.start_month,
       l.end_month,
       false,
       l.interval_years,
       false,
       l.no_month,
       l.created_at
  from lines l
  join public.money_categories c on c.id = l.category_id
  left join public.money_categories t on t.id = c.parent_id
 where not exists (select 1 from pairs p where p.line_id = l.id);

-- 2. 変動費の月の予算（大分類・年ごとの1月〜12月）
with budgets as (
  select b.family_id, b.category_id, b.fiscal_year as year, b.month_amounts,
         b.fiscal_year = max(b.fiscal_year) over (partition by b.category_id) as latest,
         b.created_at
    from public.money_budgets b
    join public.money_categories c on c.id = b.category_id
   where c.parent_id is null and c.kind = 'living' and coalesce(c.budget_group, 'variable') = 'variable'
),
-- 大分類と小分類の、ずっと続く毎月の行（期間・頻度の無いもの）の合計。月の予算からこの分を引く。
always as (
  select coalesce(c.parent_id, c.id) as top_id, sum(r.amount) as amount
    from public.money_recurring r
    join public.money_categories c on c.id = r.category_id
   where r.archived_at is null and r.kind = 'expense' and r.months is null and not r.no_month
     and r.start_month is null and r.end_month is null and r.interval_years is null
   group by coalesce(c.parent_id, c.id)
),
months as (
  select b.family_id, b.category_id, b.year, b.latest, b.created_at, m.month, b.month_amounts[m.month] as amount,
         b.month_amounts[12] as december,
         (select count(distinct v) from unnest(b.month_amounts) as v) = 1 and array_position(b.month_amounts, null) is null as even
    from budgets b
   cross join generate_series(1, 12) as m(month)
  where b.month_amounts[m.month] is not null
),
plan as (
  -- 12か月が同じ額で、いちばん新しい年: その年からずっと
  select family_id, category_id, amount, null::smallint[] as months, make_date(year, 1, 1) as start_month, null::date as end_month, created_at
    from months
   where even and latest and month = 1
  union all
  -- それ以外: 額ごとに、その年だけ
  select family_id, category_id, amount,
         case when count(*) = 12 then null else array_agg(month::smallint order by month) end,
         make_date(year, 1, 1), make_date(year, 12, 1), min(created_at)
    from months
   where not (even and latest)
   group by family_id, category_id, year, amount
  union all
  -- 年の途中で額を変えていた、いちばん新しい年の次の年から: 12月の額でずっと（今までの「前の年の12月の額を引き継ぐ」と同じ）
  select family_id, category_id, december, null::smallint[], make_date(year + 1, 1, 1), null::date, created_at
    from months
   where not even and latest and month = 12
)
insert into public.money_recurring (
  family_id, kind, day, months, holiday, amount_mode, amount, category_id, name, position,
  start_month, end_month, makes_record, day_known, no_month, created_at
)
select p.family_id, 'expense', 1, p.months, 'next', 'estimate', p.amount - coalesce(a.amount, 0), p.category_id, '', 0,
       p.start_month, p.end_month, false, false, false, p.created_at
  from plan p
  left join always a on a.top_id = p.category_id
 where p.amount - coalesce(a.amount, 0) > 0
   and not exists (
     select 1 from public.money_recurring r
      where r.category_id = p.category_id and r.archived_at is null
        and r.months is not distinct from p.months
        and r.start_month is not distinct from p.start_month
        and r.end_month is not distinct from p.end_month
        and r.amount = p.amount - coalesce(a.amount, 0)
   );
