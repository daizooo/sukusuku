-- 搾乳した母乳の記録を追加する
--
-- 「搾乳してためた」ぶんを care_logs に type = 'pumping' として残す。
-- ためた母乳を飲ませたときは、これまでどおり type = 'milk' の記録として残し、
-- details.method に 'pumped' を入れて区別する。
-- この2つの差し引きが「搾乳ストック（いま残っている量）」になる。
--
--   pumping : { amountMl: 数値 }                       -- 搾乳してためた量
--   milk    : { method: 'pumped', amountMl: 数値, ... } -- ためた母乳を飲ませた量
--
-- あわせて記録タブから睡眠の記録を取り止めたが、すでに保存されている
-- type = 'sleep' の行はそのまま残せるよう、'sleep' も引き続き許可しておく。

alter table public.care_logs drop constraint if exists care_logs_type_check;

alter table public.care_logs
  add constraint care_logs_type_check
  check (type in ('milk', 'diaper', 'sleep', 'pumping'));

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method(breast/pumped/formula)/amountMl/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, pumping: amountMl';

-- 搾乳ストックの計算で使う「飲ませた搾乳母乳」を引くためのインデックス。
-- 全期間の差し引きなので、日付では絞らず family_id だけで引く。
create index if not exists idx_care_logs_pumped_milk
  on public.care_logs (family_id)
  where type = 'milk' and details->>'method' = 'pumped';

-- 「ためた搾乳」も同じく全期間ぶんを引くため、同じ形のインデックスを張る。
create index if not exists idx_care_logs_pumping
  on public.care_logs (family_id)
  where type = 'pumping';

-- 計測中の睡眠を探すためのインデックス(0015)は、睡眠の記録を取り止めたことで
-- 引かれる問い合わせがなくなったので落とす。既存の行自体はそのまま残す。
drop index if exists public.idx_care_logs_active_sleep;
