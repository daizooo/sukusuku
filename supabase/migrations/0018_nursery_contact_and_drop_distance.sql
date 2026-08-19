-- 見学候補の住所・電話番号を補完し、アクセス(distance)をやめる
--
-- 住所・電話番号を持たせる前に登録された見学候補の3園は、住所と電話番号が
-- 空のまま残っている。アプリ側の初期値と同じ内容で埋める（すでに入力済みの
-- 園は上書きしない）。
--
-- distance は「車5分」などのアクセスメモとして持っていたが、住所を持つように
-- なって役割が重なり、入力欄も増えるだけになったため削除する。

update public.nurseries
  set address = '熊本市南区城南町舞原291-7', phone = '0964-28-2121'
  where name = '舞原保育園' and coalesce(address, '') = '' and coalesce(phone, '') = '';

update public.nurseries
  set address = '熊本市南区城南町六田475-2', phone = '0964-28-6163'
  where name = 'くすのき保育園' and coalesce(address, '') = '' and coalesce(phone, '') = '';

update public.nurseries
  set address = '熊本市南区城南町隈庄736', phone = '0964-28-4993'
  where name = '和光こども園' and coalesce(address, '') = '' and coalesce(phone, '') = '';

alter table public.nurseries drop column if exists distance;
