-- かぞく手帳: Zaim の入出金通知メールから口座の明細を取り込む（docs/kakei.md §9.5）
--
-- 流れ: Gmail の Apps Script → Edge Function money-feed-ingest（鍵を確かめ、メールを読む）→
--       money_feed_receive（明細を入れる）→ money_feed_process（口座を決め、突き合わせる）
--
--   money_feed_settings  取り込みの設定（家族で1行。開始日時・突き合わせの幅）
--   money_feed_tokens    取り込みの鍵（ハッシュだけ持つ。アプリからは読めない）
--   money_feed           明細（メール1通で1行）
--   money_feed_rules     取り込みのルール（条件と動き。§9.5.6）
--   money_wallets に     feed_name（Zaim での口座名）・holder_name・holder_zaim_email・holder_kana（所持者。§9.5.3）
--   money_records に     feed_id（どの明細から来たか）
--
-- 適用の順序: 先にこれを適用し、Edge Function を出す。アプリは表を読まないだけで、今までどおり動く

-- ============================================================
-- 1. 出金元・記録に足す列
-- ============================================================
alter table public.money_wallets
  add column if not exists feed_name text,
  add column if not exists holder_name text,
  add column if not exists holder_zaim_email text,
  add column if not exists holder_kana text;

comment on column public.money_wallets.feed_name is 'Zaim での口座名（通知メールの件名の口座名）。docs/kakei.md §9.5.3';
comment on column public.money_wallets.holder_name is '所持者の表示名（本人・妻・子など）。§9.5.3';
comment on column public.money_wallets.holder_zaim_email is '所持者の Zaim のアカウント（Zaim に登録したメールアドレス＝通知の宛先）。§9.5.3';
comment on column public.money_wallets.holder_kana is '口座の名義（カナ）。振込の依頼人名と比べる。§9.5.3';

create unique index if not exists money_wallets_feed_key
  on public.money_wallets (family_id, lower(holder_zaim_email), feed_name)
  where holder_zaim_email is not null and feed_name is not null and archived_at is null;

-- ============================================================
-- 2. money_feed_settings: 取り込みの設定
-- ============================================================
create table if not exists public.money_feed_settings (
  family_id uuid primary key references public.families (id) on delete cascade,
  -- これより前に届いたメールは取り込まない
  start_at timestamptz not null default now(),
  -- 突き合わせの幅（日）
  pair_days integer not null default 3 check (pair_days between 0 and 14),
  estimate_days integer not null default 5 check (estimate_days between 0 and 14),
  manual_days integer not null default 3 check (manual_days between 0 and 14),
  updated_at timestamptz not null default now()
);

comment on table public.money_feed_settings is
  'Zaim 取り込みの設定（開始日時・振替の組み合わせ／自動の記録との照合／手入力との確認の日数）。docs/kakei.md §9.5.6';

alter table public.money_feed_settings enable row level security;
drop policy if exists "money_feed_settings_family_all" on public.money_feed_settings;
create policy "money_feed_settings_family_all" on public.money_feed_settings
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop trigger if exists money_feed_settings_set_updated_at on public.money_feed_settings;
create trigger money_feed_settings_set_updated_at
  before update on public.money_feed_settings
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 3. money_feed_tokens: 取り込みの鍵（ハッシュ）
-- ============================================================
create table if not exists public.money_feed_tokens (
  family_id uuid primary key references public.families (id) on delete cascade,
  -- 鍵の SHA-256（16進）。鍵そのものは持たない
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.money_feed_tokens is
  'Zaim 取り込みの鍵の SHA-256。Edge Function が service role で引く。アプリからは読めない（ポリシー無し）。§9.5.2';

alter table public.money_feed_tokens enable row level security;

-- 鍵を作り直す（家族の人が呼ぶ）。鍵は返り値で1回だけ見せる
create or replace function public.money_feed_issue_token()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_family uuid := public.current_family_id();
  v_token text;
begin
  if v_family is null then
    raise exception 'not in a family';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.money_feed_tokens (family_id, token_hash)
  values (v_family, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (family_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  insert into public.money_feed_settings (family_id) values (v_family) on conflict (family_id) do nothing;
  return v_token;
end;
$$;

revoke execute on function public.money_feed_issue_token() from public, anon;
grant execute on function public.money_feed_issue_token() to authenticated;

-- ============================================================
-- 4. money_feed: 明細
-- ============================================================
create table if not exists public.money_feed (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  source text not null default 'zaim_mail' check (source in ('zaim_mail')),
  -- Gmail のメッセージID。同じメールは1回だけ
  source_id text not null,
  received_at timestamptz not null,
  to_email text,
  subject text not null default '',
  raw_line text not null default '',
  -- 読めないメールは null のまま
  direction text check (direction in ('in', 'out')),
  occurred_on date,
  amount integer check (amount is null or amount > 0),
  account_name text,
  description text not null default '',
  wallet_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'confirm', 'linked', 'created', 'ignored', 'unreadable')),
  -- 振替の相手の明細
  pair_id uuid references public.money_feed (id) on delete set null,
  record_id uuid,
  rule_id uuid,
  -- 確認・候補に出す記録
  candidate_record_ids uuid[] not null default '{}',
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_feed_source_key unique (family_id, source, source_id),
  constraint money_feed_id_family_key unique (id, family_id),
  constraint money_feed_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (wallet_id),
  constraint money_feed_record_fkey foreign key (record_id, family_id)
    references public.money_records (id, family_id) on delete set null (record_id)
);

comment on table public.money_feed is
  'Zaim の入出金通知メールから取り込んだ口座の明細。突き合わせて記録に結ぶ・作る。docs/kakei.md §9.5';

create index if not exists idx_money_feed_family_status on public.money_feed (family_id, status);
create index if not exists idx_money_feed_family_occurred on public.money_feed (family_id, occurred_on);
create index if not exists idx_money_feed_wallet_id on public.money_feed (wallet_id);
create index if not exists idx_money_feed_record_id on public.money_feed (record_id);
create index if not exists idx_money_feed_pair_id on public.money_feed (pair_id);
create index if not exists idx_money_feed_resolved_by on public.money_feed (resolved_by);

drop trigger if exists money_feed_set_updated_at on public.money_feed;
create trigger money_feed_set_updated_at
  before update on public.money_feed
  for each row
  execute function public.set_updated_at();

-- 入れるのは関数（Edge Function）だけ。アプリは読む・状態を変える
alter table public.money_feed enable row level security;
drop policy if exists "money_feed_family_select" on public.money_feed;
create policy "money_feed_family_select" on public.money_feed
  for select using (family_id = public.current_family_id());
drop policy if exists "money_feed_family_update" on public.money_feed;
create policy "money_feed_family_update" on public.money_feed
  for update using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

alter table public.money_records
  add column if not exists feed_id uuid;
alter table public.money_records
  drop constraint if exists money_records_feed_fkey;
alter table public.money_records
  add constraint money_records_feed_fkey foreign key (feed_id, family_id)
    references public.money_feed (id, family_id) on delete set null (feed_id);
create index if not exists idx_money_records_feed_id on public.money_records (feed_id);

comment on column public.money_records.feed_id is
  'どの明細（money_feed）から来たか。振替は出金側の明細。docs/kakei.md §9.5.4';

-- ============================================================
-- 5. money_feed_rules: 取り込みのルール
-- ============================================================
create table if not exists public.money_feed_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  position integer not null default 0,
  name text not null default '',
  -- 条件
  wallet_id uuid,
  direction text check (direction in ('in', 'out')),
  match text not null default 'contains' check (match in ('contains', 'key')),
  pattern text not null default '',
  amount_min integer check (amount_min is null or amount_min >= 0),
  amount_max integer check (amount_max is null or amount_max >= 0),
  -- 動き
  action text not null check (action in ('record', 'transfer', 'link_recurring', 'adjust_only', 'ignore')),
  record_kind text check (record_kind in ('expense', 'income')),
  category_id uuid,
  store text not null default '',
  to_wallet_id uuid,
  recurring_id uuid references public.money_recurring (id) on delete cascade,
  -- 「次から同じ内容は自動で」で作ったルール
  learned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_feed_rules_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete cascade,
  constraint money_feed_rules_to_wallet_fkey foreign key (to_wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete cascade,
  constraint money_feed_rules_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id) on delete set null (category_id),
  constraint money_feed_rules_action_fields_check check (
    (action = 'record' and record_kind is not null)
    or (action = 'transfer' and to_wallet_id is not null)
    or (action = 'link_recurring' and recurring_id is not null)
    or action in ('adjust_only', 'ignore')
  )
);

comment on table public.money_feed_rules is
  'Zaim 取り込みのルール（条件と動き）。上（position の小さい順）から見て、最初に当たったものを使う。docs/kakei.md §9.5.6';

create index if not exists idx_money_feed_rules_family on public.money_feed_rules (family_id, position);
create index if not exists idx_money_feed_rules_wallet_id on public.money_feed_rules (wallet_id);
create index if not exists idx_money_feed_rules_to_wallet_id on public.money_feed_rules (to_wallet_id);
create index if not exists idx_money_feed_rules_category_id on public.money_feed_rules (category_id);
create index if not exists idx_money_feed_rules_recurring_id on public.money_feed_rules (recurring_id);

drop trigger if exists money_feed_rules_set_updated_at on public.money_feed_rules;
create trigger money_feed_rules_set_updated_at
  before update on public.money_feed_rules
  for each row
  execute function public.set_updated_at();

alter table public.money_feed_rules enable row level security;
drop policy if exists "money_feed_rules_family_all" on public.money_feed_rules;
create policy "money_feed_rules_family_all" on public.money_feed_rules
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 6. 内容の決まった部分（覚えたルールの条件）
--    全角半角をそろえ、（依頼人名:…）・管理番号・数字を除き、空白を1つに
-- ============================================================
create or replace function public.money_feed_key(p_description text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(normalize(coalesce(p_description, ''), NFKC), '\(依頼人名:[^()]*\)', '', 'g'),
        '管理番号:\S*', '', 'g'),
      '[0-9]+', '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- 依頼人名（自分の口座から振り込んだ出金は、口座の名義になる）
create or replace function public.money_feed_requester(p_description text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(regexp_replace(
    substring(normalize(coalesce(p_description, ''), NFKC) from '依頼人名:\s*([^:()]*?)\s*(?:振込予定日|\)|$)'),
    '\s+', ' ', 'g')), '');
$$;

-- 記録の額（品目の合計）
create or replace function public.money_record_amount(p_record uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(amount), 0)::integer from public.money_items where record_id = p_record;
$$;

-- ============================================================
-- 7. money_feed_process: 口座を決め、突き合わせる（§9.5.3・§9.5.4）
-- ============================================================
create or replace function public.money_feed_process(p_feed uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.money_feed;
  s public.money_feed_settings;
  v_wallets uuid[];
  v_requester text;
  v_pairs uuid[];
  g public.money_feed;
  v_out public.money_feed;
  v_in public.money_feed;
  v_cands uuid[];
  r public.money_feed_rules;
  v_record uuid;
  v_kind text;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.status not in ('pending') or f.direction is null then
    return coalesce(f.status, 'missing');
  end if;
  select * into s from public.money_feed_settings where family_id = f.family_id;
  if not found then
    insert into public.money_feed_settings (family_id) values (f.family_id) returning * into s;
  end if;

  -- 1. 口座を決める（§9.5.3）
  if f.wallet_id is null then
    -- 宛先と口座名
    select array_agg(id) into v_wallets from public.money_wallets
     where family_id = f.family_id and archived_at is null and feed_name = f.account_name
       and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
    -- 2つ以上なら、依頼人名と名義
    if coalesce(array_length(v_wallets, 1), 0) > 1 then
      v_requester := public.money_feed_requester(f.description);
      if v_requester is not null then
        select array_agg(id) into v_wallets from public.money_wallets
         where id = any (v_wallets)
           and regexp_replace(normalize(coalesce(holder_kana, ''), NFKC), '\s+', ' ', 'g') = v_requester;
      end if;
    end if;
    -- 覚えたルールで口座が決まっているもの
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      select array_agg(distinct fr.wallet_id) into v_wallets from public.money_feed_rules fr
       join public.money_wallets w on w.id = fr.wallet_id
       where fr.family_id = f.family_id and fr.match = 'key' and fr.wallet_id is not null
         and w.feed_name = f.account_name
         and (fr.direction is null or fr.direction = f.direction)
         and fr.pattern = public.money_feed_key(f.description);
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      return 'pending';  -- 口座を選んでもらう
    end if;
    f.wallet_id := v_wallets[1];
    update public.money_feed set wallet_id = f.wallet_id where id = f.id;
  end if;

  -- 2. 振替の組み合わせ（§9.5.4 の1）。先に届いた片方が手入力との確認に入っていても組む
  select array_agg(id) into v_pairs from public.money_feed
   where family_id = f.family_id and id <> f.id and status in ('pending', 'confirm') and pair_id is null
     and direction is not null and direction <> f.direction and amount = f.amount
     and wallet_id is not null and wallet_id <> f.wallet_id
     and abs(occurred_on - f.occurred_on) <= s.pair_days;
  if coalesce(array_length(v_pairs, 1), 0) = 1 then
    select * into g from public.money_feed where id = v_pairs[1] for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
    update public.money_feed set pair_id = g.id where id = f.id;
    update public.money_feed set pair_id = f.id where id = g.id;

    -- 手入力との確認（§9.5.5）: 同じ組の振替、出金側の支出、入金側の収入
    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - v_out.occurred_on) <= s.manual_days
       and public.money_record_amount(rec.id) = f.amount
       and ((rec.kind = 'transfer' and rec.wallet_id = v_out.wallet_id and rec.to_wallet_id = v_in.wallet_id)
            or (rec.kind = 'expense' and rec.wallet_id = v_out.wallet_id)
            or (rec.kind = 'income' and rec.wallet_id = v_in.wallet_id));
    if v_cands is not null then
      update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id in (f.id, g.id);
      return 'confirm';
    end if;

    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
    values (f.family_id, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id)
    returning id into v_record;
    insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    update public.money_feed set status = 'created', record_id = v_record where id in (f.id, g.id);
    return 'created';
  end if;
  if coalesce(array_length(v_pairs, 1), 0) > 1 then
    update public.money_feed set candidate_record_ids = '{}' where id = f.id;
    return 'pending';  -- 相手が2つ以上: 確認に回す
  end if;

  -- 3. 取り込みのルール（§9.5.6）
  select * into r from public.money_feed_rules fr
   where fr.family_id = f.family_id
     and (fr.wallet_id is null or fr.wallet_id = f.wallet_id)
     and (fr.direction is null or fr.direction = f.direction)
     and (fr.amount_min is null or f.amount >= fr.amount_min)
     and (fr.amount_max is null or f.amount <= fr.amount_max)
     and case fr.match
           when 'key' then fr.pattern = public.money_feed_key(f.description)
           else fr.pattern = '' or position(normalize(fr.pattern, NFKC) in normalize(f.description, NFKC)) > 0
         end
   order by fr.position, fr.created_at
   limit 1;
  if found then
    update public.money_feed set rule_id = r.id where id = f.id;
    if r.action = 'ignore' then
      update public.money_feed set status = 'ignored' where id = f.id;
      return 'ignored';
    end if;
    if r.action in ('link_recurring', 'adjust_only') then
      select array_agg(rec.id order by abs(rec.occurred_on - f.occurred_on)) into v_cands
        from public.money_records rec
        left join public.money_wallets card on card.id = rec.to_wallet_id
       where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
         and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
         and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
         and case r.action
               when 'link_recurring' then rec.recurring_id = r.recurring_id
                 and (rec.wallet_id = f.wallet_id or rec.to_wallet_id = f.wallet_id)
               else rec.kind = 'transfer' and rec.recurring_id is null and rec.wallet_id = f.wallet_id
                 and card.type = 'card'
             end;
      -- カード代金が2枚以上: 額が同じもの
      if r.action = 'adjust_only' and coalesce(array_length(v_cands, 1), 0) > 1 then
        select array_agg(id) into v_cands from unnest(v_cands) as c(id)
         where public.money_record_amount(c.id) = f.amount;
      end if;
      if coalesce(array_length(v_cands, 1), 0) >= 1 and (r.action = 'link_recurring' or array_length(v_cands, 1) = 1) then
        perform public.money_feed_link(f.id, v_cands[1]);
        return 'linked';
      end if;
      if r.action = 'adjust_only' and v_cands is null then
        update public.money_feed set status = 'ignored' where id = f.id;
        return 'ignored';
      end if;
      update public.money_feed set candidate_record_ids = coalesce(v_cands, '{}') where id = f.id;
      return 'pending';
    end if;
  end if;

  -- 4. 自動で作った記録との照合（§9.5.4 の3）: 額が同じものが1つだけ
  if r.id is null then
    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
       and public.money_record_amount(rec.id) = f.amount
       and case f.direction
             when 'out' then rec.wallet_id = f.wallet_id and rec.kind in ('expense', 'transfer')
             else (rec.kind = 'income' and rec.wallet_id = f.wallet_id) or (rec.kind = 'transfer' and rec.to_wallet_id = f.wallet_id)
           end;
    if coalesce(array_length(v_cands, 1), 0) = 1 then
      perform public.money_feed_link(f.id, v_cands[1]);
      return 'linked';
    end if;
  end if;

  -- 5. 手入力との確認（§9.5.4 の4）
  v_kind := case f.direction when 'out' then 'expense' else 'income' end;
  select array_agg(rec.id) into v_cands from public.money_records rec
   where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
     and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
     and abs(rec.occurred_on - f.occurred_on) <= s.manual_days
     and public.money_record_amount(rec.id) = f.amount
     and ((rec.kind = v_kind and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'out' and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'in' and rec.to_wallet_id = f.wallet_id));
  if v_cands is not null then
    update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id = f.id;
    return 'confirm';
  end if;

  -- ルールで作る動き（手入力が無いと分かってから作る）
  if r.id is not null and r.action in ('record', 'transfer') then
    if r.action = 'record' then
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
      values (f.family_id, r.record_kind, f.occurred_on, f.wallet_id, btrim(r.store), f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount, category_id)
      values (f.family_id, v_record, f.amount, r.category_id);
    else
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
      values (f.family_id, 'transfer', f.occurred_on,
              case f.direction when 'out' then f.wallet_id else r.to_wallet_id end,
              case f.direction when 'out' then r.to_wallet_id else f.wallet_id end, '', f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    end if;
    update public.money_feed set status = 'created', record_id = v_record where id = f.id;
    return 'created';
  end if;

  -- 6. 未確認
  return 'pending';
end;
$$;

-- 明細を記録に結び、額を明細の額にして確定する（品目が1つの記録だけ額を直す）
create or replace function public.money_feed_link(p_feed uuid, p_record uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.money_feed;
begin
  select * into f from public.money_feed where id = p_feed;
  update public.money_items set amount = f.amount
   where record_id = p_record
     and (select count(*) from public.money_items where record_id = p_record) = 1;
  update public.money_records set feed_id = coalesce(feed_id, f.id), is_estimate = false where id = p_record;
  update public.money_feed set status = 'linked', record_id = p_record, candidate_record_ids = '{}' where id = f.id;
end;
$$;

-- ============================================================
-- 8. money_feed_receive: 明細を入れて突き合わせる（Edge Function から service role で呼ぶ）
--    p_feed: { source_id, received_at, to_email, subject, raw_line,
--              direction, occurred_on, amount, account_name, description }（読めないときは direction 以下が無い）
-- ============================================================
create or replace function public.money_feed_receive(p_family uuid, p_feed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
  v_start timestamptz;
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_feed ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_feed (family_id, source_id, received_at, to_email, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, status)
  values (p_family, p_feed ->> 'source_id', (p_feed ->> 'received_at')::timestamptz,
          nullif(p_feed ->> 'to_email', ''), coalesce(p_feed ->> 'subject', ''), coalesce(p_feed ->> 'raw_line', ''),
          p_feed ->> 'direction', (p_feed ->> 'occurred_on')::date, (p_feed ->> 'amount')::integer,
          p_feed ->> 'account_name', coalesce(p_feed ->> 'description', ''),
          case when p_feed ->> 'direction' is null then 'unreadable' else 'pending' end)
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id, status into v_id, v_status from public.money_feed
     where family_id = p_family and source = 'zaim_mail' and source_id = p_feed ->> 'source_id';
    return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', true);
  end if;

  v_status := public.money_feed_process(v_id);
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

revoke execute on function public.money_feed_receive(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.money_feed_process(uuid) from public, anon, authenticated;
revoke execute on function public.money_feed_link(uuid, uuid) from public, anon, authenticated;

-- ============================================================
-- 9. 家族の同期（docs/sync.md）
-- ============================================================
select public.attach_family_sync('public.money_feed');
select public.attach_family_sync('public.money_feed_rules');
select public.attach_family_sync('public.money_feed_settings');

-- 取り込みの鍵は共有しない（アプリからは読めない）。付け忘れの調べ（0078）から外す
create or replace function public.family_sync_missing()
returns setof text
language sql
stable
set search_path = public
as $fn$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'family_id' and not a.attisdropped
    )
    and c.relname <> all (array[
      'family_sync', 'users', 'push_subscriptions', 'member_invites',
      'stock_expiry_deliveries', 'temperature_reminder_deliveries', 'money_feed_tokens'
    ])
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'family_sync_ins' and not t.tgisinternal
    )
  order by 1;
$fn$;
revoke execute on function public.family_sync_missing() from public, anon, authenticated;
