# 🔑 GitHub Secrets 設定ガイド

CI/CD自動デプロイに必要なGitHub Repository Secretsの設定方法です。

## 📍 設定場所

1. **GitHubレポジトリページ**: https://github.com/masa10-f/TaskAgent
2. **Settings** タブ → **Secrets and variables** → **Actions**
3. **New repository secret** ボタンで各シークレットを追加

---

## 🛫 Fly.io (API サーバー) 関連

### `FLY_API_TOKEN`
**用途**: APIサーバーの自動デプロイ用
**取得方法**:
```bash
# Fly.io CLIにログイン
fly auth login

# APIトークンを取得
fly auth token
```
**設定値例**: `fo1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## 🌐 Vercel (フロントエンド) 関連

### ❌ **Vercel シークレット不要**

**理由**: VercelがGitHubリポジトリと直接連携済みのため、GitHub Actions経由のデプロイは不要

**自動デプロイ設定:**
- GitHub Integration: ✅ 設定済み
- 本番デプロイ: `main` ブランチへのpush時
- プレビューデプロイ: Pull Request作成時
- 設定ファイル: `vercel.json`

**💡 環境変数設定**: Vercel Dashboardで直接設定
1. https://vercel.com/dashboard でプロジェクトを選択
2. **Settings** → **Environment Variables**
3. 必要な`NEXT_PUBLIC_*`変数を設定

---

## 🗄️ Supabase (データベース・認証) 関連

### `SUPABASE_URL`
**用途**: APIサーバーのデータベース接続
**取得方法**:
1. https://supabase.com/dashboard にアクセス
2. プロジェクトを選択
3. **Settings** → **API**
4. **Project URL** をコピー

**設定値例**: `https://xxxxxxxxxxxxxxxxxxxxxxxxx.supabase.co`

### `SUPABASE_ANON_KEY`
**用途**: APIサーバーの認証用
**取得方法**:
1. Supabase Dashboard → **Settings** → **API**
2. **Project API keys** セクション
3. **anon** **public** キーをコピー

**設定値例**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### `SUPABASE_SERVICE_ROLE_KEY`
**用途**: APIサーバーの管理者権限操作用
**取得方法**:
1. Supabase Dashboard → **Settings** → **API**
2. **Project API keys** セクション
3. **service_role** **secret** キーをコピー

**設定値例**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### `NEXT_PUBLIC_SUPABASE_URL`
**用途**: フロントエンドのSupabase接続
**取得方法**: `SUPABASE_URL` と同じ値を使用

**設定値例**: `https://xxxxxxxxxxxxxxxxxxxxxxxxx.supabase.co`

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`
**用途**: フロントエンドのSupabase認証
**取得方法**: `SUPABASE_ANON_KEY` と同じ値を使用

**設定値例**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

---

## 🤖 OpenAI (AI機能) 関連

### `OPENAI_API_KEY`
**用途**: AI機能（週間計画生成など）のテスト用
**取得方法**:
1. https://platform.openai.com/api-keys にアクセス
2. **Create new secret key** をクリック
3. キー名を入力（例: "TaskAgent Testing"）
4. **Create secret key** をクリックしてコピー

**設定値例**: `sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## 📋 設定チェックリスト

**必要なGitHub Secrets: 4個のみ**

### ✅ GitHub Repository Secrets (4個)
- [ ] `FLY_API_TOKEN` - Fly.io APIデプロイ用
- [ ] `SUPABASE_URL` - データベース接続用
- [ ] `SUPABASE_ANON_KEY` - API認証用
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - 管理者権限用
- [ ] `OPENAI_API_KEY` - AIテスト用

### ✅ Vercel Dashboard 設定 (GitHub Actions不要)
- [ ] GitHub Integration - 自動デプロイ設定済み
- [ ] Environment Variables - `NEXT_PUBLIC_*`変数をVercel Dashboardで設定
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 🚀 設定後のテスト方法

### 1. GitHub Actions の実行テスト
```bash
# コードを変更してpush
git add .
git commit -m "test: CI/CD pipeline"
git push origin main
```

### 2. Actions タブで実行状況確認
- GitHub レポジトリの **Actions** タブを開く
- ワークフローの実行状況を確認
- エラーがある場合はログを確認

### 3. デプロイ結果の確認
- **API**: https://taskagent-api.fly.dev/health
- **Frontend**: https://taskagent.vercel.app
- **API Docs**: https://taskagent-api.fly.dev/docs

---

## ⚠️ セキュリティ注意事項

### 🛡️ シークレット管理
- **絶対にコードにコミットしない**: APIキーやトークンをコードに直接書かない
- **適切な権限設定**: 必要最小限の権限のみ付与
- **定期的なローテーション**: APIキーは定期的に更新

### 🔍 トラブルシューティング
- **シークレットが認識されない**: 名前のスペルミスを確認
- **権限エラー**: 各サービスでトークンの権限を確認
- **接続エラー**: URLやキーの形式が正しいか確認

---

## 📞 サポート

設定で問題が発生した場合:
1. **GitHub Actions ログ**: エラーメッセージを確認
2. **各サービスのドキュメント**: 公式ドキュメントを参照
3. **Issue作成**: 具体的なエラー情報と共にIssueを作成

設定完了後は、コードをpushするだけで自動的にAPIとフロントエンドが本番環境にデプロイされます！
