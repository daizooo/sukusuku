-- 統合プロジェクト Persol で、すくすくが sukusuku スキーマの外に必要とするもの。
-- 0001_sukusuku_schema.sql の後に流す。名前はすべて sukusuku_ / sukusuku- で始め、
-- 他のアプリ（denken3 / fittrack / public）の物と衝突させない。
-- 定期実行（cron）は、旧プロジェクトと二重に通知を送らないよう、切り替えの日に 0005 で入れる。

-- 1. 拡張（Persol では未有効。Supabase の推奨どおり pg_net は extensions に置く）
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2. サインアップ時に sukusuku.users を作る（旧 0005）。
--    auth.users は Persol の全アプリで共有のため、他のアプリの登録でも sukusuku.users に1行できる
--    （行ができるだけで、家族に入らない限り何も見えない）。
create or replace trigger sukusuku_on_auth_user_created
  after insert on auth.users
  for each row execute function sukusuku.handle_new_auth_user();

-- 3. Realtime: 家族の変更台帳だけを配信する（docs/sync.md。旧 0078）
alter publication supabase_realtime add table sukusuku.family_sync;
