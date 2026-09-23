-- すくすく手帳: リストの共有設定（自分だけ/共有）
--
-- 予定・タスク（0040_task_privacy.sql）と同じ形をリストにも入れる。
-- is_private = true のリストは、作成した本人にしか見えない。
--
-- 単位は「リスト」。項目ごとに分けると追加のたびに選ぶことになり、
-- 「思い出した瞬間に打ち込む」手数が増えるため採らない（docs/lists.md §3 と同じ考え方）。
-- グループ・項目はリスト経由で家族を確かめているので、リストが見えなければ
-- 中身も見えない（下のポリシーで明示的に判定する）。

alter table public.lists
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists is_private boolean not null default false;

-- DB側の既定は共有(false)のままにする。既存のリストを黙って隠さないためと、
-- 共有設定を知らない古いAPKが作った行（created_by が入らない）が
-- 「自分だけ」になると、作った本人にも見えなくなるため。
-- 新しく作るリストを「自分だけ」にするのはアプリ側（リストの追加画面の既定値）。
comment on column public.lists.is_private is
  '自分だけのリストか。true の行は created_by の本人にしか見えない。新しく作るリストの既定はアプリ側で「自分だけ」にしている。';

create index if not exists idx_lists_created_by on public.lists (created_by);

-- ============================================================
-- ポリシー
-- ============================================================
-- 1つの ALL ポリシーだったものを、参照(select)だけ自分限定の判定を挟めるよう
-- コマンドごとに分ける（tasks と同じ形）。
drop policy if exists "lists_family_all" on public.lists;

create policy "lists_select_shared_or_own" on public.lists
  for select using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  );

create policy "lists_insert_family" on public.lists
  for insert with check (family_id = public.current_family_id());

create policy "lists_update_shared_or_own" on public.lists
  for update using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  )
  with check (family_id = public.current_family_id());

create policy "lists_delete_shared_or_own" on public.lists
  for delete using (
    family_id = public.current_family_id()
    and (not is_private or created_by = (select auth.uid()))
  );

-- グループ・項目は「そのリストが見えるか」だけで決まる。
-- lists 側のポリシーに任せても同じ結果になるが、入れ子のRLSに頼ると読んで分から
-- ないため、ここでも同じ判定を書く。
drop policy if exists "list_groups_family_all" on public.list_groups;
drop policy if exists "list_items_family_all" on public.list_items;

create policy "list_groups_visible_list" on public.list_groups
  for all using (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and l.family_id = public.current_family_id()
        and (not l.is_private or l.created_by = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and l.family_id = public.current_family_id()
        and (not l.is_private or l.created_by = (select auth.uid()))
    )
  );

create policy "list_items_visible_list" on public.list_items
  for all using (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and l.family_id = public.current_family_id()
        and (not l.is_private or l.created_by = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and l.family_id = public.current_family_id()
        and (not l.is_private or l.created_by = (select auth.uid()))
    )
  );
