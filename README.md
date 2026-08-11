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
# .env.local に Supabase / Gemini の値を設定
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開くとアプリが表示されます。

### 環境変数 (`.env.local`)

| 変数名 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabaseプロジェクトの URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabaseの公開anonキー |
| `GEMINI_API_KEY` | Gemini APIキー（サーバー側のみで使用。`NEXT_PUBLIC_`は付けない） |
| `GEMINI_MODEL` | 使用するGeminiモデル（省略時 `gemini-2.5-flash`） |

## ディレクトリ構成

```
src/
  app/
    page.tsx              # トップページ（SukusukuAppを読み込み）
    api/ai-chat/route.ts  # AI育児相談のRoute Handler（Gemini APIをサーバー側で呼び出す）
  components/sukusuku/
    SukusukuApp.tsx        # アプリ本体（状態管理・タブ/モーダルの組み立て）
    tabs/                  # ホーム/予定/記録/お祝い/ストックの各タブ
    modals/                # タスク追加・詳細・AIチャットの各モーダル
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
- [x] Gemini AIチャットをRoute Handler経由に変更（APIキーをサーバー側に隔離）
- [x] Supabaseスキーマ（9テーブル）・RLSポリシー・Storageポリシーのマイグレーションを追加
- [x] Supabaseクライアント（ブラウザ/サーバー）の雛形を追加
- [ ] Supabaseプロジェクトの実際の作成・マイグレーション適用
- [ ] 認証（メール/Google）・招待コードによる夫婦の家族紐付け機能
- [ ] 画面のダミーデータをSupabaseからの取得・保存に置き換え
- [ ] 書類箱の画像アップロード（Supabase Storage）
- [ ] Vercelへのデプロイ・GitHub連携

## デプロイ

[Vercel Platform](https://vercel.com/new) にこのリポジトリを接続し、上記の環境変数を設定してデプロイします。
