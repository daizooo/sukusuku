-- 家計のカテゴリの整理（2026-10-25）。
--
-- 1. 固定費の大分類の名前を「固定費・確定」「固定費・見込み」にする（年間予算の見出しと揃える）。
--    大分類は名前ではなく予算の分け方（budget_group）で見つけているので、名前を変えても数え方は変わらない。
update public.money_categories
   set name = '固定費・確定'
 where parent_id is null and kind = 'living' and budget_group = 'fixed' and name = '固定費（確定）';

update public.money_categories
   set name = '固定費・見込み'
 where parent_id is null and kind = 'living' and budget_group = 'estimate' and name = '固定費（見込み）';

-- 2. 0140 で使わなくした大分類「水道光熱費」を消す。小分類・品目・自動記録・明細のルールのどれからも
--    使われていないものだけ（使われていれば残す）。本番では SQL Editor で流す（削除を含むため）。
delete from public.money_categories c
 where c.parent_id is null and c.kind = 'living' and c.name = '水道光熱費' and c.archived_at is not null
   and not exists (select 1 from public.money_categories s where s.parent_id = c.id)
   and not exists (select 1 from public.money_items i where i.category_id = c.id)
   and not exists (select 1 from public.money_recurring r where r.category_id = c.id)
   and not exists (select 1 from public.money_feed_rules f where f.category_id = c.id)
   and not exists (select 1 from public.money_amazon_lines a where a.category_id = c.id);
