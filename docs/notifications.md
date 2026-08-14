# リマインダー通知の仕組みと設定手順

予定に設定したリマインダーを、その時刻に端末へ通知として届けるための仕組み。

---

## 1. 全体の流れ

```
[ブラウザ]                    [Supabase]                        [プッシュサービス]
                                                                (FCM / Mozilla / Apple)
設定タブで通知をオン
  └ Service Worker (sw.js) を登録
  └ PushManager.subscribe()
        └ 購読情報 ─────→ push_subscriptions

                              pg_cron (5分おき)
                                └ Edge Function: send-reminders
                                     ├ task_reminder_schedule から
                                     │  通知時刻を過ぎた予定を取る
                                     ├ reminder_deliveries に記録を作る
                                     │  (二重送信の防止)
                                     └ Web Push で送信 ───────→ プッシュサービス
                                                                      │
sw.js の push イベント ←───────────────────────────────────────────────┘
  └ 通知を表示
```

- **通知先** — 予定は家族で共有しているものなので、ラベル（パパ / ママ / 家族）に関わらず
  その家族が登録した全端末へ送る。
- **通知のタイミング** — `task_reminder_schedule` ビューが計算する。
  日付・時刻は `date` + `time` で保存されている（[calendar.md](./calendar.md) 参照）ため、
  ここで `Asia/Tokyo` として解釈して通知時刻を求めている。
  終日予定は 09:00 を予定時刻とみなすので、「前日」を選ぶと前日の 09:00 に届く。
- **出生日基準の予定** — 誕生日は `family_profiles.child_fields` (jsonb) にあるため、
  `family_birth_date()` 関数で取り出して `days_after_birth` を足している。
  誕生日が未登録の予定は日付が決まらないので通知されない。

### 二重送信を防ぐ仕組み

`send-reminders` は通知時刻を **2時間さかのぼって** 対象にする。
実行が数回飛んでも通知を取りこぼさないようにするためで、代わりに
`reminder_deliveries` の `(task_id, subscription_id, scheduled_for)` の一意制約で
同じ通知が2度飛ばないようにしている。送信前に `pending` の行を作って送信権を取るので、
実行が重なっても送るのは片方だけになる。

予定の日時やリマインダー設定を変えると `scheduled_for` が変わるため、
変更後は改めて通知される。

---

## 2. 初回セットアップ

通知を有効にするには、鍵とシークレットの設定が必要。**一度やれば以降は不要**。

### 手順1: 鍵を生成する

```bash
node scripts/generate-vapid-keys.mjs
```

3つの値が出力される。この後の手順で使うので、終わるまでターミナルを閉じないこと。

> **注意**: VAPID鍵は作り直さないこと。鍵を変えると、それまでに通知をオンにした端末への
> 送信がすべて失敗するようになり、各端末で通知をオフ→オンし直す必要がある。

### 手順2: Vercel に公開鍵を設定する

Vercel のプロジェクト設定 > Environment Variables に追加する。

| 変数名 | 値 |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 出力された `NEXT_PUBLIC_VAPID_PUBLIC_KEY` の値 |

`NEXT_PUBLIC_` が付く値はブラウザに埋め込まれる前提のものなので、公開されて問題ない。
設定後に再デプロイすると、設定タブに通知のトグルが出るようになる。

### 手順3: Edge Function にシークレットを設定する

Supabase ダッシュボード > Edge Functions > Secrets に追加する。

| 変数名 | 値 |
| --- | --- |
| `VAPID_KEYS` | 出力された `VAPID_KEYS` のJSONを1行でそのまま |
| `VAPID_SUBJECT` | `mailto:` + 連絡先メールアドレス |
| `REMINDER_CRON_SECRET` | 出力された `REMINDER_CRON_SECRET` の値 |

`VAPID_KEYS` には秘密鍵が含まれる。リポジトリにコミットしないこと。
`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で入れるので設定不要。

### 手順4: Edge Function をデプロイする

```bash
supabase functions deploy send-reminders
```

`supabase/config.toml` で `verify_jwt = false` にしている。pg_cron から呼ぶため
Supabase の JWT 検証は使わず、代わりに関数側で `x-reminder-secret` ヘッダーを検証している。

### 手順5: Vault に合言葉を入れて定期実行を始める

pg_cron から Edge Function を呼ぶときの合言葉を Vault に保存する。
**手順3の `REMINDER_CRON_SECRET` と同じ値**にすること。

```sql
select vault.create_secret('<REMINDER_CRON_SECRETと同じ値>', 'reminder_cron_secret');
```

そのうえで `supabase/migrations/0013_reminder_cron.sql` を適用すると、
5分おきの配信が始まる。

---

## 3. 端末側の設定

通知は **端末ごと** に購読する。スマホとパソコンの両方で受け取りたい場合は、
それぞれの端末の設定タブでトグルをオンにする。

- **iPhone / iPad** — ホーム画面に追加したアプリから開いたときだけ通知を使える（iOS 16.4以降）。
  Safari のタブで開いている状態では購読できないため、設定タブにその旨が表示される。
- **Android / パソコン** — ブラウザからそのまま購読できる。

一度ブラウザで通知をブロックすると、アプリ側からは再要求できない。
その場合はブラウザのサイト設定から許可し直す必要がある。

---

## 4. 動かないときの確認

### 通知が届かない

```sql
-- 1. 端末の購読が登録されているか
select id, user_agent, created_at, last_success_at, failure_count
  from push_subscriptions;

-- 2. 通知時刻がどう計算されているか
select title, target_date, start_time, remind_minutes_before,
       remind_at at time zone 'Asia/Tokyo' as remind_at_jst
  from task_reminder_schedule
 order by remind_at;

-- 3. 送信結果
select d.status, d.error, d.sent_at, t.title
  from reminder_deliveries d
  join tasks t on t.id = d.task_id
 order by d.sent_at desc limit 20;

-- 4. 定期実行が動いているか
select jobname, schedule, active from cron.job;
select status, return_message, start_time
  from cron.job_run_details
 order by start_time desc limit 10;
```

- `status = 'failed'` で `error` が `401` → `VAPID_KEYS` と
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` が同じ鍵ペアになっていない可能性が高い。
- `status = 'pending'` のまま残っている → 送信の途中で関数が落ちている。
  Edge Function のログを確認する。
- 予定がビューに出てこない → 完了済み（`is_done`）か、リマインダー未設定か、
  出生日基準なのに誕生日が未登録。

### 通知のトグルが出ない

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` が未設定か、iPhone でホーム画面から開いていない。
理由はトグルの位置に文章で表示される。

---

## 5. 関連ファイル

| ファイル | 役割 |
| --- | --- |
| `public/sw.js` | Service Worker。通知の表示とタップ時の遷移 |
| `src/lib/push.ts` | ブラウザ側の購読処理 |
| `src/lib/api/pushSubscriptions.ts` | 購読情報の保存・削除 |
| `src/components/sukusuku/NotificationSetting.tsx` | 設定タブの通知トグル |
| `supabase/functions/send-reminders/index.ts` | 配信の本体 |
| `supabase/functions/send-reminders/webpush.ts` | Web Push の暗号化・VAPID署名 |
| `supabase/migrations/0012_push_notifications.sql` | テーブル・ビュー |
| `supabase/migrations/0013_reminder_cron.sql` | 定期実行の登録 |
| `scripts/generate-vapid-keys.mjs` | 鍵の生成 |
