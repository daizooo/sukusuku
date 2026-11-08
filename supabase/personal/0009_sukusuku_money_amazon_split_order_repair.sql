-- かぞく手帳: 同じ注文番号がお届けごとに2回出る注文メールで欠けた品目を補う（docs/kakei.md §9.13）
--
-- 2026-11-08 の注文メール（Gmail 1a1b837bccd894a4）は、注文番号 249-3049939-3299068 の見出しが2回あった
-- （ロンパース2点のブロックと、モップ＋「合計 10030 JPY」のブロック）。パーサー（_shared/amazonOrder.ts）が
-- ブロックごとに別の注文として渡したため、2つ目が money_amazon_order_receive の `on conflict do nothing` で
-- 重複として捨てられ、モップの品目と注文の合計（10,030円）が入らなかった（合計は 7,810円のまま）。
-- モップの発送メールは品目を注文に結べず、未確認の明細が出なかった。
--
-- パーサーは同じ注文番号のブロックを1注文にまとめるよう直した（Edge Function money-feed-ingest）。
-- この migration は、すでに欠けたこの注文だけを補う（行を消す文は無い。何度流しても同じ）。
--   1. 発送メールにあるが注文に無いモップの品目を、注文に足す（単価は注文メールの 2,220円）
--   2. 注文の合計を 7,810円から 10,030円（注文メールの「合計」）に直す
--   3. この注文を待っている荷物（モップ）の未確認の明細を作る（日付は発送日。額は注文の合計から配った 2,220円）
-- ロンパースの荷物の明細（7,810円）はそのまま。荷物の額の和 = 注文の合計（10,030円）になる。
-- 適用の順序: 先にこれを適用してから、Edge Function を出す（出したあとに同じ形のメールが来ても、1注文にまとまる）。

-- 1. 欠けた品目を足す ---------------------------------------------------------------

insert into sukusuku.money_amazon_lines (family_id, order_id, position, receipt_name, name, quantity, unit_price, amount)
select o.family_id, o.id,
       coalesce((select max(l.position) from sukusuku.money_amazon_lines l where l.order_id = o.id), -1) + 1,
       x.receipt_name, left(x.receipt_name, 40) || '…', 1, 2220, 2220
  from sukusuku.money_amazon_orders o
  join sukusuku.money_amazon_shipment_lines x on x.family_id = o.family_id and x.order_no = o.order_no
 where o.order_no = '249-3049939-3299068'
   and x.line_id is null
   and x.receipt_name like '山崎産業(Yamazaki Sangyo)%'
   and not exists (
     select 1 from sukusuku.money_amazon_lines l where l.order_id = o.id and l.receipt_name = x.receipt_name
   )
 group by o.family_id, o.id, x.receipt_name;

-- 2. 注文の合計（注文メールの「合計」）---------------------------------------------------

update sukusuku.money_amazon_orders
   set total = 10030
 where order_no = '249-3049939-3299068'
   and total = 7810;

-- 3. 待っていた荷物の明細を作る -------------------------------------------------------------

select sukusuku.money_amazon_shipment_feed(s.id)
  from sukusuku.money_amazon_shipments s
 where s.feed_id is null
   and exists (
     select 1 from sukusuku.money_amazon_shipment_lines x
      where x.shipment_id = s.id and x.order_no = '249-3049939-3299068'
   );
