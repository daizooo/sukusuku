-- かぞく手帳: Gmail の取り込みを、メール1通ごとに覚える（docs/kakei.md §9.8）
--
-- 今までは Apps Script が、送ったスレッドにラベル「かぞく手帳済」を付け、ラベルの無いスレッドだけを探していた。
-- ラベルはスレッドに付くため、同じスレッドにあとから届いたメールが落ちることがあった。
-- これからは、受け取ったかどうかをサーバーがメール（Gmail のメッセージID）ごとに覚え、
-- ラベルは Gmail を見る人のための印として、メール1通ごとに付ける（未確認・済・対象外・読めない）。
--
--   money_feed_mails          受け取ったメール（1通1行）。どう扱ったか（outcome）と、Gmail に付けたラベル・ゴミ箱へ移した日時
--   money_feed_tokens に      last_sync_at（Apps Script が最後に動いた日時。1時間以上空いたら家計タブで知らせる）
--   money_feed_mail_record    Edge Function が、受け取ったメールの扱いを書く
--   money_feed_mail_sync      Edge Function が、Apps Script の見つけたIDのうちまだのものと、付け替えるラベル・ゴミ箱へ移すメールを返す
--   money_feed_last_sync      家計タブが、Apps Script が最後に動いた日時を読む
--
-- 適用の順序: これを適用し、Edge Function money-feed-ingest を出してから、Apps Script を貼り直す。
--   前の版の Apps Script のままでも、今までどおり取り込める（受け取ったメールは台帳にも書く）

-- 1. 表 ----------------------------------------------------------------------

create table if not exists public.money_feed_mails (
  family_id uuid not null references public.families (id) on delete cascade,
  -- Gmail のメッセージID
  message_id text not null,
  received_at timestamptz not null,
  -- feed: 明細にした（money_feed。ラベルは明細の状態で決まる） / order: Amazon の注文を覚えた /
  -- skipped: 取り込まない（0円の注文など） / unreadable: 読めない / before_start: 取り込みの開始より前
  outcome text not null check (outcome in ('feed', 'order', 'skipped', 'unreadable', 'before_start')),
  -- Apps Script が Gmail に付けたと伝えたラベル（open・done・skipped・unreadable）
  label text check (label in ('open', 'done', 'skipped', 'unreadable')),
  -- Apps Script がゴミ箱へ移したと伝えた日時
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, message_id)
);

comment on table public.money_feed_mails is
  'Gmail から受け取ったメール（1通1行）。Apps Script が同じメールを2回送らないため、ラベル・ゴミ箱をメールごとに決めるため。Edge Function money-feed-ingest だけが書く。docs/kakei.md §9.8';

create index if not exists money_feed_mails_open_idx
  on public.money_feed_mails (family_id)
  where trashed_at is null;

alter table public.money_feed_mails enable row level security;

drop trigger if exists money_feed_mails_set_updated_at on public.money_feed_mails;
create trigger money_feed_mails_set_updated_at
  before update on public.money_feed_mails
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_feed_mails');

alter table public.money_feed_tokens add column if not exists last_sync_at timestamptz;

comment on column public.money_feed_tokens.last_sync_at is
  'Apps Script が最後に動いた日時（5分ごと）。1時間以上空いたら家計タブに「Gmail の取り込みが止まっています」。docs/kakei.md §9.8';

-- 2. 今までに受け取ったメールを台帳に入れる --------------------------------------
--   明細（カードの利用通知は1通に何件もあると「ID#2」…）と、Amazon の注文（1通に何件も入る）から

insert into public.money_feed_mails (family_id, message_id, received_at, outcome)
select distinct on (family_id, split_part(source_id, '#', 1))
       family_id, split_part(source_id, '#', 1), received_at, 'feed'
  from public.money_feed
 order by family_id, split_part(source_id, '#', 1), received_at
on conflict (family_id, message_id) do nothing;

insert into public.money_feed_mails (family_id, message_id, received_at, outcome)
select distinct on (family_id, source_id) family_id, source_id, created_at, 'order'
  from public.money_amazon_orders
 order by family_id, source_id, created_at
on conflict (family_id, message_id) do nothing;

-- 3. 受け取ったメールの扱いを書く（Edge Function が呼ぶ） -----------------------------
--   p_mails: [{ message_id, received_at, outcome }]。同じメールをまた受け取ったら、扱いを書き直す（ラベルはそのまま）

create or replace function public.money_feed_mail_record(p_family uuid, p_mails jsonb)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.money_feed_mails (family_id, message_id, received_at, outcome)
  select p_family, m ->> 'message_id', (m ->> 'received_at')::timestamptz, m ->> 'outcome'
    from jsonb_array_elements(p_mails) as m
  on conflict (family_id, message_id) do update set outcome = excluded.outcome
   where public.money_feed_mails.outcome is distinct from excluded.outcome;
$function$;

revoke execute on function public.money_feed_mail_record(uuid, jsonb) from public, anon, authenticated;

-- 4. Apps Script との同期（Edge Function が呼ぶ） ---------------------------------
--   p_ids:     Apps Script が Gmail で見つけたメールのID
--   p_applied: Apps Script が付けたラベル・ゴミ箱へ移したメール [{ id, label, trashed }]
--   返り値 { missing: まだ受け取っていないID, changes: [{ id, label, trash }] }
--   ラベル: open（未確認・確認がある）/ done（記録した・記録しない、注文） / skipped（取り込まない） / unreadable（読めない）
--   ゴミ箱: 明細が全部片づいたメールと、取り込まないメール。注文のメール・読めないメール・開始より前のメールは残す

create or replace function public.money_feed_mail_sync(p_family uuid, p_ids text[], p_applied jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_missing jsonb;
  v_changes jsonb;
begin
  update public.money_feed_mails m
     set label = coalesce(nullif(a ->> 'label', ''), m.label),
         trashed_at = case when (a ->> 'trashed')::boolean then coalesce(m.trashed_at, now()) else m.trashed_at end
    from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) as a
   where m.family_id = p_family and m.message_id = a ->> 'id';

  update public.money_feed_tokens set last_sync_at = now() where family_id = p_family;

  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_missing
    from unnest(coalesce(p_ids, '{}'::text[])) as i (id)
   where not exists (select 1 from public.money_feed_mails m where m.family_id = p_family and m.message_id = i.id);

  with states as (
    select m.message_id, m.label as applied, m.outcome, f.n, f.unreadable, f.open
      from public.money_feed_mails m
      left join lateral (
        select count(*) as n,
               bool_or(x.status = 'unreadable') as unreadable,
               bool_or(x.status in ('pending', 'confirm')) as open
          from public.money_feed x
         where m.outcome = 'feed' and x.family_id = p_family
           and (x.source_id = m.message_id or x.source_id like m.message_id || '#%')
      ) f on true
     where m.family_id = p_family and m.trashed_at is null
  ), labels as (
    select message_id, applied,
           case
             when outcome = 'feed' and unreadable then 'unreadable'
             when outcome = 'feed' and open then 'open'
             when outcome in ('feed', 'order') then 'done'
             when outcome = 'unreadable' then 'unreadable'
             else 'skipped'
           end as label,
           (outcome = 'skipped' or (outcome = 'feed' and n > 0 and not unreadable and not open)) as trash
      from states
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', message_id, 'label', label, 'trash', trash)), '[]'::jsonb)
    into v_changes
    from (select * from labels where label is distinct from applied or trash limit 100) as c;

  return jsonb_build_object('missing', v_missing, 'changes', v_changes);
end;
$function$;

revoke execute on function public.money_feed_mail_sync(uuid, text[], jsonb) from public, anon, authenticated;

-- 5. Apps Script が最後に動いた日時（家計タブが読む） --------------------------------

create or replace function public.money_feed_last_sync()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select last_sync_at from public.money_feed_tokens where family_id = public.current_family_id();
$function$;

revoke execute on function public.money_feed_last_sync() from public, anon;
grant execute on function public.money_feed_last_sync() to authenticated;
