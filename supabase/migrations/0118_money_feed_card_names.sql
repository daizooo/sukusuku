-- かぞく手帳: 口座の対応をカード名ごとにし、使わなくなった行を外す（docs/kakei.md §9.9）
--
-- 三井住友カードの利用通知の口座名を、「Amazon」と「それ以外」の2つから、ご利用カードの名前そのもの
-- （「Ｏｌｉｖｅ／クレジット」「三井住友カードＶＩＳＡ（ＮＬ）」など）に変えた（Edge Function money-feed-ingest）。
-- Amazon のカード・楽天カードの利用通知は読み取りで捨てる。銀行の入出金（Zaim）はもう取り込まない。
--
--   1. 「三井住友カード」に結んでいた出金元を、NL のカード名に結び直す（今まで「三井住友カード」で届いていたのは NL と家族カード）
--   2. Amazon のカード・楽天カード・Zaim（銀行）の口座名を、出金元から外す（口座の対応に出なくなる。出金元・記録はそのまま）
--
-- 行を消す文は無い（列を null にするだけ）

-- 1. NL のカード名に結び直す
update public.money_wallets
   set feed_name = '三井住友カードＶＩＳＡ（ＮＬ）'
 where feed_name = '三井住友カード';

-- 2. 使わなくなった口座名を外す
update public.money_wallets w
   set feed_name = null, holder_zaim_email = null
 where w.feed_name in ('三井住友カード（Amazon）', '楽天カード')
    or (w.feed_name is not null
        and exists (select 1 from public.money_feed f
                     where f.family_id = w.family_id and f.account_name = w.feed_name and f.source = 'zaim_mail')
        and not exists (select 1 from public.money_feed f
                         where f.family_id = w.family_id and f.account_name = w.feed_name and f.source = 'card_mail'));
