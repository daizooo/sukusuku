# すくすく手帳

夫婦で育児タスク・記録・スケジュールを共有するWebアプリケーション。

## 技術スタック

- フロントエンド: Next.js (App Router) + React + TypeScript
- スタイリング: Tailwind CSS
- UI/アイコン/グラフ: lucide-react, recharts
- バックエンド/DB: Supabase (PostgreSQL, Auth, Storage)
- ホスティング: Vercel

詳細な設計方針は基本設計書を参照してください。

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local に Supabase の値を設定
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開くとアプリが表示されます。

### 環境変数 (`.env.local`)

| 変数名 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabaseプロジェクトの URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseの公開anonキー |

## ディレクトリ構成

```
src/
  app/
    page.tsx              # トップページ（SukusukuAppを読み込み）
    login/                # ログイン・サインアップ画面
    family-setup/         # 家族の作成・招待コード参加画面
    auth/confirm/         # メール確認リンクのコールバック
  components/sukusuku/
    SukusukuApp.tsx        # アプリ本体（状態管理・タブ/モーダルの組み立て）
    tabs/                  # ホーム/予定/記録/お祝い/ストックの各タブ
    modals/                # タスク追加・詳細の各モーダル
  lib/
    dateUtils.ts / uiUtils.ts / seedData.ts
    supabase/client.ts     # ブラウザ用Supabaseクライアント
    supabase/server.ts     # サーバー用Supabaseクライアント
  types/app.ts             # ドメイン型定義
supabase/migrations/
  0001_init_schema.sql     # テーブル定義 + RLSポリシー
  0002_storage.sql         # 書類箱用Storageバケット + ポリシー
```

## 現在の実装状況

- [x] Next.jsプロジェクトの初期化・Tailwind設定
- [x] プロトタイプUI（ホーム/予定/記録/お祝い/ストックの5タブ、各種モーダル）をTypeScriptコンポーネントとして移植（画面は現時点ではダミーデータで動作）
- [x] Supabaseスキーマ（9テーブル）・RLSポリシー・Storageポリシーのマイグレーションを追加
- [x] Supabaseクライアント（ブラウザ/サーバー）の雛形を追加
- [x] Supabaseプロジェクト作成・マイグレーション適用・Security/Performance Advisor対応・型生成 (`src/types/supabase.ts`)
- [x] 認証（メール/パスワード）・招待コード（家族UUID）による夫婦の家族紐付け機能 (`/login`, `/family-setup`)
- [x] 予定(tasks)タブをSupabase実データに接続（一覧取得・追加・編集・完了切替・削除、家族作成時に定番ToDoを自動投入）
- [x] アカウント設定（役割（パパ/ママ）の変更・表示名の変更・招待コードの確認・ログアウト）
- [ ] Google認証などの追加サインイン方法
- [ ] プロフィール（子供の名前・誕生日、パパママの名前・勤務先、住所）のSupabase連携
- [ ] 育児記録・成長グラフ・お祝い管理・保活メモ・書類箱のSupabase連携
- [ ] 書類箱の画像アップロード（Supabase Storage）
- [ ] Vercelへのデプロイ・GitHub連携

### 認証・データ連携の仕組み

- `src/proxy.ts`（Next.js 16の`middleware`は`proxy`に名称変更）: 未ログイン時は`/login`へ、`family_id`未設定時は`/family-setup`へリダイレクト
- `/login`: メール/パスワードでのサインアップ・ログイン（Supabase Auth）
- `/family-setup`: 家族の新規作成（`families`にINSERT→自分の`users.family_id`を更新→定番ToDoを一括投入）、または招待コード（家族のUUID）を入力して既存家族に参加
- `src/lib/api/tasks.ts`: `tasks`テーブルのCRUDとDB行⇔アプリ型のマッピング。`SukusukuApp`から呼び出し、楽観的UI更新＋失敗時ロールバックを行う
- `src/lib/api/profile.ts`: `users`テーブル（役割・表示名）の取得と更新
- サインアップ時は`auth.users`へのINSERTをトリガーに`public.users`へ空プロフィール行を自動作成（`0005_auth_user_trigger.sql`）
- ストックタブの「設定」（ヘッダー右上の歯車アイコンからも遷移）に**アカウント**カードがあり、役割（パパ/ママ）の変更・表示名の変更・招待コードの再確認・ログアウトができる

### メール確認リンクの挙動について

サインアップ確認メールのリンクはSupabaseの`/auth/v1/verify`を経由し、**そこでメールアドレスの確認が完了してから**アプリの`/auth/confirm`へ`code=`付きでリダイレクトされます。

`code`をセッションに交換する処理（PKCE）には、登録操作を行ったブラウザに保存された`code_verifier`が必要です。そのため、**登録した端末と別の端末やメールアプリ内のブラウザでリンクを開くと交換に失敗します**。このときメール確認自体は成功しているため、以前は「確認リンクが無効か、有効期限切れです」と表示されるのに登録は completed している、という食い違いが起きていました。

現在の`/auth/confirm`はこの2つを区別します。

| 状況 | 遷移先 | 表示 |
| --- | --- | --- |
| セッション交換に成功 | `/`（そのままログイン状態） | — |
| Supabase側の検証に失敗（`error`/`error_code`付き。期限切れ・使用済みリンク） | `/login?error=confirm_failed` | 「確認リンクが無効か、有効期限切れです」 |
| 検証は成功したがセッション交換に失敗（別ブラウザで開いた等） | `/login?message=email_confirmed` | 「メールアドレスの確認が完了しました。…ログインしてください」 |

端末をまたいでもそのままログイン状態にしたい場合は、Supabaseダッシュボードの Authentication > Email Templates で確認メールのリンクを

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
```

に変更してください。`token_hash`形式は`code_verifier`に依存しない`verifyOtp()`フローを使うため、どの端末で開いてもその場でログイン状態になります（`/auth/confirm`は両方の形式に対応済み）。

### 既知の制約 / 動作確認について

この開発環境（サンドボックス）はネットワークポリシーにより`*.supabase.co`への直接アクセスがブロックされているため、ブラウザから実際にサインアップ〜家族作成〜タスク登録までの動作確認は行えていません（`npm run build` / `next lint` / `tsc --noEmit` は通過済み、DBスキーマとRLSポリシーはSupabase側で適用・Advisorでの警告なしを確認済み）。Vercelへのデプロイ後、またはローカル環境（`npm run dev`）で一度実際にサインアップ〜家族作成〜予定追加の一連の流れをご確認ください。

### Supabaseプロジェクト

- 組織: `daizooo` / プロジェクト名: `sukusuku` / リージョン: `ap-northeast-1`（東京）
- URL・anonキーはSupabaseダッシュボード（Project Settings > API）から取得し、`.env.local` に設定してください
- スキーマは `supabase/migrations/` を上から順に適用したものと同一です（`apply_migration` で反映済み）
- `src/types/supabase.ts` はこのプロジェクトから `generate_typescript_types` で生成した型です。スキーマ変更後は再生成してください

## デプロイ

[Vercel Platform](https://vercel.com/new) にこのリポジトリを接続し、上記の環境変数を設定してデプロイします。
