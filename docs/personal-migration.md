# 統合プロジェクト Persol（sukusuku スキーマ）への移行の進み具合

旧: Supabase プロジェクト「sukusuku」（`nbkpwjtkkiaklewtegzh`）の `public`
新: Supabase プロジェクト「Persol」（`jmysgeulujggdmdthqkn`）の `sukusuku` スキーマ
PR: daizooo/sukusuku#356（ブランチ `claude/eager-goodall-2bjzv3`。**切り替えの日までマージしない**）
SQL: `supabase/personal/0001`〜`0005`

## 済んだこと（2026-10-30）

- [x] Persol の Exposed schemas に `sukusuku`
- [x] 0001（表・関数・RLS・権限）。表56・関数63・ポリシー68・トリガー169・索引181で旧本番と一致
- [x] 0002（pg_cron・pg_net、`sukusuku_on_auth_user_created`、Realtime の `family_sync`）
- [x] 0003（データの写し）。全56表の件数が一致。overflow326@gmail.com は Persol の既存アカウント
      （`58445d19-…`。旧 `5a2160ea-…`）へ付け替え済み。ほかの2人は同じ ID のまま
- [x] overflow326@gmail.com の Persol アカウントは Google ログインだけだったので、email の identity と
      旧DBのパスワード（ハッシュのまま）を足した。Google とパスワードの両方で入れる
- [x] Edge Functions 9本を Persol にデプロイ（`.github/workflows/deploy-functions.yml`、
      Secrets の `SUPABASE_ACCESS_TOKEN`。期限 2027-10-29、Persol の Edge Functions 読み書きだけ）
- [x] Persol の Edge Function Secrets: REMINDER_CRON_SECRET・FCM_SERVICE_ACCOUNT・ANTHROPIC_API_KEY・ALPHA_VANTAGE_API_KEY
- [x] Persol の Auth: Email を有効化、Redirect URLs に sukusuku の本番・プレビュー・`sukusuku://**`
- [x] Vercel: Preview（ブランチ `claude/eager-goodall-2bjzv3` だけ）に Persol の URL と anon key

## 残り

1. **プレビューで確認**（ユーザー）: ログイン（パスワードは旧と同じ）、各タブのデータ、家族の同期、
   レシート読み取り・証券の価格取得（Edge Functions）
2. **切り替えの日**（この順で）
   1. 旧DBの最新を写し直す: Persol の sukusuku の全表を空にしてから 0003 をもう一度流す
      （**`truncate` を含むので SQL Editor**。全文をチャットに出す。0003 の fdw のつなぎは残してある）
   2. Vault に `sukusuku_reminder_cron_secret`（値は Edge Function の REMINDER_CRON_SECRET と同じ）を入れ、0005（cron）を流す
   3. 旧プロジェクトの cron を止める（`cron.unschedule`。SQL Editor）
   4. Vercel の Production の `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` と、GitHub Secrets の
      `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` を Persol の値へ
   5. Gmail 取り込みの Apps Script（`tools/gas/gmail-feed.gs`）のスクリプトプロパティ `FEED_URL` を
      `https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/money-feed-ingest` へ
   6. PR をマージ（main の Vercel・APK が Persol を見る）。マージ後に
      `deploy-functions.yml` の push 対象から作業ブランチを外す
   7. 0004 で fdw のつなぎを消す（SQL Editor）
3. 後片付け: `scripts/check-table-grants.mjs`・`check-family-sync.mjs` を `supabase/personal`・
   `sukusuku.` 前提に直す。CLAUDE.md の `public.` 前提の節を書き換える。旧プロジェクトはしばらく残してから止める
