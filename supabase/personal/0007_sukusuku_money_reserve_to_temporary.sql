-- かぞく手帳: 予備費をやめ、その小分類を特別費の小分類にする（docs/kakei.md §0.10。2026-10-31）
--
-- 予備費は、小分類ごとに年の予算を持って追っていた。これをやめ、特別費の小分類として、その月・その年に使った記録と額だけを見る。
--
-- 1. 予備費の予算の行（money_recurring）を使わなくする（archived_at。削除はしない。旧 0140 と同じ）
-- 2. 予備費の大分類（budget_group = 'reserve'）の小分類を、同じ家族の特別費の大分類（temporary）の下へ移す
--    （特別費の大分類が無い家族には足す。旧 0143 と同じ）。記録（money_items）は小分類に付いたままなので、そのまま特別費として数える
-- 3. 空になった予備費の大分類を使わなくする（archived_at。budget_group は null に戻す）
--
-- 目標割合の予備費の行（money_ratio_targets の budget_group = 'reserve'）は、アプリが読まなくなる。消すのは削除を含むので SQL Editor で流す。
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。何度流しても、2回目以降は何も変わらない。

-- 特別費の大分類が無い家族に足す
insert into sukusuku.money_categories (family_id, kind, parent_id, name, icon, position, temporary)
select f.family_id, 'living', null, '特別費', 'savings',
       coalesce((select max(c.position) from sukusuku.money_categories c where c.family_id = f.family_id and c.parent_id is null and c.kind = 'living'), -1) + 1,
       true
  from (select distinct family_id from sukusuku.money_categories where budget_group = 'reserve' and parent_id is null) f
 where not exists (select 1 from sukusuku.money_categories t where t.family_id = f.family_id and t.temporary and t.parent_id is null);

-- 1. 予備費の小分類・大分類に付いた予算の行（小分類を移す前に）
update sukusuku.money_recurring r
   set archived_at = now()
  from sukusuku.money_categories c
 where r.archived_at is null
   and r.category_id = c.id
   and (c.id in (select id from sukusuku.money_categories where budget_group = 'reserve' and parent_id is null)
        or c.parent_id in (select id from sukusuku.money_categories where budget_group = 'reserve' and parent_id is null));

-- 2. 小分類を特別費の下へ（並びは今の順のまま、特別費の小分類の後ろに続ける）
with tops as (
  select r.id as reserve_id,
         (select t.id from sukusuku.money_categories t
           where t.family_id = r.family_id and t.temporary and t.parent_id is null
           order by t.archived_at nulls first, t.position limit 1) as temporary_id
    from sukusuku.money_categories r
   where r.budget_group = 'reserve' and r.parent_id is null
),
moved as (
  select c.id, tops.temporary_id,
         coalesce((select max(k.position) from sukusuku.money_categories k where k.parent_id = tops.temporary_id), -1)
           + row_number() over (partition by tops.temporary_id order by c.position, c.name) as position
    from sukusuku.money_categories c
    join tops on c.parent_id = tops.reserve_id
)
update sukusuku.money_categories c
   set parent_id = moved.temporary_id, position = moved.position
  from moved
 where c.id = moved.id;

-- 3. 空になった予備費の大分類
update sukusuku.money_categories
   set archived_at = coalesce(archived_at, now()), budget_group = null
 where budget_group = 'reserve' and parent_id is null;
