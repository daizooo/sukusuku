-- 成長記録(身長・体重)が保存できない不具合の是正。
--
-- height / weight は numeric(5,2)（=999.99まで）で定義していたため、
-- 体重を g（例: 3200）で入力すると Postgres が numeric field overflow (22003) を返し、
-- PostgREST が 400 を返して保存に失敗していた。
-- 入力欄側でも kg/g の切り替えと範囲チェックを入れるが、
-- 桁の取り違えがそのままDBエラーにならないよう、桁数にも余裕を持たせておく。
alter table public.growth_records
  alter column height type numeric(6, 2),
  alter column weight type numeric(6, 2);
