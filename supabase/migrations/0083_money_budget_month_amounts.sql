-- かぞく手帳: 予算を年ごとに12か月ぶん保持し、年の途中で変えても過去の月は変わらないようにする（docs/kakei.md §3.1）
--
-- money_budgets は (大分類, 年) で1行。今までは月額が1つで、年の途中で直すとその年の全ての月（過去の振り返りも）が変わった。
-- month_amounts に1月〜12月の月額を持つ（null の月は予算なし）。年の途中で直すときは、選んだ月から年末までだけ書き換える。
-- monthly_amount は12月の額（古いアプリはこの列だけを読むので、年の最後の額として残す）。
-- 列を足して、今ある行を12か月ぶんに広げ、古いアプリ向けのトリガーを足す。削除は含まない（それまでの予算は全ての月で同じ額なので、振り返りは変わらない）。

alter table public.money_budgets
  add column if not exists month_amounts integer[]
    check (month_amounts is null or array_length(month_amounts, 1) = 12);

update public.money_budgets
   set month_amounts = array_fill(monthly_amount, array[12])
 where month_amounts is null;

comment on column public.money_budgets.month_amounts is
  '1月〜12月の月額（円。null の月は予算なし）。年の途中で直すと、選んだ月から年末までだけ変わる。docs/kakei.md §3.1。';

-- 古いアプリは monthly_amount だけを書く。そのときは12か月ぜんぶをその額にそろえる（新しいアプリは month_amounts も書く）。
create or replace function public.money_budgets_fill_months()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.month_amounts is null
     or (tg_op = 'UPDATE'
         and new.monthly_amount is distinct from old.monthly_amount
         and new.month_amounts is not distinct from old.month_amounts) then
    new.month_amounts := array_fill(new.monthly_amount, array[12]);
  end if;
  return new;
end;
$$;

drop trigger if exists money_budgets_fill_months on public.money_budgets;
create trigger money_budgets_fill_months
  before insert or update of monthly_amount, month_amounts on public.money_budgets
  for each row
  execute function public.money_budgets_fill_months();
