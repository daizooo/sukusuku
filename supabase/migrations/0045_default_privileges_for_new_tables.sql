-- Supabaseが2026-10-30に行う仕様変更への対応。
-- 「public schemaに新規作成したテーブルへ、Data API(PostgREST)用の権限を
-- 自動付与する挙動」が既存プロジェクトについても廃止される。以後は
-- CREATE TABLEのたびに明示的なGRANTが必要になり、書き忘れると
-- そのテーブルだけAPI経由でアクセス不能(permission denied)になる。
--
-- 都度GRANTを書き忘れるリスクを無くすため、ALTER DEFAULT PRIVILEGESで
-- 「postgresロールがpublic schemaに作るテーブルには、以後anon/authenticated/
-- service_roleへ自動的に権限を与える」設定をこちらで明示的に持っておく。
-- 現状(pg_default_acl)で既に同じ内容がSupabase側の自動設定として入っており、
-- その内容をそのまま踏襲する形で明示化するだけなので、既存の挙動は変わらない。
--
-- マイグレーションはpostgresロールで実行されるため、FOR ROLE postgresとする。
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
