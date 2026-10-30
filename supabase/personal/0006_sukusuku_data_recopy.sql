-- 切り替えの日に、旧DBの最新を Persol の sukusuku へ写し直す。Persol の SQL Editor で流す（truncate を含むため）。
-- 0003 の fdw のつなぎ（sukusuku_old・sukusuku_old_auth）が残っていること。0004 より前に流す。
--
-- やること:
--   1. sukusuku の全表を空にする（プレビューでの確認中に Persol へ書いた分も消える。正は旧DB）
--   2. auth.users・auth.identities は、Persol に無い行だけ足す（既にある行は残す。ログイン中の端末を切らない）
--   3. 0003 と同じく全表を写し、overflow326@gmail.com の旧IDを Persol のIDへ付け替える
--   4. 表ごとの件数を旧DBと比べる（new_rows = old_rows、old_id_left が全部 0 なら成功）

begin;
set local session_replication_role = replica;

do $$
declare
  old_owner constant uuid := '5a2160ea-42bc-4065-a0dc-d85635f08b26';
  new_owner constant uuid := '58445d19-03f6-4398-8a2e-387637f2b5e4';
  t record;
  tbl text;
  cols text;
begin
  -- 1. sukusuku の全表を空にする（外から sukusuku を指す外部キーは無いので、cascade は付けない）
  select 'truncate ' || string_agg(format('sukusuku.%I', c.relname), ', ') into cols
    from pg_class c where c.relnamespace = 'sukusuku'::regnamespace and c.relkind = 'r';
  execute cols;

  -- 2. ログインユーザー（Persol に無い行だけ）
  foreach tbl in array array['users', 'identities'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'auth' and c.table_name = tbl and c.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns f
                    where f.table_schema = 'sukusuku_old_auth' and f.table_name = tbl
                      and f.column_name = c.column_name);
    execute format('insert into auth.%I (%s) select %s from sukusuku_old_auth.%I where %I <> %L on conflict do nothing',
      tbl, cols, cols, tbl, case tbl when 'users' then 'id' else 'user_id' end, old_owner);
  end loop;

  -- 3. sukusuku の全表
  for t in select c.relname from pg_class c
            where c.relnamespace = 'sukusuku'::regnamespace and c.relkind = 'r' order by 1 loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('sukusuku.%I', t.relname)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('insert into sukusuku.%I (%s) select %s from sukusuku_old.%I', t.relname, cols, cols, t.relname);
  end loop;

  -- ユーザーIDの付け替え（0003 と同じ）
  update sukusuku.users set id = new_owner where id = old_owner;
  for t in select c.conrelid::regclass as tbl, a.attname as col
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.connamespace = 'sukusuku'::regnamespace
              and c.confrelid in ('sukusuku.users'::regclass, 'auth.users'::regclass)
              and not (c.conrelid = 'sukusuku.users'::regclass and a.attname = 'id') loop
    execute format('update %s set %I = %L where %I = %L', t.tbl, t.col, new_owner, t.col, old_owner);
  end loop;
end
$$;

commit;

-- 4. 確かめる（食い違う表が先頭に並ぶ）
select * from (
  select c.relname as table_name,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku.%I', c.relname), false, true, '')))[1]::text::bigint as new_rows,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku_old.%I', c.relname), false, true, '')))[1]::text::bigint as old_rows,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku.%I x where x::text like %L', c.relname, '%5a2160ea-42bc-4065-a0dc-d85635f08b26%'), false, true, '')))[1]::text::bigint as old_id_left
    from pg_class c
   where c.relnamespace = 'sukusuku'::regnamespace and c.relkind = 'r'
) r
order by new_rows <> old_rows desc, old_id_left <> 0 desc, table_name;
