-- かぞく手帳: 特別費の年を、4月始まりの年度から暦年（1月〜12月）に変える（docs/kakei.md §4.3）
--
-- special_items.base_year（周期の起点）は、今まで年度の西暦（2026年4月〜2027年3月＝2026）だった。暦年にすると、
-- 予定の月が1〜3月のものは、年度の西暦に1を足した年が実際の年になる。起点を持つ項目のうち、
-- 予定の月がすべて1〜3月のものだけ +1 する（4〜12月の予定を含むものは、年度の西暦と暦年が同じなので変えない）。
-- 毎年（cycle_years = 1）で起点が無い項目は、そのまま。実績は日付から年を決めるので、変えない。
-- 更新だけで、削除は含まない。

update public.special_items as item
   set base_year = item.base_year + 1
 where item.base_year is not null
   and exists (select 1 from public.special_plans as plan where plan.item_id = item.id and plan.month between 1 and 3)
   and not exists (
         select 1 from public.special_plans as plan
          where plan.item_id = item.id and (plan.month between 4 and 12 or plan.month is null));

comment on column public.special_items.base_year is
  '周期の起点の年（暦年。2026-10-09までは4月始まりの年度の西暦）。毎年（cycle_years = 1）なら null でよい。';
