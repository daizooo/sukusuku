-- public の表から anon の権限を外す（0122 の続き。Supabase の 2026-10-30 の仕様変更への対応の一部）。
--
-- anon はログイン前の呼び出し元。アプリが表を読み書きするのは、ログイン後（authenticated）と、
-- Edge Functions・cron（service_role）だけで、RLS のポリシーに anon 向けのものも無い。
-- なのに anon に全権限が付いていたのは、Supabase の既定の自動付与と 0045 の既定の権限のため。
--
-- 実害になっていた例: families_insert_any は with check (true)（ポリシーは to public）なので、
-- 公開されている anon キーだけで families に行を作れた。権限を外せば、ポリシーに届く前に拒否される。
--
-- ・いまある表（ビューを含む）から anon の権限をすべて外す
-- ・今後 postgres が public に作る表にも、anon を自動で付けない（0045 の既定の権限のうち anon の分）
-- 関数の実行権限（execute）と、authenticated・service_role の権限は変えない。
-- 行や物を消す文は無い。何度流しても同じ結果になる。

revoke all on all tables in schema public from anon;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
