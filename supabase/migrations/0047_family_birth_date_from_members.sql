-- かぞく手帳: 子の誕生日の置き場所を family_members に移したことへの追従（docs/family-app.md §3）
--
-- 予定のリマインダー（task_reminder_schedule）は「生後n日」の予定の日付を
-- family_birth_date() で出している。設定タブで誕生日を family_members に入れるように
-- なるので、こちらを先に読み、無ければ従来の family_profiles を読む。
-- 引数・戻り値・権限（配信専用）は 0012 のまま変えない。

create or replace function public.family_birth_date(p_family_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_birth date;
  v_value text;
begin
  select m.birth_date
    into v_birth
    from public.family_members m
   where m.family_id = p_family_id
     and m.relation = 'child'
     and m.birth_date is not null
   order by m.sort_order
   limit 1;

  if v_birth is not null then
    return v_birth;
  end if;

  select field.value ->> 'value'
    into v_value
    from public.family_profiles p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.child_fields) = 'array' then p.child_fields else '[]'::jsonb end
    ) as field(value)
   where p.family_id = p_family_id
     and field.value ->> 'key' = 'birthDate'
   limit 1;

  if v_value is null or v_value = '' then
    return null;
  end if;

  return v_value::date;
exception
  when others then
    -- 日付として読めない値が入っていても配信全体を落とさない
    return null;
end;
$fn$;
