-- かぞく手帳: 契約のお知らせの既定を「30日前・7日前・前日」にし、更新したあとの古い節目を出さないようにする
-- （docs/contracts.md §3.1・§6）
--
-- 1. notify_days の既定を {60,30,7} から {30,7,1} に変える。新しく足す契約の既定だけが変わる
--    （今ある契約のお知らせの日数は、そのまま）。
-- 2. notify_after を足す。更新日（renews_on）を足した・直した日（日本時間）で、
--    「この日より後に来る節目だけ知らせる」の基準にする。
--    例: サブスクの更新日を1か月進めた直後は、新しい更新日の30日前がすでに過ぎている。
--    その節目を、更新した直後にお知らせしてしまわないための印。
--    更新日が変わったときだけ、トリガーが今日の日付を入れる（メモなどを直しても変わらない）。
--    今ある契約は null のまま = 従来どおり（制限なし）。
--
-- 小分類（category）の列は、画面からは外したが DB には残す（not null default '' なので、入れなくても困らない）。
-- 列を消す（drop column）のは削除にあたるため、この migration には含めない。
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）: 削除を含む文は無い。
-- 適用してから Edge Function `send-contract-reminders` を出し直し（notify_after を読む）、そのあとにアプリを出す。

-- 1. 既定のお知らせの日数 ------------------------------------------------------
alter table public.contracts
  alter column notify_days set default '{30,7,1}';

-- 2. お知らせの基準日 ---------------------------------------------------------
alter table public.contracts
  add column if not exists notify_after date;

comment on column public.contracts.notify_after is
  '更新日を足した・直した日（日本時間）。この日より後に来る節目だけお知らせする。null は制限なし';

create or replace function public.contracts_set_notify_after()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.renews_on is distinct from old.renews_on then
    new.notify_after := (now() at time zone 'Asia/Tokyo')::date;
  end if;
  return new;
end;
$$;

create or replace trigger set_contracts_notify_after
  before insert or update on public.contracts
  for each row
  execute function public.contracts_set_notify_after();
