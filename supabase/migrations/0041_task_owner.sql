-- すくすく手帳: 予定・タスクの「主体」(owner) 導入
--
-- 複数選択の participants(参加者) から、色分けの基準にする「主体」を
-- 1人だけ選べる owner として切り出す。owner は participants に含まれる
-- 想定（アプリ側で主体を選ぶと参加者にも加える）だが、DB側では強制しない。

alter table public.tasks
  add column if not exists owner text;

alter table public.tasks drop constraint if exists tasks_owner_check;
alter table public.tasks
  add constraint tasks_owner_check check (owner is null or owner in ('大造', 'いづみ', '岳'));

-- 既存データの補完: 参加者がちょうど1人の行だけ、その人を主体とみなす。
-- 0人・複数人の行は主体未設定のままにする（色は今までどおりの既定色になる）。
update public.tasks
   set owner = participants[1]
 where owner is null
   and array_length(participants, 1) = 1;
