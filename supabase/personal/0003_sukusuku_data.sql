-- 旧プロジェクト sukusuku（nbkpwjtkkiaklewtegzh）の public のデータを、Persol の sukusuku スキーマへ写す。
-- 0001 の後に、Persol の SQL Editor で流す（データはDB同士で直接コピーし、外へは出さない）。
--
-- 流す前に、下の2か所を置き換える:
--   <OLD_POOLER_HOST> 旧プロジェクトの Connect → Session pooler の host（例: aws-0-ap-northeast-1.pooler.supabase.com）
--   <OLD_DB_PASSWORD> 旧プロジェクトのDBパスワード（分からなければ Database Settings で作り直してよい。
--                     アプリは API キーで接続しているので影響しない）
--
-- やること:
--   1. 旧DBを外部テーブルとして sukusuku_old / sukusuku_old_auth に見せる（postgres_fdw）
--   2. auth.users・auth.identities を写す。ただし overflow326@gmail.com は Persol に既にあるので写さない
--   3. sukusuku の全表を写す（トリガー・外部キーの確認は止める。行は旧DBのまま）
--   4. overflow326@gmail.com の旧ID 5a2160ea-… を、Persol の ID 58445d19-… へ付け替える
--   5. 最後に、表ごとの件数を旧DBと比べた結果を出す
-- 写し終えたら 0004_sukusuku_data_cleanup.sql で外部テーブルとつなぎを消す。

create extension if not exists postgres_fdw with schema extensions;

create server sukusuku_old foreign data wrapper postgres_fdw
  options (host '<OLD_POOLER_HOST>', port '5432', dbname 'postgres');
create user mapping for current_user server sukusuku_old
  options (user 'postgres.nbkpwjtkkiaklewtegzh', password '<OLD_DB_PASSWORD>');

create schema sukusuku_old;
import foreign schema public from server sukusuku_old into sukusuku_old;
create schema sukusuku_old_auth;
import foreign schema auth limit to (users, identities) from server sukusuku_old into sukusuku_old_auth;

begin;
-- 写すあいだはトリガー（updated_at の書き換え・家計への自動記録など）と外部キーの確認を止める
set local session_replication_role = replica;

do $$
declare
  old_owner constant uuid := '5a2160ea-42bc-4065-a0dc-d85635f08b26';
  new_owner constant uuid := '58445d19-03f6-4398-8a2e-387637f2b5e4';
  t record;
  tbl text;
  cols text;
begin
  -- 2. ログインユーザー（両方にある列だけ。生成列は除く）
  foreach tbl in array array['users', 'identities'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'auth' and c.table_name = tbl and c.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns f
                    where f.table_schema = 'sukusuku_old_auth' and f.table_name = tbl
                      and f.column_name = c.column_name);
    execute format('insert into auth.%I (%s) select %s from sukusuku_old_auth.%I where %I <> %L',
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

  -- 4. ユーザーIDの付け替え（users.id と、users・auth.users を指す列すべて）
  --    0002 のトリガーで Persol 側に空の行（家族なし）が先にできていたら、旧DBの行で置き換える
  delete from sukusuku.users where id = new_owner and family_id is null;
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

-- 5. 確かめる: 表ごとの件数（新・旧）と、旧IDが文字として残っている行の数。
--    new_rows = old_rows で old_id_left が全部 0 なら成功（食い違う表が先頭に並ぶ）
select * from (
  select c.relname as table_name,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku.%I', c.relname), false, true, '')))[1]::text::bigint as new_rows,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku_old.%I', c.relname), false, true, '')))[1]::text::bigint as old_rows,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) n from sukusuku.%I x where x::text like %L', c.relname, '%5a2160ea-42bc-4065-a0dc-d85635f08b26%'), false, true, '')))[1]::text::bigint as old_id_left
    from pg_class c
   where c.relnamespace = 'sukusuku'::regnamespace and c.relkind = 'r'
) r
order by new_rows <> old_rows desc, old_id_left <> 0 desc, table_name;
