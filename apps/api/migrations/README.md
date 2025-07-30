# Database Migrations

## Supabase 本番環境セットアップ

### 1. Supabase プロジェクト作成
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクト作成
2. 地域: `Northeast Asia (Tokyo)` を選択
3. プロジェクト名: `taskagent-production`

### 2. データベーススキーマの適用

#### オプション A: SQL Editor を使用
1. Supabase Dashboard → SQL Editor
2. `001_initial_schema.sql` の内容をコピー＆ペースト
3. "RUN" ボタンをクリック

#### オプション B: Supabase CLI を使用
```bash
# Supabase CLI インストール
npm install -g supabase

# プロジェクトにリンク
supabase link --project-ref your-project-ref

# マイグレーション実行
supabase db push
```

### 3. 認証設定
1. Authentication → Settings
2. Email confirmation: 無効化 (開発用)
3. Email templates: カスタマイズ (オプション)

### 4. API キーの取得
1. Settings → API
2. 以下をコピー:
   - Project URL
   - anon public key
   - service_role secret key (注意: 本番環境でのみ使用)

### 5. Database URL の取得
1. Settings → Database
2. Connection string をコピー
3. パスワードを実際のパスワードに置換

### 6. セキュリティ設定の確認
- [ ] Row Level Security (RLS) が有効
- [ ] 適切なポリシーが設定済み
- [ ] service_role key が安全に管理されている

## トラブルシューティング

### マイグレーションエラー
```sql
-- エラーが発生した場合、テーブルを削除して再実行
DROP TABLE IF EXISTS logs, schedules, tasks, goals, projects, users CASCADE;
```

### RLS ポリシーエラー
```sql
-- ポリシーを削除して再作成
DROP POLICY IF EXISTS "policy_name" ON table_name;
```

### インデックスエラー
```sql
-- インデックスを削除して再作成
DROP INDEX IF EXISTS index_name;
```
