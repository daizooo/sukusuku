# リマインダー通知の仕組みと設定手順

予定・タスクを、設定した日時に端末へ通知として届けるための仕組み（通知の設定は持たず、必ず通知する。[calendar.md §5](./calendar.md)）。

**受け取り手はネイティブ版（Android）だけ。** FCMで受け取る。セットアップは §11。

> ## 【現況】2026-09-18にWeb Pushの経路を撤去した
>
> もともとは受け取り手が2つあり、PWA版（ブラウザ）はWeb Push、ネイティブ版はFCMで
> 受け取っていた。**家族全員がネイティブ版へ移ったので、送る側からWeb Pushを外した**
> （フェーズ4の条件D。`docs/native-app-rewrite.md` §7）。
>
> | | どうなったか |
> | --- | --- |
> | `_shared/webpush.ts` | 削除。`_shared/deliver.ts` の振り分けも無くなり、FCMへ渡すだけになった |
> | 宛先の取得 | 3つの配信Functionが `kind = 'fcm'` で絞る。`webpush` の行は残っていても使わない |
> | `send-nursing-alarms` | 送るのをやめ、置き去りの片付けだけになった（§6） |
> | `VAPID_KEYS` / `VAPID_SUBJECT` | **消していない。** もう読まれないが、戻すときのために置いてある |
> | PWA版（`src/`） | まだ触っていない。畳むのは次の段（§11「これから」） |
>
> **§1〜§5 と §6 の「なぜサーバーから送るのか」は、当時の記録として残している。**
> 書いてある手順（VAPIDの鍵の生成、Vercelへの公開鍵の設定など）はもう要らない。
> PWAを畳むときにまとめて整理する。

---

## 1. 全体の流れ

```
[ブラウザ / ネイティブ版]      [Supabase]                        [プッシュサービス]
                                                                (FCM / Mozilla / Apple)
設定タブで通知をオン
  ├ (ブラウザ)   Service Worker (sw.js) を登録 → PushManager.subscribe()
  └ (ネイティブ) 通知を許可 → FCMの登録トークンを取る
        └ 宛先 ─────────→ push_subscriptions
                            (kind = 'webpush' / 'fcm')

                              pg_cron (1分おき)
                                └ Edge Function: send-reminders
                                     ├ task_reminder_schedule から
                                     │  通知時刻を過ぎた予定を取る
                                     ├ reminder_deliveries に記録を作る
                                     │  (二重送信の防止)
                                     └ 宛先の種類で振り分けて送信 ──→ プッシュサービス
                                        (_shared/deliver.ts)              │
                                                                          │
  ├ (ブラウザ)   sw.js の push イベント ←──────────────────────────────────┘
  │                └ 通知を表示
  └ (ネイティブ) FCMの通知をOSがそのまま表示
```

- **通知先** — 共有の予定は、ラベル（パパ / ママ / 家族）に関わらず
  その家族が登録した全端末へ送る。**「自分だけ」の予定・タスクは、作成した本人の端末だけへ送る**
  （`_shared/reminderRecipients.ts`。この関数はRLSが効かないので自前で絞っている。
  [calendar.md](./calendar.md) の「共有設定」）。**PWA版とネイティブ版が混ざっていてもよい**
  （宛先は同じ `push_subscriptions` で、`kind` だけが違う）。
- **通知のタイミング** — `task_reminder_schedule` ビューが計算する。
  日付・時刻は `date` + `time` で保存されている（[calendar.md](./calendar.md) 参照）ため、
  ここで `Asia/Tokyo` として解釈して通知時刻を求めている。
  時刻の無い（終日の）予定・タスクは 09:00 を予定時刻とみなす。通知時刻は予定の日時そのもの
  （以前あった「何分前」の設定は廃止。0049）。
- **繰り返す予定** — 日付指定で繰り返す予定・タスクはビューが返さず、`send-reminders` が
  ルールを回ごとの日付へ展開して通知時刻を求める（`_shared/recurringReminders.ts`。展開の中身は
  アプリ側と同じ `recurrenceExpand.ts` のコピー）。完了にした回（`done_dates`）は通知しない。
  [calendar.md の「繰り返しの展開」](./calendar.md)
- **出生日基準の予定** — 誕生日は `family_profiles.child_fields` (jsonb) にあるため、
  `family_birth_date()` 関数で取り出して `days_after_birth` を足している。
  誕生日が未登録の予定は日付が決まらないので通知されない。

### 二重送信を防ぐ仕組み

`send-reminders` は通知時刻を **2時間さかのぼって** 対象にする。
実行が数回飛んでも通知を取りこぼさないようにするためで、代わりに
`reminder_deliveries` の `(task_id, subscription_id, scheduled_for)` の一意制約で
同じ通知が2度飛ばないようにしている。送信前に `pending` の行を作って送信権を取るので、
実行が重なっても送るのは片方だけになる。

予定の日時を変えると `scheduled_for` が変わるため、
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

そのうえで `supabase/migrations/0013_reminder_cron.sql` を適用すると、配信が始まる
（叩く間隔は `0038` で1分おきにしている）。

---

## 3. 端末側の設定

通知は **端末ごと** に購読する。スマホとパソコンの両方で受け取りたい場合は、
それぞれの端末の設定タブでトグルをオンにする。

- **iPhone / iPad** — ホーム画面に追加したアプリから開いたときだけ通知を使える（iOS 16.4以降）。
  Safari のタブで開いている状態では購読できないため、設定タブにその旨が表示される。
- **Android / パソコン** — ブラウザからそのまま購読できる。
- **ネイティブ版（Android）** — 設定タブの同じトグルでオンにする。受け取り方だけが
  FCMの登録トークンに変わる（§11）。Expo Goでは受け取れないため、その旨が表示される。

一度ブラウザで通知をブロックすると、アプリ側からは再要求できない。
その場合はブラウザのサイト設定から許可し直す必要がある。
ネイティブ版も同じで、断ったあとは端末の「設定 > アプリ > すくすく > 通知」から許可し直す。

---

## 4. 動かないときの確認

### 通知が届かない

```sql
-- 1. 端末の購読が登録されているか
select id, user_agent, created_at, last_success_at, failure_count
  from push_subscriptions;

-- 2. 通知時刻がどう計算されているか
select title, target_date, start_time,
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
| `supabase/migrations/0012_push_notifications.sql` | テーブル・ビュー |
| `supabase/migrations/0013_reminder_cron.sql` | 定期実行の登録 |
| `scripts/generate-vapid-keys.mjs` | 鍵の生成 |
| `supabase/functions/_shared/deliver.ts` | 通知の中身をFCMへ渡す形に詰め替える層 |
| `supabase/functions/_shared/fcm.ts` | FCM HTTP v1 の送信（アクセストークンの取得を含む） |
| `supabase/functions/send-nursing-alarms/index.ts` | 「いま授乳中」の印の片付け（§6） |
| `src/lib/nursingAlarmSync.ts` | 授乳のお知らせをサーバーへ預ける橋渡し |
| `src/lib/api/nursingAlarms.ts` | `nursing_alarms` の読み書き |
| `supabase/migrations/0021_nursing_alarms.sql` | テーブル |
| `supabase/migrations/0027_nursing_alarms_stopped_at.sql` | 記録待ちの印(`stopped_at`) |
| `supabase/migrations/0033_nursing_alarms_burp.sql` | ゲップの区切り(`side = 'burp'`)を許可 |
| `supabase/migrations/0043_nursing_alarms_family_select.sql` | 授乳中の印を家族が参照できるようにする（§7） |
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
| `src/lib/appLinks.ts` | 開く画面をURLで表す決まりごと（§9） |
| `src/lib/notificationCleanup.ts` | 用が済んだ通知を消す判断と実行（§10） |
| `supabase/functions/_shared/deliver.ts` | 宛先の種類で送り方を振り分ける（§11） |
| `supabase/functions/_shared/fcm.ts` | FCM HTTP v1 での送信（§11） |
| `supabase/migrations/0037_push_subscriptions_fcm.sql` | 宛先の種類(`kind`)を足す（§11） |
| `mobile/src/lib/push.ts` | ネイティブ版の許可・登録トークン・通知チャンネル（§11） |
| `mobile/src/lib/api/pushSubscriptions.ts` | ネイティブ版の宛先の保存・削除 |
| `mobile/src/components/info/NotificationSetting.tsx` | ネイティブ版の設定タブの通知トグル |
| `mobile/src/lib/appLinks.ts` | ネイティブ版の飛び先の決まりごと（§9） |
| `mobile/src/lib/nursingState.ts` | ネイティブ版の「いま授乳中」をサーバーへ預ける（§11） |
| `mobile/src/lib/api/nursingAlarms.ts` | 同上。`nursing_alarms` の読み書き |

---

## 6. 授乳の経過時間お知らせ

> **いまはサーバーから送っていない。** ネイティブ版では授乳中だけ前面サービスが動いて
> 端末が自分で鳴らすため、肩代わりが要らない（`docs/native-app-rewrite.md` §4）。
> 2026-09-18に `send-nursing-alarms` の送る部分を撤去し、**置き去りになった
> `nursing_alarms` の行を片付けるだけ**にした。以下の「なぜサーバーから送るのか」は
> 当時の記録。数え方（区切り・セット）と表の使い方はいまも同じ。

予定のリマインダーとは別に、**授乳中の経過時間のお知らせ**を出す。

授乳は **左5分 → 右5分 → ゲップ5分で1セット**として測る。区切りが5分に達すると
お知らせが**1回だけ**鳴るので、画面を見ていなくても次の区切りへ移るタイミングが分かる
（鳴り続けると休めないため、同じ区切りでは二度と鳴らさない）。ゲップの5分まで終わると
1セット完了として計測も止まる。いま測っている区切りは `nursing_alarms.side`
（`left` / `right` / `burp`）に入り、鳴らし終えると `notified_step` が1になる。
ゲップは飲ませた時間ではないため、計測とお知らせにだけ使い、記録には残さない。

続けて2セット目を測るときは、区切りをもう一度タップすると0から測り直しになり、
`baseline_at` が新しくなるので**お知らせもまた鳴る**（`notified_step` は0に戻る）。
記録に入るのは全セットの合計で、急いで飲ませ始めて途中から記録した場合は、
測れなかったセットの数を入力画面で足せる（1セット＝左右5分の目安）。

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
- ホームの「次の授乳の目安」は、**止めた時刻を前回の授乳として**目安を出す（§7）

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

起点になるのは記録の日時なので、そこには**飲ませ始めた時刻**が入っていてほしい。
母乳をストップウォッチで測っているときは、入力画面が**計測を始めた時刻**を日時の初期値に
入れる（`mobile/src/components/log/MilkLogModal.tsx`、Web版は `src/components/sukusuku/modals/MilkLogModal.tsx`）。保存した時刻のままだと、記録が
遅れたぶんだけ目安も後ろへずれるため。過去の日を開いているときと、止め忘れて6時間を
超えた計測には使わない（いま測っている授乳ではないため）。

```
[ブラウザ] 授乳を記録
  └ care_logs に1行増える（次の目安の起点が入れ替わる）

                              pg_cron (1分おき)
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
- **届くまでの時間** — 定期実行が1分おきなので、目安の時刻と同じ分のうちに届く。
  **予定より早くは送らない**（先取りしない。§12）。
- **打ち切り** — 目安の時刻を2時間（`LOOKBACK_MINUTES`）過ぎたものは送らない。
  何時間も後に「そろそろ授乳」が来ても困るため。
- **授乳中は送らない** — 記録は授乳が終わってから保存されるので、飲ませている最中は
  「前回の授乳」が1つ前のままになり、目安を過ぎた状態になる。母乳のストップウォッチを
  計測中の端末は `nursing_alarms` に行を持つので、それがある家族は対象から外す。
  計測を止めてから記録を保存するまでの「記録待ち」（§6）も同じ扱いで外れる。
- **記録が入るまでは分からない** — 判定の材料は保存済みの記録だけなので、ミルクや搾乳の
  ように計測を伴わない授乳を、飲ませてから何十分も後に記録した場合は、その間に
  「そろそろ次の授乳」が飛ぶことがある。授乳のたびにその場で記録するのがいちばん確実。

### 端末ごとに「おやすみ時間は止める」（2026-10-04に追加）

夜に授乳しない側の端末が「そろそろ次の授乳」で起こされないよう、**端末（購読）ごと**に
おやすみ時間を持たせ、その時間帯に目安が来るものは**その端末には送らない**。

- 列は `push_subscriptions.feeding_quiet_start` / `feeding_quiet_end`（日本時間0:00からの分。
  22:00〜6:00 なら 1320 / 360）。2つとも null なら今までどおり届く
  （`supabase/migrations/0052_feeding_push_quiet_hours.sql`）。
- 判断は目安の時刻（`due_at`）で行う。`send-feeding-reminders` が端末ごとに見て、
  おやすみ時間の中なら送らない（`_shared/quietHours.ts`。アプリ側の
  `mobile/src/lib/wakeAlarmPlan.ts` と同じ規則。テスト: `npm run test:quiet-hours`）。
- 止めるのは「次の授乳」だけ。予定のリマインダー・検温は止めない。
- 送らなかった端末のぶんは**配信の記録を残さない**。目安の時刻は変わらないので、
  次の実行でも同じ判断になるだけで二重送信の心配がない。
- 設定は設定タブの「おやすみ時間は授乳の通知を止める」（端末ごと、既定オフ）。アプリを開く
  たびに宛先の行へ写し直す（通知を入れ直して行が作り直されても空に戻らないように）。
- 夜の起床アラーム（`docs/night-wake-alarm.md`）とは別の設定。起床アラームをオンにした端末では、
  この設定をオフのままにして、目安の時刻の通知を2段目に残す。
- **デプロイの順序: 先に 0052 を適用し、そのあと `send-feeding-reminders` をデプロイする。**
  関数を先に出すと、列がまだ無い間は購読の取得に失敗して授乳の通知が止まる。
- Web Push は撤去済み（`send-feeding-reminders` は `kind = 'fcm'` だけに送る）ので、
  Web版（iPad）にはこの設定を置かない。

### 画面の「次の授乳の目安」（ホーム。ネイティブ版とWeb版で同じ）

通知と同じ隙間が**画面にもあった**。ホームのカードは保存済みの記録
（`care_logs.type = 'milk'`）だけを見ていたため、母乳を測り終えて記録がまだのとき、
前の授乳の目安のまま赤く「◯分すぎ」と出ていた。測った端末だけでなく、
**パートナーの端末でも**（授乳中であることが伝わっていなかった）。

そこでホームのカードは、記録に加えて `nursing_alarms` の印も前回の授乳として扱う。

| 家族の端末の状態 | ホームの出し方 |
| --- | --- |
| 計測中（`stopped_at` なし） | 「いま授乳中です」。目安の時刻は出さない（終わる時刻が分からないため） |
| 記録待ち（`stopped_at` あり） | 止めた時刻 + 間隔を目安にし、「授乳の記録がまだです」と添える |
| 印なし | 今までどおり、いちばん新しい授乳の記録が起点 |

- **家族で共有する** — `nursing_alarms` は本人の行しか読めなかった（0021）ので、
  参照だけ家族に広げた（`supabase/migrations/0043_nursing_alarms_family_select.sql`）。
  書き込みは今までどおり本人の行だけ。返すのは家族のIDまでで、通知の宛先は見えない。
- **二重に数えない** — 保存が済むと印は消えるが、消えたことが相手の端末へ届くまでには
  間がある。その授乳が始まったあとに授乳の記録が入っていれば、それが保存されたぶんと
  見て印は使わない（同じ授乳で目安が後ろへずれないようにする）。
- **置き去りの印は信じない** — サーバーの片付け（§6）と同じ上限（計測中90分・記録待ち60分）
  を読んだ側でも見て、過ぎたものは無いものとして扱う。
- **開いたままでも追いつく** — ホームを見ている間は1分ごとに印だけ読み直す。
  授乳の始まり・終わりはパートナーの端末で起きるため、タブを切り替えるまで
  気づけないと意味がない。
- **通知がオフの端末は今までどおり** — 印は端末の購読(`push_subscriptions`)にぶら下がる
  ので、通知をオフにしている端末では預けられず、記録が入るまで分からない。

同じ印は**記録タブの「次はどちらから」**にも効かせる。記録だけを見ていると、パートナーが
授乳を終えて保存するまでの間は1つ前の側が出てしまい、同じ側から続けて飲ませることになる。

- 相手が計測中 → 「◯◯が授乳中」（次の側は飲ませ終えてから決まるため出さない）
- 相手が記録待ち → 印の `side`（最後に飲ませた側）の逆をおすすめにする
- 自分の端末で測っているとき → 今までどおり出さない（計測中のバナーが出る）

計算は `mobile/src/lib/feedingSchedule.ts` と `src/lib/feedingSchedule.ts`（同じ内容。テスト: `npm run test:feeding` / `npm run test:feeding-web`）。

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
`0025` は配信の定期実行に加えて、送信記録の掃除（週1回・90日より古い分を削除）も
登録する。予定のリマインダーの掃除（§2の `0013`）と同じ考え方。

> **本番プロジェクトには適用済み**（Edge Functionのデプロイ、マイグレーション2本、
> 配信のcronと掃除のcronの登録まで完了）。上の手順は作り直すときのためのもの。

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

                              pg_cron (1分おき)
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
- **届くまでの時間** — 定期実行が1分おきなので、設定した時刻と同じ分のうちに届く。
  **設定した時刻より早くは送らない**（先取りしない。§12）。
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
`0031` は配信の定期実行に加えて、送信記録の掃除（週1回・90日より古い分を削除）も
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

---

## 9. 通知をタップしたときの飛び先

通知をタップしたら、その用件の画面をそのまま開く。開いてから自分でタブと
入力画面を選び直さずに済ませるため。

| お知らせ | 飛び先 |
| --- | --- |
| 授乳の経過時間（§6） | 記録タブ・授乳の入力画面 |
| 次の授乳の目安（§7） | 記録タブ・授乳の入力画面 |
| 検温（§8） | 記録タブ・体温の入力画面 |
| 予定のリマインダー（§2） | ホーム |

飛び先はURLで表す。`/?tab=log&open=temperature` のように、`tab` が開くタブ、
`open` が記録タブで開く入力画面を指す（値の一覧は `src/lib/appLinks.ts`）。
どのURLへ飛ばすかは `public/sw.js` がお知らせの種類（`kind`）から決めるので、
Edge Function 側は今までどおりの本文のままでよい。

**ネイティブ版も同じ飛び先にする。** URLではなくExpo Routerのパスとパラメータで表すが、
種類と飛び先の対応は同じで、`mobile/src/lib/appLinks.ts` に置いている
（FCMの `data.kind` から決める。`open` は入力画面を開いた時点で消す）。

URLで表しているのは、**画面を更新してもタブが戻らないようにする**ためでもある。
タブの切り替えは `history.replaceState` でURLへ書き戻しているので、
読み込み直しても見ていたタブのまま戻ってくる（ホームは既定なのでURLに載せない）。
`open` は入力画面を開いた時点で消すため、そのあと更新しても開き直さない。

既に同じ画面を開いている端末では、タップしても読み込み直さずに前面に出すだけ。
計測中の授乳の入力途中を、通知のタップで消してしまわないようにするため。

---

## 10. 用が済んだ通知を消す

通知は**タップするか手で払うまで残り続ける**。そのため、

- 妻が授乳を記録したのに、夫の端末には「そろそろ次の授乳」が出たまま
- アプリをホーム画面から開いても、通知だけがいつまでも残る

ということが起きていた。そこで、**用が済んだ通知はアプリ側から閉じる**。

### いつ消すか

`src/components/sukusuku/SukusukuApp.tsx` から `closeSettledNotifications()` を呼ぶ。
記録・設定・予定が変わったときと、アプリを前面に戻したとき（`visibilitychange`）に
動く。前面に戻したときは、パートナーの端末で入った分を拾うため、直近の授乳・体温・
予定を取り直してから判断する。

### 済んだかどうかの決め方

届いた通知の中身ではなく、**いまのデータ**で判断する。相手の端末で記録された分も
こちらのデータには入っているので、どちらが記録しても両方の端末から消える。

| 通知（タグ） | 消す条件 |
| --- | --- |
| 授乳の経過時間（`nursing-alarm`） | 端末に記録前の授乳が残っていない（記録またはリセット済み） |
| 次の授乳の目安（`feeding-reminder`） | 次の目安がまだ先（＝そのあと授乳が記録された） |
| 検温（`temperature-reminder`） | 直近の検温の時刻より後に体温を記録している |
| 予定のリマインダー（`task-<id>`） | その予定が済みになっている |

判断できないタグには触らない。まだ記録が無い（＝用が済んでいない）通知も残す。

タグは `public/sw.js` が付けたものを目印にしているので、**どちらかを変えるときは
両方揃える**こと（sw.js はビルドを通さない静的ファイルで import できないため、
同じ値を `src/lib/notificationCleanup.ts` にも置いている）。

### 確かめ方

```bash
npm run test:notification
```

端末によっては `ServiceWorkerRegistration.getNotifications()` が使えない。
その場合は何もしない（これまでどおり手で払う形に戻るだけ）。

### ネイティブ版

**同じ規則で同じように消す**（`mobile/src/lib/notificationCleanup.ts`）。上の表の条件は
そのまま移してある。違うのは2か所だけ。

| | PWA版 | ネイティブ版 |
| --- | --- | --- |
| 出ている通知の数え方 | `registration.getNotifications()` | `Notifications.getPresentedNotificationsAsync()` |
| 判断の材料 | 画面が既に持っている値を渡す | 必要な分だけ取り直す（タブごとに別々に持っているため） |

**タグの取り方に気をつける。** 出どころで入り方が変わる。

- **閉じている間に届いた分**はFCMがそのまま出すので、expo-notifications から見ると
  「よそのお知らせ」になり、identifier が
  `expo-notifications://foreign_notifications?tag=<タグ>&id=<番号>` の形になる。
  送るときに付けたタグはここに入っている
- **開いている間に届いた分**は expo-notifications 自身が出すので identifier はFCMの
  メッセージidで、タグは入らない。こちらは `data`（`kind` / `taskId`）から
  組み立て直す（送る側 `_shared/deliver.ts` の `tagOf` と同じ規則）

授乳の常駐通知（前面サービス）はタグを持たないので、ここでは触らない。

問い合わせは**出ている通知が1つも無ければしない**。前面に戻るたびに毎回
取り直すことにはならない。

**見直す間合い（ネイティブ版）。** 開いたとき・前面に戻ったときに加えて、
**アプリを開いている最中の記録と、母乳の計測開始の直後**にも見直す
（`notificationCleanupTrigger.ts` の合図。記録は `offline/careLogs.ts`、計測は
`nursingTimer.ts` から出す）。前面に戻ったときだけだと、アプリ内で記録しても
「そろそろ次の授乳」「検温」が残り続けていた。

判断の材料は、サーバーの直近の記録に加えて**この端末の控え（送信待ちを含む）**と
**計測中・記録待ちの授乳**（この端末の計測と、パートナーが預けた印）を使う。
圏外で記録してもすぐ消え、母乳は計測を始めた時点で「そろそろ次の授乳」が消える
（PWA版の `isNursing` の扱いと同じ）。

---

## 11. ネイティブ版（Android）へ届ける

ネイティブ版（`mobile/`）はService Workerを持たないので、Web Pushでは届かない。
代わりに **FCM（Firebase Cloud Messaging）の登録トークン**で受け取る。

### 送る側の形

通知の時刻を決めるビューも、二重送信を防ぐ記録も、通知の文面もEdge Functionが持つ。
`_shared/deliver.ts` はその中身をFCMへ渡す形に詰め替えるだけ。

```
Edge Function ─→ _shared/deliver.ts ─→ FCM HTTP v1（_shared/fcm.ts）
```

宛先は `push_subscriptions` の **`kind = 'fcm'` の行**。3つの配信Functionが
`.eq('kind', 'fcm')` で絞って引く。

| | `kind = 'fcm'` |
| --- | --- |
| `endpoint` | `fcm:` + 登録トークン |
| `p256dh` / `auth` | 空文字（Web Pushの暗号化に使っていた列。いまは使わない） |
| 表示用 | `Android <APIレベル>` |

`endpoint` に接頭辞を付けているのは、一意キー（`endpoint`）をそのまま「端末ごとに1行」の
決まりとして使い続けるため。Web Pushを撤去したいまは見分ける相手がいないが、
列の形は変えていない。

### これから（PWAを畳むまで）

**PWA版（`src/`）にはまだ手を付けていない。** そのため、PWA版を開いて通知をオンにすると
`kind = 'webpush'` の行がまた作られる。送る側が `fcm` で絞っているので**誤って送ろうとして
失敗することはない**が、その人には何も届かない。

残っているのは次の3つ。`docs/native-app-rewrite.md` §7 のフェーズ4の続きで片付ける。

| | やること |
| --- | --- |
| PWA版 | 通知の設定・`public/sw.js`・`src/lib/push.ts` を外す |
| `VAPID_KEYS` / `VAPID_SUBJECT` | もう読まれないので消してよい（戻すときのために置いてある） |
| `kind = 'webpush'` の行 | 消す。`kind` 列そのものを畳むかは、PWAを消すときに決める |

### 授乳のお知らせはサーバーを通らない

授乳の経過時間お知らせ（§6）だけは、ネイティブ版では**前面サービス（Kotlin）が鳴らす**。
画面が消えていてもアプリを閉じていても圏外でも鳴り、マナーモードでも鳴るので、
サーバーからの肩代わりが要らない（`docs/native-app-rewrite.md` §4）。
`send-nursing-alarms` は `kind = 'fcm'` の宛先へは送らない。

ただし `nursing_alarms` の行は**ネイティブ版でも預ける**。この表にはもう1つ
「いま授乳中（または飲ませ終えて記録待ち）だから『そろそろ次の授乳』を送らない」
という役目があり（§7・`0027`）、預けないとネイティブ版で授乳したときに
**飲ませ終えたばかりなのに家族全員へ「そろそろ次の授乳」が飛ぶ**。
鳴らさせないよう `notified_step` は1で入れる（`mobile/src/lib/nursingState.ts`）。

### セットアップ

**一度やれば以降は不要**。§2（VAPID鍵）とは別に、次の3つが要る。

#### 手順1: Firebase プロジェクトを作る

[Firebase コンソール](https://console.firebase.google.com/)でプロジェクトを作り、
**Android アプリを追加**する。パッケージ名は `mobile/app.config.js` の
`android.package` と揃える（`com.sukusuku.app`）。

> Supabase とは別のサービスだが、**FCMの経路だけを借りる**形なので、
> Firestore や Authentication は使わない（データは今までどおりSupabaseにある）。

#### 手順2: `google-services.json` を置く

アプリを追加したときに落とせる `google-services.json` を `mobile/` に置く。
これが無いとビルドが通らない（`app.config.js` の `android.googleServicesFile` が指している）。

**リポジトリにはコミットしない**（`mobile/.gitignore`）。CIは Actions の Secrets から
書き出すので、`GOOGLE_SERVICES_JSON` に**ファイルの中身をそのまま**登録する
（リポジトリの Settings > Secrets and variables > Actions）。
未登録のときは仮のもので進んで、`.apk` を配る手前で止まる。

#### 手順3: サービスアカウントの鍵を Edge Function に設定する

Firebase コンソールの **プロジェクトの設定 > サービス アカウント** から
「新しい秘密鍵の生成」でJSONを落とし、その**中身をそのまま**1行のシークレットにする。

```bash
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat /path/to/service-account.json)"
```

そのあと Edge Function をデプロイし直す（§2 手順4と同じ）。

- 鍵は `project_id` / `client_email` / `private_key` だけを使う
- これで送れるのはFCMのメッセージだけ（`firebase.messaging` のスコープのみ要求している）
- **`VAPID_KEYS` を消してはいけない。** PWA版の端末が残っている間は両方使う

#### 手順4: 端末でオンにする

`.apk` を入れて設定タブの「通知」をオンにする（`mobile/README.md`）。
最初の1回だけ通知の許可を聞かれる。

### 動かないときの確認

| 症状 | 見るところ |
| --- | --- |
| 設定タブに「Expo Goでは通知を受け取れません」と出る | Expo Goには通知の設定が入らない。`.apk` を入れたアプリで設定する |
| トグルをオンにできない | 端末の「設定 > アプリ > すくすく > 通知」で許可されているか |
| オンにはなるが届かない | Edge Function のログで `FCM_SERVICE_ACCOUNT が未設定です` が出ていないか。出ていれば手順3 |
| `403 PERMISSION_DENIED` | 鍵のプロジェクトと `google-services.json` のプロジェクトが違う。両方を同じプロジェクトから取り直す |
| 入れ直したら届かなくなった | 登録トークンが変わる。設定タブでオフ→オンし直す（古い行は送信に失敗した時点で片付けられる） |
| 通知が静かに積まれるだけ | 通知チャンネルの設定。端末の「設定 > アプリ > すくすく > 通知」で各チャンネルを確認する |
| タップしても消えるだけでアプリが開かない | `_shared/fcm.ts` で `click_action` を送っていないか。下の「タップで開く」を参照 |

送る側だけを確かめたいときは、`_shared/fcm.ts` の検証を走らせる。

```bash
npm run test:fcm
```

### タップで開く

**`click_action` は指定しない。** 指定すると、その名前のアクションに合う intent-filter を持つ
Activityが探されるが、`MainActivity` の `MAIN` のフィルタは `LAUNCHER` しか持たず
`android.intent.category.DEFAULT` が無いため、どれにも当たらない。結果、**タップしても通知が
消えるだけでアプリが開かない**（2026-09-18に実機で起きた。`android.intent.action.MAIN` を
指定していた）。

```xml
<!-- expo prebuild が作る android/app/src/main/AndroidManifest.xml -->
<intent-filter>
  <action android:name="android.intent.action.MAIN"/>
  <category android:name="android.intent.category.LAUNCHER"/>   <!-- DEFAULT が無い -->
</intent-filter>
```

指定しなければFCMの既定どおりランチャーのActivityが開き、通知の `data` がIntentのextrasで
渡る。expo-notifications の `ExpoNotificationLifecycleListener` がそれを拾って「通知のタップ」
として扱うので、飛び先の処理（`mobile/app/_layout.tsx` の §9）が動く。アプリを消していた
とき（`onCreate`）も、裏で動いていたとき（`onNewIntent`）も同じ。

「タップで既にあるアプリを前面に出す（新しく積み上げない）」ことは、`MainActivity` の
`launchMode="singleTask"` が担っているので指定は要らない。

> 授乳の常駐通知（前面サービス）はこの経路を通らない。`NursingAlarmService` が
> `getLaunchIntentForPackage()` で自前のPendingIntentを組むので、ここの影響を受けない。

### 通知チャンネル

Androidは鳴り方・振動を**チャンネルに固定する**（作ったあとは名前と説明しか変えられない）。
そのため、お知らせの種類ごとに分けてある。idは送る側（`_shared/deliver.ts`）と
アプリ側（`mobile/src/lib/push.ts`）で揃えること。

| チャンネル | 何のお知らせか |
| --- | --- |
| `task-reminder` | 予定のリマインダー（§2） |
| `feeding-reminder` | 次の授乳の目安（§7） |
| `temperature-reminder` | 検温（§8） |

---

## 12. 届く時刻の決まりごと

予定（§2）・次の授乳の目安（§7）・検温（§8）の3つは、**書いてある時刻より早くは送らない。**
「10分前にお知らせ」が11分前に来ると、通知に出ている時刻と合わなくなるため。
少し遅れて届くほうが、早く届くよりましだと考える。

そのための組み合わせが次の2つ。

| | 決めごと | どこ |
| --- | --- | --- |
| 叩く間隔 | 1分おき | `cron.job`（`0038` で `* * * * *` に変更） |
| 先取り | しない（上限は「いま」） | 3つのEdge Functionの `to` |

結果、通知は**その分のうちに**届く（時刻ちょうど〜1分以内）。

### なぜ一度こうなっていなかったか

はじめは5分おき（`0013` / `0025` / `0031`）だった。そのままでは時刻を最大5分過ぎてから
届くので、Edge Function 側で `LOOKAHEAD_MINUTES = 1` として「次の実行までに来るぶん」を
1分だけ先取りしていた。

このため通知の時刻が5の倍数の分でないと、必ずずれる。

- `20:25` の予定 … `20:25` の実行がそのまま拾う → ぴったり
- `20:26` の予定 … `20:25` の実行が先取りする → **1分早い**

最初のうち通知時刻が5の倍数の分ばかりだったため、気づくのが遅れた
（実際に `20:26` の予定が `20:25:01` に届いて分かった）。

叩く間隔を1分にすれば先取りが要らなくなるので、`0038` でそちらへ寄せた。
中身は「送るものが無ければすぐ返す」形で、対象を引くビューの走査も家族数ぶんしかないため、
回数が増えても負荷はほとんど変わらない（授乳の経過時間の片付け §6 は元から1分おき）。

### 遅れるほうの扱い

取りこぼしは `LOOKBACK_MINUTES = 120` で拾い直す。cronが数回飛んでも通知は失われないが、
2時間を過ぎたものは送らない（朝の検温のお知らせが昼に届いても意味がないため）。
二重に飛ばないのは、送信済み記録（`reminder_deliveries` ほか）が
(予定, 宛先, 通知時刻) で一意になっているから。
