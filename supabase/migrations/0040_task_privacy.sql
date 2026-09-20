-- すくすく手帳: 予定・タスクの共有設定（自分だけ/共有）
--
-- is_private = true の行は、作成した本人にしか見えないようにする。
-- 家族全員が見られる既定(is_private = false)の行は今までどおり。

alter table public.tasks
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists is_private boolean not null default false;

create index if not exists idx_tasks_created_by on public.tasks (created_by);

-- 1つの ALL ポリシーだったものを、参照(select)だけ自分限定の判定を挟めるよう
-- コマンドごとに分ける。
drop policy if exists "tasks_family_all" on public.tasks;

create policy "tasks_select_shared_or_own" on public.tasks
  for select using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  );

create policy "tasks_insert_family" on public.tasks
  for insert with check (family_id = public.current_family_id());

create policy "tasks_update_shared_or_own" on public.tasks
  for update using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  )
  with check (family_id = public.current_family_id());

create policy "tasks_delete_shared_or_own" on public.tasks
  for delete using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  );
