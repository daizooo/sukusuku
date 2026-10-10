-- family_profiles と users.role を落とす（docs/family-app.md §3.6・§5 の6）
--
-- 家族の情報は family_members / families に、夫・妻の別は family_members.relation に移した。
-- アプリ（mobile・PWA）と DB の関数は、0078 から両方を使っていない。
-- 端末の入れ替え（0078 以降のビルド）を待ってから、2026-10-10 に SQL Editor で適用した
-- （削除を含むため。古い mobile のビルドは users.role を読むので、端末の入れ替えが先）。
-- 何度流しても同じ結果になる。

drop table if exists public.family_profiles;

alter table public.users drop constraint if exists users_role_check;
alter table public.users drop column if exists role;
