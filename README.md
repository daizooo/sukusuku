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
    tabs/                  # ホーム/予定/記録/お祝い/設定の各タブ
    modals/                # タスク追加・詳細の各モーダル
  lib/
    dateUtils.ts / uiUtils.ts / seedData.ts
    supabase/client.ts     # ブラウザ用Supabaseクライアント
    supabase/server.ts     # サーバー用Supabaseクライアント
  types/app.ts             # ドメイン型定義
supabase/migrations/
  0001_init_schema.sql     # テーブル定義 + RLSポリシー
  0002_storage.sql         # 書類箱用Storageバケット + ポリシー
  0010_calendar_fields.sql # カレンダー用カラム(日付・時刻・ラベル・リマインダー)
```

## 現在の実装状況

- [x] Next.jsプロジェクトの初期化・Tailwind設定
- [x] プロトタイプUI（ホーム/予定/記録/お祝い/設定の5タブ、各種モーダル）をTypeScriptコンポーネントとして移植（画面は現時点ではダミーデータで動作）
- [x] Supabaseスキーマ（9テーブル）・RLSポリシー・Storageポリシーのマイグレーションを追加
- [x] Supabaseクライアント（ブラウザ/サーバー）の雛形を追加
- [x] Supabaseプロジェクト作成・マイグレーション適用・Security/Performance Advisor対応・型生成 (`src/types/supabase.ts`)
- [x] 認証（メール/パスワード）・招待コード（家族UUID）による夫婦の家族紐付け機能 (`/login`, `/family-setup`)
- [x] 予定(tasks)タブをSupabase実データに接続（一覧取得・追加・編集・完了切替・削除、家族作成時に定番ToDoを自動投入）
- [x] カレンダー機能（日付・時刻・場所・詳細・ラベル・リマインダーの入力、月カレンダーの日付選択）→ [docs/calendar.md](docs/calendar.md)
- [ ] リマインダーの配信（PWA + Web Push）※現在は通知タイミングを保存するのみ
- [x] アカウント設定（役割（パパ/ママ）の変更・表示名の変更・招待コードの確認・ログアウト）
- [ ] Google認証などの追加サインイン方法
- [ ] 育児記録・成長グラフ・お祝い管理・保活メモ・書類箱のSupabase連携
- [ ] 書類箱の画像アップロード（Supabase Storage）
- [ ] Vercelへのデプロイ・GitHub連携

### 認証・データ連携の仕組み

- `src/proxy.ts`（Next.js 16の`middleware`は`proxy`に名称変更）: 未ログイン時は`/login`へ、`family_id`未設定時は`/family-setup`へリダイレクト
- `/login`: メール/パスワードでのサインアップ・ログイン（Supabase Auth）
- `/family-setup`: 家族の新規作成（`families`にINSERT→自分の`users.family_id`を更新→定番ToDoを一括投入）、または招待コード（家族のUUID）を入力して既存家族に参加
- `src/lib/api/tasks.ts`: `tasks`テーブルのCRUDとDB行⇔アプリ型のマッピング。`SukusukuApp`から呼び出し、楽観的UI更新＋失敗時ロールバックを行う
- `src/lib/api/account.ts`: `users`テーブルのうち自分の役割（パパ/ママ）・表示名の取得と更新
- サインアップ時は`auth.users`へのINSERTをトリガーに`public.users`へ空プロフィール行を自動作成（`0005_auth_user_trigger.sql`）
- 設定タブの一番下に**アカウント**カード（`AccountSection`）があり、役割（パパ/ママ）の変更・表示名の変更・招待コードの再確認・ログアウトができる。家族参加時に役割を選び間違えた場合はここで修正する

### メール確認リンクの挙動について

サインアップ確認メールのリンクはSupabaseの`/auth/v1/verify`を経由し、**そこでメールアドレスの確認が完了してから**アプリの`/auth/confirm`へ`code=`付きでリダイレクトされます。

`code`をセッションに交換する処理（PKCE）には、登録操作を行ったブラウザに保存された`code_verifier`が必要です。そのため、**登録した端末と別の端末やメールアプリ内のブラウザでリンクを開くと交換に失敗します**。このときメール確認自体は成功しているため、以前は「確認リンクが無効か、有効期限切れです」と表示されるのに登録自体は完了している、という食い違いが起きていました。

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

### 実行リージョンを東京に固定している理由（重要）

`vercel.json` で `"regions": ["hnd1"]`（東京）を指定しています。**この設定を外さないでください。**

このアプリはミドルウェアとServer Componentの両方からSupabaseへアクセスするため、初回表示あたり
複数回のサーバー→Supabase往復が発生します。Supabaseプロジェクトは `ap-northeast-1`（東京）にあるため、
Vercel側の実行リージョンが既定の `iad1`（米国バージニア）のままだと往復1回ごとに太平洋横断の
レイテンシ（RTT 約150〜200ms）が上乗せされ、起動が体感で1秒近く遅くなります。

### 起動パフォーマンス上の設計方針

- 認証チェックには `getUser()` ではなく `getClaims()` を使う。`getUser()` は毎回Authサーバーへの
  ネットワーク往復を伴うが、`getClaims()` はJWTが非対称鍵で署名されていればWebCrypto＋
  キャッシュ済みJWKSでローカル検証が完結する（このプロジェクトの署名鍵は `ES256`）。
  `getSession()` は署名を検証しないため認可判断には使わない。
- ホームタブ以外のタブは `next/dynamic` で遅延ロードする。特に `LogTab` は成長グラフのために
  recharts（単体で約350KB）を持ち込むため、静的importに戻すと初期バンドルへ混入する。
- トップページには `loading.tsx` を置き、サーバー側の認証・プロフィール取得を待つ間も
  白画面にならないようにする。
