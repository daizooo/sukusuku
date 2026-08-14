-- すくすく手帳: カレンダー機能のためのカラム追加
--
-- 予定に「日付・時刻・場所・詳細・ラベル・リマインダー」を持たせる。
-- これまで日付は days_after_birth（出生日からの日数）だけで表現しており、
-- 出生日と無関係な日付や時刻を持てなかった。

-- ============================================================
-- 1. 日付・時刻
-- ============================================================
-- 終日予定は start_time を null にする。
-- タイムゾーン起因の日付ズレを避けるため timestamptz ではなく date + time で保持する
-- （家族全員が同一タイムゾーンにいる前提）。
alter table public.tasks
  add column if not exists start_date date,
  add column if not exists start_time time,
  add column if not exists end_time   time;

-- ============================================================
-- 2. 日付の決まり方: 出生日基準 / 日付指定
-- ============================================================
alter table public.tasks
  add column if not exists anchor_type text not null default 'absolute';

alter table public.tasks drop constraint if exists tasks_anchor_type_check;
alter table public.tasks
  add constraint tasks_anchor_type_check
    check (anchor_type in ('birth_relative', 'absolute'));

-- 既存の予定はすべて days_after_birth から生成されているため出生日基準に寄せる。
-- start_date は出生日が登録された時点で refresh_birth_relative_dates() が埋める。
update public.tasks set anchor_type = 'birth_relative';

-- ============================================================
-- 3. ラベル (パパ / ママ / 家族)
-- ============================================================
-- 旧値 '二人で' '未定' は '家族' に寄せる。
-- ここでは新旧どちらの値も許可する制約に広げておく。旧コードが動いている
-- 本番デプロイを壊さないための措置で、マージ後に 0007 で3値へ絞る。
alter table public.tasks drop constraint if exists tasks_assignee_check;
alter table public.tasks
  add constraint tasks_assignee_check
    check (assignee in ('パパ', 'ママ', '家族', '二人で', '未定'));

update public.tasks set assignee = '家族' where assignee in ('二人で', '未定');
alter table public.tasks alter column assignee set default '家族';

-- ============================================================
-- 4. リマインダー
-- ============================================================
-- 予定の何分前に通知するか。null は通知なし。
alter table public.tasks
  add column if not exists remind_minutes_before integer;

-- 既存の has_notification=true は「前日」(1440分前) として引き継ぐ。
update public.tasks
   set remind_minutes_before = 1440
 where has_notification and remind_minutes_before is null;

-- has_notification は remind_minutes_before に置き換わったが、旧コードが
-- 参照しているためこのマイグレーションでは削除しない（0007 で削除する）。
comment on column public.tasks.has_notification is
  '非推奨: remind_minutes_before に置き換え済み。次のマイグレーションで削除する。';

-- 出生日基準の予定の日付は「子の誕生日 + days_after_birth」で決まる。
-- 誕生日は family_profiles の child_fields (jsonb) に保存されるため、
-- 日付の解決はクライアント側(SukusukuApp の dynamicTodos)で行う。
-- start_date は日付指定(anchor_type = 'absolute')の予定でのみ使う。

-- ============================================================
-- 5. インデックス
-- ============================================================
create index if not exists idx_tasks_family_start_date
  on public.tasks (family_id, start_date);
