-- 0003 で作った、旧DBへのつなぎ（外部テーブル・サーバー・拡張）を消す。0003 の結果を確かめてから、SQL Editor で流す。
-- 旧DBの中身には触れない（外部テーブルの定義を消すだけ）。
drop schema if exists sukusuku_old cascade;
drop schema if exists sukusuku_old_auth cascade;
drop user mapping if exists for current_user server sukusuku_old;
drop server if exists sukusuku_old;
drop extension if exists postgres_fdw;
