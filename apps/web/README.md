# HumanCompiler Web

Next.js 15 (App Router) で構築されたフロントエンドアプリケーション。

## セットアップ

### 前提条件

- Node.js 20+
- pnpm 9.0+

### インストール

```bash
# リポジトリルートから
pnpm install

# 環境変数の設定
cp apps/web/.env.example apps/web/.env.local
```

環境変数の詳細は [.env.example](.env.example) を参照してください。

## 開発

```bash
# 開発サーバー起動
pnpm run dev

# 型チェック
pnpm run type-check

# Lint
pnpm run lint
```

開発サーバーは http://localhost:3000 で起動します。

## テスト

```bash
# テスト実行
pnpm run test

# ウォッチモード
pnpm run test:watch

# カバレッジ
pnpm run test:coverage
```

## ビルド

```bash
# プロダクションビルド
pnpm run build

# ビルド後のサーバー起動
pnpm run start

# バンドル解析
pnpm run analyze
```

## プロジェクト構成

```
src/
├── app/                    # Next.js App Router ページ
├── components/             # React コンポーネント
│   ├── ui/                 # 汎用UIコンポーネント (Button, Card, Dialog等)
│   ├── goals/              # ゴール関連コンポーネント
│   ├── tasks/              # タスク関連コンポーネント
│   ├── projects/           # プロジェクト関連コンポーネント
│   ├── timeline/           # タイムライン可視化
│   ├── logs/               # ログ関連コンポーネント
│   └── layout/             # レイアウトコンポーネント
├── hooks/                  # カスタム React フック
│   └── utils/              # フック用ユーティリティ
├── lib/                    # ユーティリティ・APIクライアント
│   └── timeline/           # タイムライン計算ロジック
└── types/                  # TypeScript 型定義
```

## 主要な技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Next.js 15 (App Router) |
| 言語 | TypeScript |
| スタイリング | Tailwind CSS |
| 状態管理 | React Query, Zustand |
| フォーム | React Hook Form + Zod |
| 認証 | Supabase Auth |
| UIコンポーネント | Radix UI |
| テスト | Jest + React Testing Library |

## 環境変数

主要な環境変数:

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名キー |
| `NEXT_PUBLIC_API_PRODUCTION_URL` | 本番API URL |
| `NEXT_PUBLIC_API_DEVELOPMENT_URL` | 開発API URL |

詳細は [.env.example](.env.example) を参照してください。

## ライセンス

AGPL-3.0-or-later または商用ライセンス
