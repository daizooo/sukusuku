-- すくすく手帳: 授乳の経過時間お知らせをサーバーからも鳴らす
--
-- 授乳中は画面を見られないため、一定間隔で音とバイブを鳴らしている
-- (src/lib/nursingTimer.ts)。ただしブラウザは画面が消える・裏に回ると
-- タイマーを間引くため、お知らせが遅れる/鳴らないことがある。
-- iOS Safari はそもそも振動できない。
--
-- そこで「次に鳴らす時刻」をサーバーにも預けておき、端末が鳴らせなかった分を
-- Edge Function `send-nursing-alarms` が Web Push で鳴らす。
-- 予定のリマインダー(0012)と同じ購読情報(push_subscriptions)を使う。

-- ============================================================
-- 1. nursing_alarms: 計測中の端末が預ける「鳴らす基準」
-- ============================================================
-- 計測は端末内(localStorage)で完結しているので、行が増えるのは
-- 「いま計測している端末」のぶんだけ。計測を止めると端末側が消す。
--
-- baseline_at は「計測中の側の合計時間が0だった時刻」。
-- 左右を行き来しても、その側の経過時間で数えるため、
-- 端末側が (いまの時刻 - その側の合計時間) を入れる。
-- 経過分数 = now() - baseline_at で求まる。
create table if not exists public.nursing_alarms (
  -- 端末ごとに1つ。購読が消えれば(通知オフ・失効)このお知らせも消える。
  subscription_id uuid primary key references public.push_subscriptions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- 計測中の側。通知の文面に出す。
  side text not null check (side in ('left', 'right')),
  baseline_at timestamptz not null,
  -- 何分ごとに鳴らすか。端末側の設定(既定5分)をそのまま預かる。
  interval_minutes integer not null check (interval_minutes between 1 and 60),
  -- 何回目のお知らせまで済んだか。端末が自分で鳴らせたときもここへ書き戻すので、
  -- 画面を開いている間はサーバーからは送られない。
  notified_step integer not null default 0 check (notified_step >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.nursing_alarms is
  '授乳の経過時間お知らせを、端末が鳴らせなかったときにサーバーから鳴らすための予約。Edge Function send-nursing-alarms が参照する。';
comment on column public.nursing_alarms.baseline_at is
  '計測中の側の合計時間が0だった時刻。経過分数 = now() - baseline_at。';
comment on column public.nursing_alarms.notified_step is
  '何回目のお知らせまで済んだか。端末が自分で鳴らしたぶんも含む。';

-- ============================================================
-- 2. Row Level Security
-- ============================================================
-- 自分の端末のぶんだけ読み書きできる。
-- (他人の行を消せてしまうと、パートナーのお知らせを勝手に止められるため)
alter table public.nursing_alarms enable row level security;

create policy "nursing_alarms_own_select" on public.nursing_alarms
  for select using (user_id = (select auth.uid()));

create policy "nursing_alarms_own_insert" on public.nursing_alarms
  for insert with check (
    user_id = (select auth.uid())
    -- 他人の購読IDを指定して、その端末を鳴らせないようにする
    and exists (
      select 1 from public.push_subscriptions s
      where s.id = subscription_id and s.user_id = (select auth.uid())
    )
  );

create policy "nursing_alarms_own_update" on public.nursing_alarms
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "nursing_alarms_own_delete" on public.nursing_alarms
  for delete using (user_id = (select auth.uid()));
