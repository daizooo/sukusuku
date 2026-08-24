-- すくすく手帳: nursing_alarms.user_id に索引を足す
--
-- Supabase の Performance Advisor が「外部キーに覆う索引が無い」と指摘するため。
-- 行数は「いま授乳中の端末」のぶんだけなので検索の速さには効かないが、
-- users を消したときのカスケードのために付けておく（push_subscriptions と同じ扱い）。
create index if not exists idx_nursing_alarms_user_id
  on public.nursing_alarms (user_id);
