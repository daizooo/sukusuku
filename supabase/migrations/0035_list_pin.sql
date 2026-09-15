-- すくすく手帳: リストのピン止め（docs/lists.md §8 フェーズ2）
--
-- Google Keepと同じく、よく開くリストを一覧の先頭へ固定できるようにする。
-- 並べ替えは既存の position で足りるため、ここで足すのはピンの1列だけ。
--
-- 一覧の並びは「固定されたもの → その他」で、どちらの中も position の順。
-- 固定を外しても position は変えないので、外した位置がそのまま元の場所になる。
alter table public.lists
  add column if not exists is_pinned boolean not null default false;

comment on column public.lists.is_pinned is
  '一覧の先頭に固定するか（Google Keepのピン止めと同じ）。並び順そのものは position が持つ。';
