@AGENTS.md

# 【第一優先】mobile版が本体。PWA版（`src/`）はそのWEB版（兼開発確認用）

ルートの `CLAUDE.md` の冒頭にある大前提がこの `mobile/` に対する最優先のルール。
**`mobile/` が仕様の正。** `src/`（PWA版）は凍結を解いており、`mobile/` の変更を
追いかけて反映する（ネイティブ専用の機能を除く。詳細はルートの `CLAUDE.md`）。
仕様は `mobile/` 配下と `docs/` の仕様書（例: docs/calendar.md）を基準にする。
