-- Supabaseの仕様変更（2026-10-30）への対応: public の表への Data API 権限を、migration で明示する。
--
-- 2026-10-30 以降、public に新しく作る表には、明示的な GRANT が無いと supabase-js / PostgREST から
-- 触れない（permission denied）。既存の表は影響を受けない。ただし migration でスキーマを作り直す場合
-- （新しいプロジェクト・preview ブランチ・supabase db reset）は、権限の自動付与が無いので、
-- 0045 より前に作った表（0001〜0044）には権限が付かない。0045 の alter default privileges は
-- 0045 より後に作る表にしか効かず、本番DBの既定の権限（pg_default_acl）が外されても同じ。
--
-- そこで、いまある表すべてに、必要な権限を明示する。
--   ・authenticated: select / insert / update / delete（行の絞り込みは RLS が行う）
--   ・service_role : all（Edge Functions と cron が使う）
--   ・anon         : 付けない（RLS のポリシーに anon 向けのものは無く、ログイン前に直接読む表も無い）
-- 何度流しても同じ結果になる（grant は冪等）。本番では既に付いている権限と同じなので何も変わらない。
-- 権限を外す文は無い（本番の anon に残っている権限はそのままにする）。
--
-- 列・表を絞っているものは、絞った形のまま明示する（0077・0078 と同じ）:
--   ・users          : authenticated は select のみ。更新できる列（start_tab・show_care_tab）は 0077 の列の権限
--   ・family_sync    : authenticated は select のみ（0078）
--   ・member_invites : authenticated には何も付けない（関数からだけ触る。0077）
-- これらの表の service_role だけは、ここで all を明示する。

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('users', 'family_sync', 'member_invites')
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t.tablename
    );
    execute format('grant all on public.%I to service_role', t.tablename);
  end loop;
end $$;

grant select on public.users to authenticated;
grant select on public.family_sync to authenticated;

grant all on public.users to service_role;
grant all on public.family_sync to service_role;
grant all on public.member_invites to service_role;
