# TaskAgent デプロイガイド

## 前提条件

- [Fly.io CLI](https://fly.io/docs/getting-started/installing-flyctl/) インストール済み
- [Vercel CLI](https://vercel.com/docs/cli) インストール済み
- Supabase プロジェクトの作成済み
- OpenAI API キーの取得済み

## 1. Supabase 本番環境の準備

### 1.1 プロジェクト作成
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクト作成
2. 地域: `Northeast Asia (Tokyo)` を推奨

### 1.2 データベーススキーマの適用
```bash
# ローカルからスキーマをエクスポート
supabase db dump --local > schema.sql

# 本番環境に適用
supabase db reset --linked
```

### 1.3 環境変数の取得
```bash
# Settings > API から以下を取得:
# - Project URL (SUPABASE_URL)
# - anon key (SUPABASE_ANON_KEY)  
# - service_role key (SUPABASE_SERVICE_ROLE_KEY)
# - Database URL (DATABASE_URL)
```

## 2. バックエンド API デプロイ (Fly.io)

### 2.1 Fly.io へのログイン
```bash
fly auth login
```

### 2.2 アプリの初期化
```bash
cd apps/api
fly launch --no-deploy
# アプリ名: taskagent-api (または任意の名前)
# 地域: Tokyo (nrt)
```

### 2.3 環境変数の設定
```bash
fly secrets set \
  DATABASE_URL="postgresql://postgres:password@host:port/database" \
  SUPABASE_URL="https://your-project.supabase.co" \
  SUPABASE_KEY="your-supabase-anon-key" \
  SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key" \
  OPENAI_API_KEY="sk-proj-your-openai-api-key" \
  ENVIRONMENT="production" \
  CORS_ORIGINS="https://taskagent.vercel.app"
```

### 2.4 デプロイ実行
```bash
fly deploy
```

### 2.5 動作確認
```bash
# ヘルスチェック
curl https://taskagent-api.fly.dev/health

# API ドキュメント
open https://taskagent-api.fly.dev/docs
```

## 3. フロントエンド デプロイ (Vercel)

### 3.1 Vercel へのログイン
```bash
vercel login
```

### 3.2 プロジェクトの初期化
```bash
cd apps/web
vercel
# プロジェクト名: taskagent
# フレームワーク: Next.js
```

### 3.3 環境変数の設定
```bash
# Vercel Dashboard または CLI で設定
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add NEXT_PUBLIC_API_URL production
vercel env add NEXT_PUBLIC_APP_URL production
```

### 3.4 本番デプロイ
```bash
vercel --prod
```

## 4. ドメイン設定 (オプション)

### 4.1 Fly.io でカスタムドメイン
```bash
fly certs add api.yourdomain.com
```

### 4.2 Vercel でカスタムドメイン
```bash
vercel domains add yourdomain.com
```

## 5. モニタリング設定

### 5.1 Fly.io ログ監視
```bash
fly logs -a taskagent-api
```

### 5.2 Vercel 分析
```bash
vercel analytics
```

## 6. トラブルシューティング

### API サーバーが起動しない場合
```bash
# ログ確認
fly logs -a taskagent-api

# デバッグモードでデプロイ
fly deploy --verbose
```

### フロントエンドのビルドエラー
```bash
# ローカルでビルドテスト
npm run build

# Vercel ビルドログ確認
vercel logs
```

### データベース接続エラー
```bash
# Supabase 接続テスト
psql "postgresql://postgres:password@host:port/database"
```

## 7. セキュリティチェックリスト

- [ ] 環境変数が適切に設定されている
- [ ] CORS設定が正しく設定されている
- [ ] Supabase RLS (Row Level Security) が有効
- [ ] API キーが安全に管理されている
- [ ] HTTPSが強制されている
- [ ] セキュリティヘッダーが設定されている

## 8. パフォーマンス最適化

- [ ] CDNが有効化されている (Vercel)
- [ ] 画像最適化が設定されている
- [ ] API レスポンスキャッシュが適切に設定されている
- [ ] データベースインデックスが最適化されている

## 参考リンク

- [Fly.io Documentation](https://fly.io/docs/)
- [Vercel Documentation](https://vercel.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)