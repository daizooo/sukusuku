-- すくすく手帳: 授乳を「左5分 → 右5分 → ゲップ5分」の1セットとして計測する
--
-- ストップウォッチ(src/lib/nursingTimer.ts)にゲップの時間を加えたため、
-- サーバーへ預ける「いま計測している区切り」(side)にも 'burp' が入るようになった。
-- 中身は左右と同じで、5分たつと Edge Function send-nursing-alarms が Web Push で鳴らす。
--
-- ゲップの間も行が残るので、「そろそろ次の授乳」(0024)はこれまでどおり止まる
-- （授乳は済んでいて、まだ記録していない状態にあたる）。
alter table public.nursing_alarms
  drop constraint if exists nursing_alarms_side_check;

alter table public.nursing_alarms
  add constraint nursing_alarms_side_check check (side in ('left', 'right', 'burp'));

comment on column public.nursing_alarms.side is
  '計測中の区切り。left / right のほか、ゲップの時間は burp が入る。通知の文面に出す。';
