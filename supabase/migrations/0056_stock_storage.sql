-- かぞく手帳: 防災備蓄の保管場所（暮らしタブ。docs/home.md §3.6）
--
-- 備蓄を「寝室（家に置く分）」と「持ち出し用バックパック（1日分）」に分けて置く。
-- ロットごとにどちらにあるかを持ち、必要数を2段で確かめる。
--   - 全体: 1人1日あたり × 人数 × 日数（7日）。寝室と持ち出しの両方を数える
--   - 持ち出し: 1人1日あたり × 人数 × 持ち出しの日数（1日）。持ち出しにあるロットだけ数える
-- 持ち出しに入れる品目かどうかは目標ごとに決める（ご飯は炊くので入れない、など）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは足した列を読まないだけ。既存のロットはすべて寝室（home）になる

-- ロットの保管場所。home＝寝室（家に置く分）、carry＝持ち出し用バックパック。
alter table public.stock_items
  add column if not exists storage text not null default 'home' check (storage in ('home', 'carry'));

comment on column public.stock_items.storage is
  '保管場所。home＝寝室（家に置く分）、carry＝持ち出し用バックパック（docs/home.md §3.6）。';

-- 持ち出しに入れる品目か。true なら「持ち出しの日数」分を持ち出しに置けているかも確かめる。
alter table public.stock_targets
  add column if not exists carry boolean not null default false;

comment on column public.stock_targets.carry is
  '持ち出し用バックパックにも入れる品目か。true なら持ち出しの日数分（決まった数なら全部）を持ち出しで確かめる。';

-- 持ち出しを何日分にするか。
alter table public.families
  add column if not exists stock_carry_days smallint not null default 1 check (stock_carry_days between 1 and 7);

comment on column public.families.stock_carry_days is '防災備蓄のうち、持ち出し用バックパックに何日分を入れるか。';
