# 設計書の残作業一覧

各設計書に散らばっている「まだ終わっていないこと」を1か所に集めたもの。
**2026-10-09時点**で、コードと本番DB（Supabase）に照らして確かめた。
各設計書の側にも同じ内容の状態を書いてある。食い違ったら、設計書の本文を正とし、ここを直す。

確かめ方: ✅=コード／本番DBで確認した、📄=設計書の記述だけで、実機などで確認していない。

---

## 1. 作ればよいもの（決定済み）

| 設計書 | 残り | 確認 | 備考 |
|---|---|---|---|
| [family-app.md](./family-app.md) §5 の7 | 設定>家族で、保護者が招待コードを出す画面（`create_member_invite` を呼ぶ。mobile・PWA） | ✅ DB・参加の流れは済（`0077`、2026-10-09）。画面が無い | いまは全員がアカウントを持っているので急がない。子や新しい親を入れるときに要る |
| [family-app.md](./family-app.md) §5 の6 | `family_profiles`・`users.role` の参照を外し、不要な表を drop | ✅ 本番DBに残り、`api/profile.ts` が読み書きしている | 参照を外して1リリース置いてから。drop は SQL Editor 用の SQL として渡す |
| [calendar.md](./calendar.md) §6 | `tasks.remind_minutes_before` 列を消す | ✅ 本番DBに列が残り、`api/tasks.ts` が参照している | 旧APK・旧Webが使われなくなってから。drop は SQL Editor 用 |
| [kakei.md](./kakei.md) §7 の3 | 月の振り返りのメモ、カードの月末の照合と「締める」（`money_months`・`money_card_closes`） | ✅ 表が無い | カードの `close_day` などの設定と、引き落としの自動記録は済 |
| [kakei.md](./kakei.md) §7 の5 | 年の振り返り（月ごとの棒グラフ、大分類ごとの年間の差、特別費の年の流れ、これから5年の見通し） | 📄 | home.md §6 の4c（見通し）と同じもの |
| [home.md](./home.md) §10.6 の C | 日用品の作り直し（店ごとのタイル、「入っています」の印、よく送るものを上に） | ✅ タイルの実装が無い | 日用品の詳しい画面（§4.6）は別に済 |
| [home.md](./home.md) §10.6 の D | 暮らしのメニューを情報のある要約にする | ✅ 「要確認 n」の札だけ | A・C の要約がそろってから |
| [lists.md](./lists.md) §8 のフェーズ3 | リストの項目を「予定にする」で `tasks` へ送る | ✅ 実装が無い | ホームタブは無くなったので、件数の出し先は暮らしタブで決める |
| [what-to-record.md](./what-to-record.md) §8 の5 | 1日のサマリ画面 | ✅ 実装が無い | 育児タブの形が変わったので、置き場所から決め直す |
| [what-to-record.md](./what-to-record.md) §8 の6 | うんちを写真に置き換え（Storage） | ✅ 実装が無い | |
| [what-to-record.md](./what-to-record.md) §8 の7 | 記録した人を一覧（タイムライン）から外し、詳細だけに残す | ✅ `LogTimeline.tsx` に「◯◯が記録」が残っている | §10で決定済み |
| [what-to-record.md](./what-to-record.md) §8 の9 | 予防接種のスケジュール（`tasks`） | ✅ 初期データ（`seedData.ts`）のみ | |
| [what-to-record.md](./what-to-record.md) §8 の8 | 母乳の分数を未入力のまま保存できるように | ✅ `leftMinutes ?? 0` が残っている | 優先度を下げてある（§11-4） |
| [notifications.md](./notifications.md) §11 | `kind = 'webpush'` の行を消す（削除なので SQL Editor で流す）。`VAPID_KEYS`・`VAPID_SUBJECT`（Supabase）と Vercel の `NEXT_PUBLIC_VAPID_PUBLIC_KEY` を消す | ✅ 本番DBに `webpush` が4件 | PWA版の通知を外した（案1。2026-10-09）ので、もう使われない |
| [calendar.md](./calendar.md) §1 | 繰り返しの「この回だけ」「これ以降」の変更 | ✅ 「まだ無い」と明記 | |
| [home.md](./home.md) §8 の1 | 学費の目安（特別費とは別の面） | 📄 | 特別費が回ってから決める |

## 2. 先に決めること（未決）

| 設計書 | 論点 | 状況 |
|---|---|---|
| – | Web Push の扱いは**決定済み**（PWA版の通知を外す。2026-10-09）。残りは§1の手元作業 | – |
| [kakei.md](./kakei.md) §8 の3 | 「特別費残高」（Zaim の仮想の出金元）を振替で持つか | 年の振り返り（§7 の5）で決める |
| [home.md](./home.md) §9.7 | 福引の賞の名前（白玉・青玉・赤玉）は仮 | 実機で見てから |

## 3. 手元（実機・外部サービス）でしかできないもの

| 設計書 | 作業 | 備考 |
|---|---|---|
| [native-app-rewrite.md](./native-app-rewrite.md) §9 | Supabase の Authentication > URL Configuration の Redirect URLs に `sukusuku://**` を足す | 無いと、メール確認リンクからアプリに戻れない |
| [store-release.md](./store-release.md) §3 | 署名鍵を自分たちの keystore へ切り替える（Secrets に `ANDROID_KEYSTORE_BASE64` などを登録） | 日本での施行は2027年以降。急がない。切り替えると端末で入れ直しになる |
| [kakei.md](./kakei.md) §7 | Zaim を消す（期限は2026年10月末）。要るのは 4・6・7 で、設計書上はすべて実装済み | 口座の実運用で不足が無いかを確かめてから |
| [night-wake-alarm.md](./night-wake-alarm.md) | 実機での確認 | 実装は済（§9の1〜3） |

## 4. 実装前に確かめること（状態が書かれていなかったもの）

| 設計書 | 項目 | 確認結果 |
|---|---|---|
| [family-app.md](./family-app.md) §5 の2〜5・4b | `family_members`、育児タブ、予定の参加者、アプリ名・アイコン | ✅ 済（本番DBに `family_members`、`assignee` 列は無く `participants` に移行、アプリ名「かぞく手帳」） |
| [family-app.md](./family-app.md) §7 の5 | 授乳間隔・体温リマインダーを設定の通知に統合 | ✅ 済（`FeedingIntervalSetting`・`TemperatureReminderSetting`） |
| [family-app.md](./family-app.md) §4.1 | タブは4つ | 📄 いまは暮らし・家計が加わって6つ。本文は初期案として読む |

---

## 5. 古くなった記述（直さずに経緯として残してあるもの）

- [native-app-rewrite.md](./native-app-rewrite.md) のフェーズ4（PWAを畳む）と、§7の条件 A〜D。
  2026-09-29に取り下げ済み（冒頭と `CLAUDE.md`）。
- [native-app.md](./native-app.md)・[native-app-android.md](./native-app-android.md)。
  検討メモで、どちらも採らないと冒頭に書いてある。
- [what-to-record.md](./what-to-record.md) §8 冒頭の「`src/` に作る」「凍結が解けるまで」。凍結は解けた。

## 6. 更新のしかた

作業を終えたら、**その設計書の本文**の状態を直し、あわせてこの表の行を消す（または§4へ移す）。
新しく「あとでやる」ことが出たら、設計書の側に書いたうえで、ここに1行足す。
