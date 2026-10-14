-- かぞく手帳: 契約の小分類（category）の列を消す（docs/contracts.md §3.1）
--
-- 小分類は画面から外した（0099 と同じ PR）。アプリは category を読み書きしないので、列だけが残っていた。
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）: drop は削除にあたるので、MCP ではなく
-- SQL Editor で流した（2026-10-14 に本番へ適用済み。契約は0件で、この列を参照する関数・ビューも無いことを確認した）。
-- このファイルは記録として置く。

alter table public.contracts drop column if exists category;
