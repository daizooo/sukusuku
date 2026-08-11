-- 外部キーに対するインデックス追加（Performance Advisor対応）
create index if not exists idx_users_family_id on public.users (family_id);
create index if not exists idx_children_family_id on public.children (family_id);
create index if not exists idx_tasks_family_id on public.tasks (family_id);
create index if not exists idx_care_logs_family_id on public.care_logs (family_id);
create index if not exists idx_care_logs_created_by on public.care_logs (created_by);
create index if not exists idx_gifts_family_id on public.gifts (family_id);
create index if not exists idx_nurseries_family_id on public.nurseries (family_id);
create index if not exists idx_documents_family_id on public.documents (family_id);
create index if not exists idx_growth_records_child_id on public.growth_records (child_id);

-- users テーブルのRLSポリシーでauth.uid()を(select auth.uid())化し、行ごとの再評価を回避
drop policy if exists "users_select_self_or_family" on public.users;
create policy "users_select_self_or_family" on public.users
  for select using (id = (select auth.uid()) or family_id = public.current_family_id());

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users
  for insert with check (id = (select auth.uid()));

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
  for update using (id = (select auth.uid()));
