# 契約（賃貸・保険・サブスクなどの控え）

その他タブ（[family-app.md §4.5](./family-app.md)）の「契約」の中身の設計。2026-10-13。
**状態: §9 の PR1（DB + 画面）を実装した（2026-10-13）。PR2（更新日のお知らせ）はこれから。**
migration は `0096_contracts.sql`（本番DBへ適用済み）。画面は mobile `app/contracts.tsx`（部品は `components/contracts/`）、
PWA `tabs/ContractsScreen.tsx`（部品は `tabs/ContractCard.tsx`・`modals/ContractModal.tsx`）。計算は `contractUtils.ts`
（`npm run test:contracts`）、読み書きは `lib/api/contracts.ts`。その他タブの「契約」の行は、いちばん急ぐ更新日をバッジで添える
（`ContractMoreRow`）。お知らせ（§6）は未実装なので、いまは一覧のバッジとその他タブの行だけで知らせる。

## 1. 何のためにあるか

賃貸・保険・サブスクなどは、**更新の時期を忘れる**・**どこと何を契約したか家族で分からない**・**年にいくら払っているか分からない**
の3つが困りごと。この画面は次の3つに答える。

1. 家族の契約を一覧で見られる（種類・会社・契約者・金額）
2. **更新日が近いものを知らせる**（一覧のバッジと、端末へのお知らせ）
3. 年間でいくらかかっているかの目安が分かる

## 2. 決めたこと（2026-10-13）

| 論点 | 決定 |
|---|---|
| 想定する種類 | 賃貸 / 保険（自動車・医療・就労不能など） / サブスク / その他 |
| 項目 | **すべての種類に共通する項目だけを固定**し、残りは**契約ごとに自由に追加**できる（§3） |
| 書類 | **持たない**（契約書・証券の写真は保存しない。セキュリティのため） |
| 更新日のお知らせ | **出す**（端末への通知。§6） |
| 家計との関係 | **連動しない**。固定費・特別費のルールは作らず、ひも付けもしない |
| 見せる相手 | **契約ごとに、家族3人から複数選ぶ**（「家族全員」と「自分だけ」の2択ではない。§5） |
| 持たないもの | 証券番号・契約番号・口座・カード番号・パスワード。[family-app.md §3.3](./family-app.md) の方針のとおり、漏れたときの害が大きい |

## 3. 項目

### 3.1 共通項目（列で持つ）

| 項目 | 型 | 補足 |
|---|---|---|
| 種類 | `rent` / `insurance` / `subscription` / `other` | 一覧の絞り込みと、自由項目の候補の出し分けに使う |
| 小分類 | 文字（任意） | 保険なら「自動車」「医療」「就労不能」「火災」など。自由入力、候補をチップで出す |
| 名称 | 文字（必須） | 「◯◯マンション」「△△自動車保険」「動画配信」など |
| 会社 | 文字 | 管理会社・保険会社・サービス名 |
| 契約者 | 家族メンバー（任意） | `family_members.id`。誰の名義か |
| 開始日 | 日付（任意） | |
| 更新日 | 日付（任意） | **満了日・更新日・次の請求日をこの1つで表す**。無いものは通知もバッジも出ない |
| 契約期間 | 月数（任意） | 賃貸24、保険12、サブスク1など。「更新した」で更新日をこの月数だけ進める |
| 金額 | 整数（円）と周期 | 周期は 月 / 年 / 1回。年間の目安の計算に使う（§7） |
| お知らせ | 日数の並び | 既定は更新日の60日前・30日前・7日前。空にするとお知らせなし |
| メモ | 文字 | |
| 見せる相手 | 家族メンバーの複数 | §5 |

### 3.2 自由項目（行で持つ）

契約ごとに「ラベル: 値」を何行でも足せる。値は文字のみ。例:

- 賃貸: 物件の住所 / 管理会社の電話 / 家賃 / 共益費 / 敷金 / 更新料 / 保証会社
- 自動車保険: 車 / 等級 / 補償の内容 / 事故受付の電話
- 医療保険・就労不能: 保障の内容 / 入院日額 / 免責期間 / 受付の電話
- サブスク: 次回の請求日 / プラン / 解約のしかた / ログインに使うメールアドレス

ラベルの**候補は種類ごとに出す**（チップを押すとその行が足される）。候補は強制ではなく、自由に書き換えられる。
**入力欄の下に「証券番号・口座・カード番号・パスワードは入れないでください」と常に出す。** 実際には防げないので、案内で防ぐ。

## 4. データ

### 4.1 `contracts`

```
id                 uuid pk
family_id          uuid → families (on delete cascade)
created_by         uuid → users (on delete set null)
kind               text  check in ('rent','insurance','subscription','other')
category           text  not null default ''      -- 小分類
title              text  not null
company            text  not null default ''
contractor_id      uuid → family_members (on delete set null)
started_on         date
renews_on          date
term_months        int   check (term_months > 0)
amount             int   check (amount >= 0)
amount_cycle       text  check in ('monthly','yearly','once')   -- amount が null なら null
notify_days        int[] not null default '{60,30,7}'
memo               text  not null default ''
visible_member_ids uuid[] not null                  -- §5。空にはできない（check）
created_at / updated_at
```

### 4.2 `contract_fields`（自由項目）

```
id           uuid pk
contract_id  uuid → contracts (on delete cascade)
label        text not null
value        text not null default ''
position     int  not null default 0
```

### 4.3 共通の作法

- 両方の表を `attach_family_sync` に載せる（`contract_fields` は親の `contracts` をたどって家族を決める。0078 の例）。
  画面は `useFamilyRefresh(['contracts', 'contract_fields'], …)` を宣言する（CLAUDE.md「読み込みの作り方」）
- 読み込みは `contracts` と `contract_fields` の2本を `Promise.all` で並べる（一覧に要る要約だけなら `contracts` の1本。自由項目は開いたときに読む）
- 型は `mobile/src/types/supabase.ts`・`src/types/supabase.ts` を `generate_typescript_types` の結果とそろえる

## 5. 見せる相手（RLS）

`visible_member_ids` に入っている家族メンバーだけが、その契約と自由項目を見て、直して、消せる。
**作った本人は、選ばなくても常に見られる**（自分を外して契約を失わないように）。

```sql
-- 自分の family_members.id を返す（SECURITY DEFINER。RLS の中から users / family_members を引くため）
create function public.my_member_id() returns uuid ...
  select id from public.family_members where user_id = (select auth.uid());

-- contracts の select / update / delete
family_id = (自分の家族) and (
  created_by = (select auth.uid())
  or public.my_member_id() = any (visible_member_ids)
)
-- insert: family_id が自分の家族で、created_by が自分
-- contract_fields: 親の contracts が上の条件で見えること
```

- 画面の選択肢は家族メンバーの3人（夫・妻・子）。**子はアカウントを持つまで見られない**ので、アカウントが無いメンバーには「アカウント未登録」と添える（選べるが、見えるようになるのはアカウントを作ったあと）
- 新しい契約の既定は**作った本人だけ**（ToDoの「自分だけ」と同じ。家族に見せたいものだけ足す）
- 通知の宛先も同じ条件で絞る（§6）。見えない契約のお知らせが、見えない人に届かないようにする

> 確認したい点: 「項目毎に選ぶ」を**契約ごと**と読んだ。自由項目の1行ずつに見せる相手を付ける作りも考えられるが、
> 画面が重くなり、行ごとの漏れも起きやすい。「この行だけ自分だけ」が要る場合は、別の契約として分けてもらう前提にしている。

## 6. 更新日のお知らせ

防災備蓄の期限のお知らせ（[notifications.md](./notifications.md)・`send-stock-expiry-reminders`）と**同じ作り**にする。

- 毎朝9時（日本時間）に pg_cron が Edge Function `send-contract-reminders` を呼ぶ
- 何を知らせるかは日付の計算だけで決める。契約ごとの「知らせた」印は持たない:
  **「更新日の N 日前（N は `notify_days`）の日が、その端末へ前回送った日の翌日から今日までに来た契約」**を拾う
  （`supabase/functions/_shared/contractReminders.ts` に切り出し、`stockExpiry.ts` と同じく node でテストする）
- 端末ごとに送信済み記録 `contract_deliveries (subscription_id, notify_on)` を持つ（`stock_expiry_deliveries` と同じ形。
  `pending` を先に作って二重送信を防ぐ）。この表は家族で共有しない（NOT_SHARED と `family_sync_missing` に足す）
- 宛先は、その契約が見える人の端末だけ。1台に複数の契約が当たる朝は1通にまとめる
  （「賃貸の更新まで30日 ほか1件」）
- 更新日を過ぎた契約は知らせない（一覧のバッジが「更新日を過ぎています」を出す）
- お知らせの種類は `kind = 'contract'`。タップするとその他タブの契約の画面へ
  （`appLinks` の `notificationTarget`、`public/sw.js` の対応表にも足す。PWAは通知を受け取らないので mobile のみ実害がある）
- 静かな時間（夜間）の扱いは既存と同じ（`quietHours.ts`）。朝9時なので当たらない

## 7. 画面

mobile が正、PWA は同じ項目・文言（CLAUDE.md の第一優先）。

### 7.1 一覧（`app/contracts.tsx` / `tabs/ContractsScreen.tsx`）

```
┌ 固定 ───────────────────────────┐
│ ‹ 📄 契約                      ＋ │
│ 年間の目安  ¥486,000             │ ← 見えている契約の合計
│ [すべて][賃貸][保険][サブスク][その他] │ ← 絞り込み（スワイプでも切り替え）
├ スクロール ───────────────────┤
│ 賃貸  ◯◯マンション                │
│   管理会社△△ ・ 夫 ・ 月 ¥98,000  │
│   更新まで 38日（2026-11-20）  🟠  │
│ 保険  自動車保険（◯◯損保）         │
│   妻 ・ 年 ¥62,000                │
│   更新まで 112日                  │
│ サブスク  動画配信      🔒 自分だけ │
│   月 ¥990                        │
└───────────────────────────────┘
```

- 並びは**更新日の近い順**。更新日が無いものは末尾。更新日を過ぎたものは先頭に赤で
- バッジの色: 30日以内=橙、7日以内か過ぎている=赤、それ以外は灰。見せる相手が自分だけのものは錠前を添える（ToDoの一覧と同じ印）
- 年間の目安 = 月払い×12 + 年払い。「1回」の金額は入れない。見えている契約だけの合計（他の人にだけ見える契約は含まない）。
  見出しに「見えている契約の合計」と添え、家計の実績とは別物であることを分かりやすくする
- 一覧に要るのは要約だけ。自由項目は行を開いたときに読む
- 全体はスクロールさせない。見出し・絞り込みは固定し、一覧だけスクロールする（CLAUDE.md）。戻る操作はその他タブへ

### 7.2 追加・編集（モーダル。`SheetModal` / `ModalShell`）

上から: 種類（4つのチップ）→ 名称 → 会社 → 小分類（候補チップ）→ 契約者 → 開始日 → 更新日 → 契約期間 →
金額と周期 → **自由項目（ラベル/値の行。候補チップから足す）** → お知らせの日数（チップ: 60/30/14/7/3日前、複数選択）→
メモ → **見せる相手（家族3人のチップ、複数選択）** → 保存。編集では削除と **「更新した」**（更新日を契約期間ぶん進める）。

- 日付は既存の日付入力を使う。金額は数字のみ（数字を出す `Text` には `fontWeight` を付ける: CLAUDE.md）
- モーダルの暗い部分を押すと閉じる・戻る操作で閉じる・内側に `swipeBoundary`（CLAUDE.md の既存規約）
- 自由項目の入力欄の下に §3.2 の注意書きを常に出す

## 8. 検証の観点

- 見えない人に、一覧・自由項目・お知らせのどれも出ない（RLS と宛先の絞り込み。2つのアカウントで確かめる）
- 作った本人を `visible_member_ids` から外しても、本人は見える
- 更新日の計算（`contractReminders.ts`）: 月またぎ・うるう年・節目が複数同じ日に来る・前回送った日から空いたとき
- 年間の目安: 月/年/1回の混在、金額なしの契約、見えない契約が入らないこと
- 他の端末での変更が、アプリを開き直さずに一覧へ出る（`family_sync`）

## 9. 進め方（PRの分け方）

1. **DB + 画面（実装済み）**: migration（`contracts`・`contract_fields`・RLS・`attach_family_sync`・`my_member_id`）と、一覧・追加・編集・
   更新した・絞り込み・年間の目安（mobile → 同じPRで PWA）。migration は削除を含まないので、CLAUDE.md のとおり Claude が MCP で適用する
2. **お知らせ（これから）**: `contract_deliveries`・`send-contract-reminders`・`_shared/contractReminders.ts`（テスト付き）・pg_cron・
   `appLinks`/`sw.js` の対応。cron の登録 migration は、先頭の `cron.unschedule` が削除にあたる。本番に同名のジョブが無いことを確かめ、
   その行を外して MCP で適用する（リポジトリのファイルはそのまま。CLAUDE.md の「`drop ... if exists` …」と同じ扱い）
3. 使ってみて足りない項目・候補を直す

## 10. まだ決めていないこと

- 小分類・自由項目の**候補の一覧**（§3.2 は例。最初は上の例をそのまま入れ、使いながら増やす）
- 契約の**終了**（解約した契約を消すか、「終了」にして残すか）。まずは削除だけにして、残したくなったら `ended_on` を足す
- 子（アカウントなし）を見せる相手に選べることの見せ方（§5 の「アカウント未登録」の添え書きで足りるか）
