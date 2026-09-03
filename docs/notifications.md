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
| `supabase/functions/_shared/webpush.ts` | Web Push の暗号化・VAPID署名（2つの配信で共用） |
| `supabase/functions/send-nursing-alarms/index.ts` | 授乳のお知らせの配信（§6） |
| `src/lib/nursingAlarmSync.ts` | 授乳のお知らせをサーバーへ預ける橋渡し |
| `src/lib/api/nursingAlarms.ts` | `nursing_alarms` の読み書き |
| `supabase/migrations/0021_nursing_alarms.sql` | テーブル |
| `supabase/migrations/0027_nursing_alarms_stopped_at.sql` | 記録待ちの印(`stopped_at`) |
| `supabase/migrations/0033_nursing_alarms_burp.sql` | ゲップの区切り(`side = 'burp'`)を許可 |
| `supabase/migrations/0022_nursing_alarm_cron.sql` | 定期実行の登録 |
| `supabase/functions/send-feeding-reminders/index.ts` | 次の授乳の目安の配信（§7） |
| `src/lib/feedingSchedule.ts` | 次の授乳の目安の計算 |
| `src/lib/api/feedingSettings.ts` | `feeding_settings` の読み書き |
| `supabase/migrations/0024_feeding_schedule.sql` | テーブル・ビュー |
| `supabase/migrations/0025_feeding_reminder_cron.sql` | 定期実行の登録 |
| `supabase/functions/send-temperature-reminders/index.ts` | 検温のお知らせの配信（§8） |
| `src/lib/api/temperatureReminderSettings.ts` | `temperature_reminder_settings` の読み書き |
| `src/components/sukusuku/TemperatureReminderSetting.tsx` | 設定タブの時刻の設定 |
| `supabase/migrations/0030_temperature_reminders.sql` | テーブル・ビュー |
| `supabase/migrations/0031_temperature_reminder_cron.sql` | 定期実行の登録 |

---

## 6. 授乳の経過時間お知らせ

予定のリマインダーとは別に、**授乳中の経過時間のお知らせ**も同じWeb Pushの仕組みで送る。

授乳は **左5分 → 右5分 → ゲップ5分で1セット**として測る。区切りが5分に達すると
お知らせが**1回だけ**鳴るので、画面を見ていなくても次の区切りへ移るタイミングが分かる
（鳴り続けると休めないため、同じ区切りでは二度と鳴らさない）。ゲップの5分まで終わると
1セット完了として計測も止まる。いま測っている区切りは `nursing_alarms.side`
（`left` / `right` / `burp`）に入り、鳴らし終えると `notified_step` が1になる。
ゲップは飲ませた時間ではないため、計測とお知らせにだけ使い、記録には残さない。

### なぜサーバーから送るのか

授乳の経過時間は端末内のストップウォッチ（`src/lib/nursingTimer.ts`）が数えていて、
区切りが5分に達したときに音とバイブを鳴らしている。ただしブラウザは

- 画面が消える／裏に回るとタイマーを間引く（お知らせが遅れる・鳴らない）
- 画面が消えている間の振動要求を無視する
- iOS Safari はそもそも振動できない

ため、**いちばん鳴ってほしい「画面を見ていないとき」に鳴らせない**。
そこで鳴らす基準をサーバーにも預けておき、端末が鳴らせなかった分を通知で鳴らす。

```
[端末] 計測開始/左右の切り替え
  └ nursing_alarms に「基準時刻・間隔・何回目まで鳴らしたか」を預ける
       （通知をオンにしている端末だけ。オフなら従来どおり端末内だけで鳴る）

                              pg_cron (1分おき)
                                └ Edge Function: send-nursing-alarms
                                     ├ 区切りに達していて
                                     ├ まだ鳴らしていない (notified_step) ものを選び
                                     ├ notified_step を進めて送信権を取り
                                     └ その端末だけへ Web Push

[端末] 画面を開いている間は自分で鳴らし、notified_step を書き戻す
       → サーバーからは送られない（二重に鳴らない）
[端末] 計測を止める → stopped_at を立てる（行は残す＝「記録待ち」）
[端末] 記録を保存する / リセットする → 預けた行を消す
```

### 二重に鳴らさない仕組み

サーバーは区切りちょうどではなく、**20秒過ぎてから**送る
（`FOREGROUND_GRACE_SECONDS`）。画面を開いている端末は区切りの時点で自分で鳴らし、
すぐ `notified_step` を書き戻すので、その間に追い越される。

裏に回っている間にサーバーが鳴らした分は、Service Worker が開いているページへ
`nursing-alarm-notified` を送って端末側の数えも進める。これをしないと、
アプリに戻ってきたときに同じ分をもう一度鳴らしてしまう。

### 届くまでの時間

定期実行が1分おき、そこに上記の猶予20秒が乗るので、**区切りから20〜80秒ほど遅れて届く**
（さらにプッシュサービスの配送時間が乗る）。端末が起きているときは遅れずに鳴るので、
これは「画面を消しているとき」の話になる。

なお経過時間の基準（`baseline_at`）は端末の時計で作っている。端末の時計が
大きくずれていると、鳴るタイミングもその分ずれる。

### 鳴り方

区切りは5分なので、端末内で合成する音は「ピッ（短音＝5分）」1回になる
（`src/lib/alarm.ts` は長音＝30分・短音＝5分で経過時間を組み立てる仕組みのままで、
5分ぶんだけを鳴らしている）。通知音はOSの標準音になりこの鳴らし分けは伝わらないため、

- **通知の文面**に「授乳 5分」「ゲップ 5分」と、どの区切りが終わったかを出す
- **Androidは通知に振動パターンを指定できる**ので、同じ数え方の振動を出す
  （`public/sw.js` の `buildNursingVibration`）。iOSはこの指定を無視して既定の振動になる

### 計測を止めたあとの「記録待ち」

計測を止めると（ゲップの5分まで終わって自動で止まった場合も含む）、
記録を保存する（またはリセットする）までは行を消さず、
`stopped_at` を立てて残す。この間は

- 経過時間のお知らせは**鳴らさない**（もう飲ませていないため）
- 「次の授乳の目安」(§7)からは**授乳中として外れる**（授乳は済んでいるため）

記録は授乳が終わってから保存されるので、止めてから保存するまでには数十分の
開きが出ることがある。行を残していないと、その隙間に「そろそろ次の授乳」が
家族全員の端末へ飛んでしまう（飲ませ終わったばかりなのに鳴る）。

### 鳴り続けないための打ち切り

計測を止めずにアプリを閉じたままだと、預けた行が残って鳴り続けてしまう。
経過が **90分**（`MAX_ELAPSED_MINUTES`）を超えた行はEdge Functionが削除する。
通知をタップすればアプリが開くので、そこで計測を止められる。

記録待ちの行（`stopped_at` あり）は、止めてから **60分**（`MAX_PENDING_MINUTES`）で
同じく削除する。飲ませ終えて1時間たっても記録が入らないなら記録漏れなので、
そこからは「そろそろ次の授乳」が届くほうがよいため。

### セットアップ

予定のリマインダー（§2）を済ませていれば、鍵もシークレット（`REMINDER_CRON_SECRET`）も
同じものを使うので、追加の設定は要らない。必要なのはデプロイと適用だけ。

```bash
supabase functions deploy send-nursing-alarms
```

そのうえで `0021_nursing_alarms.sql` / `0022_nursing_alarm_cron.sql` /
`0023_nursing_alarms_user_index.sql` / `0027_nursing_alarms_stopped_at.sql` /
`0033_nursing_alarms_burp.sql` を適用する。

> **本番プロジェクトには適用済み**（Edge Functionのデプロイ、マイグレーション3本、
> 1分おきのcron登録まで完了）。上の手順は作り直すときのためのもの。
>
> `0027`（記録待ちの `stopped_at`）だけは**まだ**。列を足してから
> `supabase functions deploy send-nursing-alarms` をやり直す（列が無いままだと
> 関数が `stopped_at` を読めずに落ちるため、順番はこの通りに）。
> `send-feeding-reminders` 側は変更なし（コメントのみ）なので再デプロイは不要。
>
> `webpush.ts` を `send-reminders/` から `_shared/` へ移したが、`send-reminders` は
> 再デプロイしていない。デプロイ済みの内容にはwebpush.tsが同梱されており、
> 動きも変わらないため（増えたのは既定値ありの `urgency` 引数だけ）。
> 次に `send-reminders` をデプロイするときは新しい配置のまま通る。

### 動かないときの確認

```sql
-- いま預かっている計測（授乳中・記録待ちの端末のぶんだけ出る）
-- stopped_at が入っていれば「計測は終わったが、まだ記録していない」状態。
select subscription_id, side, baseline_at at time zone 'Asia/Tokyo' as baseline_jst,
       interval_minutes, notified_step,
       stopped_at at time zone 'Asia/Tokyo' as stopped_jst, updated_at
  from nursing_alarms;

-- 定期実行が動いているか
select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'send-nursing-alarms')
 order by start_time desc limit 10;
```

- 行が出てこない → その端末で通知をオンにしていない（購読が無いと預けられない）。
  設定タブの通知トグルを確認する。
- `notified_step` が進んでいるのに鳴らない → 通知そのものの問題。§4を確認する。

---

## 7. 次の授乳の目安

授乳中の経過時間お知らせ（§6）とは別に、**次の授乳がいつかのお知らせ**も同じWeb Pushの
仕組みで送る。§6は「いま飲ませている最中」の経過時間、こちらは「次はいつか」で、別物。

### 通知のタイミング

`next_feeding_schedule` ビューが、家族ごとに

- いちばん新しい授乳の記録（`care_logs.type = 'milk'`）の時刻
- 間隔の設定（`feeding_settings.interval_minutes`、既定180分）

から目安の時刻（`due_at`）を出す。設定の行が無い家族は既定値（3時間・通知する）として扱う。

```
[ブラウザ] 授乳を記録
  └ care_logs に1行増える（次の目安の起点が入れ替わる）

                              pg_cron (5分おき)
                                └ Edge Function: send-feeding-reminders
                                     ├ next_feeding_schedule から
                                     │  目安の時刻を過ぎた家族を取る
                                     ├ 授乳中(nursing_alarms に行がある)の家族は外す
                                     ├ feeding_reminder_deliveries に記録を作る
                                     │  (二重送信の防止)
                                     └ その家族の全端末へ Web Push
```

- **通知先** — 「次はいつだっけ」は夫婦のどちらにも起きるので、その家族が登録した
  全端末へ送る（予定のリマインダーと同じ考え方）。
- **届くまでの時間** — 定期実行が5分おきなので、目安の時刻から最大5分ほど遅れて届く。
  授乳の間隔は数時間単位なので、§6のような1分おきの細かさは要らない。
- **打ち切り** — 目安の時刻を2時間（`LOOKBACK_MINUTES`）過ぎたものは送らない。
  何時間も後に「そろそろ授乳」が来ても困るため。
- **授乳中は送らない** — 記録は授乳が終わってから保存されるので、飲ませている最中は
  「前回の授乳」が1つ前のままになり、目安を過ぎた状態になる。母乳のストップウォッチを
  計測中の端末は `nursing_alarms` に行を持つので、それがある家族は対象から外す。
  計測を止めてから記録を保存するまでの「記録待ち」（§6）も同じ扱いで外れる。
- **記録が入るまでは分からない** — 判定の材料は保存済みの記録だけなので、ミルクや搾乳の
  ように計測を伴わない授乳を、飲ませてから何十分も後に記録した場合は、その間に
  「そろそろ次の授乳」が飛ぶことがある。授乳のたびにその場で記録するのがいちばん確実。

### 二重送信を防ぐ仕組み

`feeding_reminder_deliveries` の `(care_log_id, subscription_id, scheduled_for)` の
一意制約で、同じ通知が2度飛ばないようにしている。送信前に `pending` の行を作って
送信権を取るので、実行が重なっても送るのは片方だけになる。

記録の時刻を直したり間隔の設定を変えたりすると `scheduled_for` が変わるため、
変更後は改めて通知される（予定のリマインダーと同じ挙動）。

### セットアップ

予定のリマインダー（§2）を済ませていれば、鍵もシークレット（`REMINDER_CRON_SECRET`）も
同じものを使うので、追加の設定は要らない。必要なのはデプロイと適用だけ。

```bash
supabase functions deploy send-feeding-reminders
```

そのうえで `0024_feeding_schedule.sql` / `0025_feeding_reminder_cron.sql` を適用する。
`0025` は配信の定期実行（5分おき）に加えて、送信記録の掃除（週1回・90日より古い分を削除）も
登録する。予定のリマインダーの掃除（§2の `0013`）と同じ考え方。

> **本番プロジェクトには適用済み**（Edge Functionのデプロイ、マイグレーション2本、
> 5分おきのcronと掃除のcronの登録まで完了）。上の手順は作り直すときのためのもの。

### 動かないときの確認

```sql
-- 目安の時刻がどう計算されているか
select family_id, last_fed_at at time zone 'Asia/Tokyo' as last_fed_jst,
       interval_minutes, due_at at time zone 'Asia/Tokyo' as due_jst
  from next_feeding_schedule;

-- 間隔の設定（行が無い家族は既定の3時間・通知する）
select * from feeding_settings;

-- 送信結果
select status, error, sent_at, scheduled_for
  from feeding_reminder_deliveries
 order by sent_at desc limit 20;

-- 定期実行が動いているか
select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'send-feeding-reminders')
 order by start_time desc limit 10;
```

- ビューに家族が出てこない → 授乳の記録が1件も無いか、設定で通知をオフにしている。
- 目安の時刻を過ぎているのに送信記録ができない → 授乳中・記録待ち（`nursing_alarms` に
  行がある）か、目安から2時間以上たっている。
- 送信記録はあるのに届かない → 通知そのものの問題。§4を確認する。

---

## 8. 検温のお知らせ

体温は熱が出てから測るものではなく、**平熱を知るために毎日決まった時刻に測る**もの。
平熱が分かって初めて「この子にしては高い」が言える（`careLogUtils` の平熱）。
ところが決まった時刻に測るのは忘れやすいので、**朝と夕の2回、その時刻に通知する**。

### 通知のタイミング

`temperature_reminder_schedule` ビューが、家族ごとに

- 時刻の設定（`temperature_reminder_settings` の `morning_time` / `evening_time`、
  既定は朝6時・夕18時）

から、その日（と前日）のお知らせの時刻（`scheduled_for`）を出す。
設定の行が無い家族は既定値（朝6時・夕18時・お知らせする）として扱う。

```
[ブラウザ] 設定タブで時刻を変える
  └ temperature_reminder_settings に家族ごとの時刻を保存

                              pg_cron (5分おき)
                                └ Edge Function: send-temperature-reminders
                                     ├ temperature_reminder_schedule から
                                     │  お知らせの時刻を過ぎた家族を取る
                                     ├ temperature_reminder_deliveries に記録を作る
                                     │  (二重送信の防止)
                                     └ その家族の全端末へ Web Push
```

- **時刻は日本時間**で解釈する（他のビューと同じく家族全員が日本にいる前提）。
  前日ぶんの時刻もビューに出しているのは、夜遅い時刻に設定していると日付をまたいだ
  直後の実行で当日ぶんがまだ未来になり、取りこぼしを拾えなくなるため。
- **通知先** — 測るのは手の空いているほうなので、その家族が登録した全端末へ送る
  （予定のリマインダー・授乳の目安と同じ考え方）。
- **届くまでの時間** — 定期実行が5分おきなので、設定した時刻から最大5分ほど遅れて届く。
- **打ち切り** — 設定した時刻を2時間（`LOOKBACK_MINUTES`）過ぎたものは送らない。
  朝の検温のお知らせが昼に届いても意味がないため。
- **もう測っていれば送らない** — お知らせの時刻の**1時間前以降**に体温の記録があれば、
  その回はビューの時点で外れる。少し早めに測った直後に「測りましょう」と届くのは
  ただの邪魔になるため。

### 二重送信を防ぐ仕組み

`temperature_reminder_deliveries` の `(family_id, subscription_id, scheduled_for)` の
一意制約で、同じ通知が2度飛ばないようにしている。送信前に `pending` の行を作って
送信権を取るので、実行が重なっても送るのは片方だけになる。

時刻の設定を変えると `scheduled_for` が変わるため、変更後は改めて通知される
（予定のリマインダー・授乳の目安と同じ挙動）。

### セットアップ

予定のリマインダー（§2）を済ませていれば、鍵もシークレット（`REMINDER_CRON_SECRET`）も
同じものを使うので、追加の設定は要らない。必要なのはデプロイと適用だけ。

```bash
supabase functions deploy send-temperature-reminders
```

そのうえで `0030_temperature_reminders.sql` / `0031_temperature_reminder_cron.sql` を適用する。
`0031` は配信の定期実行（5分おき）に加えて、送信記録の掃除（週1回・90日より古い分を削除）も
登録する。予定のリマインダーの掃除（§2の `0013`）と同じ考え方。

### 動かないときの確認

```sql
-- お知らせの時刻がどう計算されているか
select family_id, slot, scheduled_for at time zone 'Asia/Tokyo' as scheduled_jst
  from temperature_reminder_schedule
 order by scheduled_for;

-- 時刻の設定（行が無い家族は既定の朝6時・夕18時・お知らせする）
select * from temperature_reminder_settings;

-- 送信結果
select status, error, sent_at, scheduled_for
  from temperature_reminder_deliveries
 order by sent_at desc limit 20;

-- 定期実行が動いているか
select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'send-temperature-reminders')
 order by start_time desc limit 10;
```

- ビューに家族が出てこない → 設定でお知らせをオフにしているか、
  お知らせの時刻の1時間前以降にもう体温を記録している。
- 送信記録はあるのに届かない → 通知そのものの問題。§4を確認する。
