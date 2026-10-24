-- 使わなくなった予算の表を消す（docs/kakei.md §0.8・§0.9。2026-10-24）
-- 予算は money_recurring の行で持つ（0136）。money_budget_lines（0129）・money_budgets（0063）は読まれなくなった
-- （money_bootstrap は 0137 で空の配列を返すようにした）。表を消すと、その表のトリガー（family_sync・set_updated_at・
-- money_budgets_fill_months）・RLS も一緒に消える。トリガーの関数 money_budgets_fill_months は別に消す。
-- 削除を含むので SQL Editor で流す。0137 の適用のあとに流す。

drop table if exists public.money_budget_lines;
drop table if exists public.money_budgets;
drop function if exists public.money_budgets_fill_months();
