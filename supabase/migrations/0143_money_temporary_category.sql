-- かぞく手帳: 特別費（docs/kakei.md §0.10。2026-10-25）
--
-- 変動費・予備費・固定費のどれでもない、特別費（貯金から出すものなど）を記録できるようにする。
-- 年間予算には載せず、記録したときだけ、振り返りの固定費の下に一覧で出す。
--
-- - money_categories.temporary: 特別費の大分類のしるし。budget_group（予算の分け方）とは別に持つ
--   （budget_group の check 制約を変えると drop が要るため。budget_group は null のまま）。
-- - 記録のある家族ごとに、大分類「特別費」を1つ足す（品目はこの大分類に直接付け、品名で区別する）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。何度流しても、2回目以降は何も変わらない。

alter table public.money_categories
  add column if not exists temporary boolean not null default false;

comment on column public.money_categories.temporary is
  '特別費の大分類（予算に載せない。振り返りの固定費の下に、記録したものだけを出す）。大分類（parent_id is null）だけ。docs/kakei.md §0.10。';

insert into public.money_categories (family_id, kind, parent_id, name, icon, position, temporary)
select f.id, 'living', null, '特別費', 'savings',
       coalesce((select max(c.position) from public.money_categories c where c.family_id = f.id and c.parent_id is null and c.kind = 'living'), -1) + 1,
       true
  from public.families f
 where exists (select 1 from public.money_categories c where c.family_id = f.id)
   and not exists (select 1 from public.money_categories t where t.family_id = f.id and t.temporary);
