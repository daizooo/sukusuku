-- 未確認の明細に入れていたお店の候補のうち、前の記録・AI の推測で入れたもの（外れることがあった）を外す。
-- これからはローマ字で当たったお店だけを入れる（Edge Function money-feed-ingest。docs/kakei.md §9.6.3）。
-- 対象は、まだ記録にしていないカードの利用通知だけ（記録にした明細のお店はそのまま）。
update public.money_feed
   set store_hint = null
 where source = 'card_mail'
   and status = 'pending'
   and store_hint is not null;
