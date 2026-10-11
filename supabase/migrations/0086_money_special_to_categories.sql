-- かぞく手帳: 特別費をカテゴリ（money_categories）へ収納する（docs/kakei.md §0.2）
--
-- 特別費を生活費と分けて計算するのをやめ、大分類「特別費」のカテゴリとして、生活費と同じ一覧・内訳に並べる。
--   - 支出の項目（special_items.kind = 'expense'）は、大分類「特別費」（生活費・アイコン star）の小分類にする
--   - 収入の項目（賞与など。kind = 'income'）は、収入の大分類「給与」の小分類にする
--     （賞与は固定収入の設定に移す予定。docs/kakei.md §0.3。それまでは小分類として記録できる）
-- 家族ごとに、項目を持つ家族だけに作る。名前は special_items の行からそのまま写す（家族の名前をここには書かない）。
-- 何度流しても同じ結果になる（大分類は同じ名前があれば作らず、小分類は同じ名前があれば足さない）。
--
-- この migration は追加だけ。special_items・special_plans と、money_items・money_recurring の special_* の列は
-- 消さない（古いアプリがまだ読むため）。アプリ（PWA・mobile）を出したあとの後片付けは別の migration（0088）で行う。
-- 特別費の記録は、2026-10-11 に記録をすべて削除したので、付け替える品目は無い（money_items は 0 件）。
-- 固定費のルール（money_recurring）も特別費の項目を指すものは 0 件。

do $$
declare
  v_family uuid;
  v_parent uuid;
begin
  -- 支出: 大分類「特別費」と、項目ごとの小分類
  for v_family in
    select distinct family_id from public.special_items where kind = 'expense'
  loop
    select id into v_parent
      from public.money_categories
     where family_id = v_family and kind = 'living' and parent_id is null and name = '特別費'
     limit 1;

    if v_parent is null then
      insert into public.money_categories (family_id, kind, parent_id, name, icon, position)
      values (
        v_family, 'living', null, '特別費', 'star',
        (select coalesce(max(position), -1) + 1
           from public.money_categories
          where family_id = v_family and kind = 'living' and parent_id is null)
      )
      returning id into v_parent;
    end if;

    insert into public.money_categories (family_id, kind, parent_id, name, position)
    select v_family, 'living', v_parent, item.name,
           (coalesce((select max(position) + 1 from public.money_categories where parent_id = v_parent), 0)
            + row_number() over (order by item.position, item.created_at) - 1)::integer
      from public.special_items as item
     where item.family_id = v_family
       and item.kind = 'expense'
       and not exists (
         select 1 from public.money_categories as c
          where c.family_id = v_family and c.parent_id = v_parent and c.name = item.name
       );
  end loop;

  -- 収入: 収入の大分類（「給与」があればそれ。無ければいちばん上のもの。それも無ければ「給与」を作る）の小分類
  for v_family in
    select distinct family_id from public.special_items where kind = 'income'
  loop
    select id into v_parent
      from public.money_categories
     where family_id = v_family and kind = 'income' and parent_id is null
     order by (name = '給与') desc, position
     limit 1;

    if v_parent is null then
      insert into public.money_categories (family_id, kind, parent_id, name, icon, position)
      values (v_family, 'income', null, '給与', 'salary', 0)
      returning id into v_parent;
    end if;

    insert into public.money_categories (family_id, kind, parent_id, name, position)
    select v_family, 'income', v_parent, item.name,
           (coalesce((select max(position) + 1 from public.money_categories where parent_id = v_parent), 0)
            + row_number() over (order by item.position, item.created_at) - 1)::integer
      from public.special_items as item
     where item.family_id = v_family
       and item.kind = 'income'
       and not exists (
         select 1 from public.money_categories as c
          where c.family_id = v_family and c.parent_id = v_parent and c.name = item.name
       );
  end loop;
end;
$$;
