# TaskAgent 🚀

**AI駆動タスク管理ウェブアプリケーション**

研究・開発プロジェクトを「**大目標 → 週 → 日 → 実績**」の4階層で管理し、**OpenAI GPT-4** と **OR-Tools制約ソルバ** による自動スケジューリング・進捗可視化・リスケジューリングを実現する完全機能のタスク管理システムです。

![TaskAgent Demo](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
![Tech Stack](https://img.shields.io/badge/Stack-Next.js%20%7C%20FastAPI%20%7C%20Supabase-blue)
![AI Powered](https://img.shields.io/badge/AI-OpenAI%20GPT--4%20%7C%20OR--Tools-orange)

## ✨ 主な機能

### 🎯 **プロジェクト管理**
- **階層構造**: プロジェクト → ゴール → タスクの3層管理
- **完全CRUD**: 作成・編集・削除・一覧表示
- **進捗追跡**: リアルタイムでの進捗状況可視化
- **締切管理**: 期限設定と期限切れアラート

### 🤖 **AI機能（OpenAI GPT-4）**
- **週間計画自動生成**: プロジェクト状況を分析して最適な週間計画を提案
- **ワークロード分析**: タスク量・時間配分・プロジェクト別負荷を可視化
- **優先度提案**: AI分析による理由付きタスク優先度ランキング
- **自然言語処理**: 研究開発特化のプロンプトエンジニアリング

### ⚡ **スケジューリング最適化（OR-Tools）**
- **制約充足問題**: CP-SATソルバによる最適タスク割り当て
- **時間スロット管理**: 作業時間帯の種別（集中・軽作業・学習）対応
- **自動最適化**: 締切・優先度・時間制約を考慮した最適スケジュール生成
- **リアルタイム調整**: 進捗変化に応じた動的リスケジューリング

### 🎨 **現代的なUI/UX**
- **レスポンシブデザイン**: PC・タブレット・スマートフォン対応
- **shadcn/ui**: モダンでアクセシブルなコンポーネント
- **リアルタイム更新**: 変更内容の即座反映
- **直感的操作**: ドラッグ&ドロップ・インライン編集

## 🏗️ 技術スタック

| レイヤー | 技術 |
|----------|------|
| **フロントエンド** | Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, shadcn/ui |
| **バックエンド** | FastAPI (Python 3.13), Uvicorn, SQLModel, Pydantic |
| **データベース** | Supabase Postgres, Row Level Security (RLS) |
| **AI・最適化** | OpenAI GPT-4 Turbo, OR-Tools CP-SAT Solver |
| **認証** | Supabase Auth (JWT, OAuth) |
| **デプロイ** | Vercel (Frontend), Fly.io (API) |

## 🚀 クイックスタート

### 1. 環境要件
- **Node.js** 18.17+ 
- **Python** 3.11+
- **pnpm** または npm

### 2. プロジェクトセットアップ

```bash
# リポジトリをクローン
git clone <repository-url>
cd TaskAgent

# 依存関係をインストール
pnpm install
# または: npm install
```

### 3. 環境変数設定

`.env` ファイルを作成し、以下の値を設定してください：

```bash
# OpenAI API (AI機能用)
OPENAI_API_KEY=sk-proj-your-openai-api-key-here

# Supabase (認証・データベース用)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Database
DATABASE_URL=postgresql://postgres:password@localhost:54322/postgres

# FastAPI Configuration
API_BASE_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

#### 🔑 **API キー取得方法**

**OpenAI API キー:**
1. [OpenAI Platform](https://platform.openai.com/) でアカウント作成
2. API Keys ページでキー生成
3. GPT-4アクセス権限が必要（従量課金）

**Supabase設定:**
1. [Supabase](https://supabase.com/) でプロジェクト作成
2. Settings > API でURL・キー取得
3. Database > Settings でConnection string取得

### 4. 開発サーバー起動

```bash
# フロントエンド起動 (ターミナル1)
cd apps/web
npm run dev
# → http://localhost:3000

# バックエンド起動 (ターミナル2)
cd apps/api
pip install -r requirements.txt
python main.py
# → http://localhost:8000

# API ドキュメント
# → http://localhost:8000/docs
```

## 📋 使い方

### 基本的なワークフローの流れ

#### **Step 1: プロジェクト作成**
1. **ダッシュボード**から「新しいプロジェクト」をクリック
2. プロジェクト名・説明・期限を入力
3. 保存してプロジェクト詳細画面へ

#### **Step 2: ゴール設定**
1. プロジェクト詳細画面で「ゴール追加」
2. 具体的な目標・見積時間・優先度を設定
3. 複数のゴールを設定して大きな目標を分割

#### **Step 3: タスク作成**
1. ゴール詳細画面で「タスク追加」
2. 実行可能な具体的タスクを定義
3. 見積時間・締切・ステータスを設定

#### **Step 4: AI週間計画生成**
1. **AI Planning**タブを開く
2. 「週間計画生成」で対象プロジェクト・期間を選択
3. AIが自動で最適な週間計画を生成・提案

#### **Step 5: スケジューリング最適化**
1. **Scheduling**タブを開く
2. 利用可能時間スロットを設定（時間・種別）
3. OR-Toolsによる最適スケジュール生成
4. 結果を確認・必要に応じて調整

#### **Step 6: 進捗管理**
1. タスク完了時にステータスを更新
2. 実際の作業時間を記録
3. AI分析による次回計画の改善

### 🎯 **AI機能の詳細な使い方**

#### **週間計画生成**
```
入力: プロジェクト選択、計画期間、利用可能時間
出力: 
- 週間タスク計画（日別割り当て）
- 推奨作業順序
- 潜在的な問題点の指摘
- 計画達成のためのアドバイス
```

#### **ワークロード分析**
```
入力: 分析対象プロジェクト・期間
出力:
- プロジェクト別時間配分
- 締切プレッシャー分析
- 負荷バランス評価
- 改善提案
```

#### **優先度提案**
```
入力: タスクリスト
出力:
- AI分析による優先度ランキング
- 各タスクの重要度理由
- 依存関係の考慮
- 最適実行順序の提案
```

### ⚡ **OR-Toolsスケジューリング**

#### **時間スロット設定**
- **集中作業**: プログラミング・分析・執筆
- **軽作業**: メール・資料整理・会議準備
- **学習**: 論文読み・技術習得・調査

#### **制約条件**
- タスク実行時間 = 見積時間
- スロット種別とタスク種別のマッチング
- 同一時間帯の重複禁止
- 締切制約（ソフト制約）

## 🔌 API リファレンス

### プロジェクト管理API
```bash
GET    /api/projects/              # プロジェクト一覧
POST   /api/projects/              # プロジェクト作成
GET    /api/projects/{id}          # プロジェクト詳細
PUT    /api/projects/{id}          # プロジェクト更新
DELETE /api/projects/{id}          # プロジェクト削除
```

### ゴール管理API
```bash
GET    /api/goals/project/{project_id}  # プロジェクトのゴール一覧
POST   /api/goals/                      # ゴール作成
PUT    /api/goals/{id}                  # ゴール更新
DELETE /api/goals/{id}                  # ゴール削除
```

### タスク管理API
```bash
GET    /api/tasks/goal/{goal_id}        # ゴールのタスク一覧
GET    /api/tasks/project/{project_id}  # プロジェクトの全タスク
POST   /api/tasks/                      # タスク作成
PUT    /api/tasks/{id}                  # タスク更新
DELETE /api/tasks/{id}                  # タスク削除
```

### AI機能API
```bash
POST   /api/ai/weekly-plan              # AI週間計画生成
POST   /api/ai/analyze-workload         # ワークロード分析
POST   /api/ai/suggest-priorities       # タスク優先度提案
GET    /api/ai/weekly-plan/test         # AI統合テスト
```

### スケジューリングAPI
```bash
POST   /api/schedule/daily              # 日次スケジュール最適化
GET    /api/schedule/test               # スケジューラテスト
```

## 💰 料金・制限事項

### OpenAI API使用料金
- **GPT-4 Turbo**: $0.01/1K input tokens, $0.03/1K output tokens
- **週間計画生成**: 約$0.05-0.10/回（推定）
- **月額目安**: $10-50（中規模使用時）

### Supabase無料枠
- **データベース**: 500MB
- **認証**: 50,000 monthly active users
- **API リクエスト**: unlimited
- 無料枠超過時の従量課金あり

### 制限事項
- **OpenAI API キー未設定**: AI機能は無効化、エラーメッセージ表示
- **Supabase接続失敗**: 認証・データ永続化不可、ローカルのみ動作
- **OR-Tools最適化**: 30秒タイムアウト、大量タスク時は部分最適化

## 🛠️ 開発・カスタマイズ

### プロジェクト構造
```
TaskAgent/
├── apps/
│   ├── web/                    # Next.js フロントエンド
│   │   ├── src/app/           # App Router ページ
│   │   ├── src/components/    # React コンポーネント
│   │   ├── src/hooks/         # カスタムフック
│   │   └── src/lib/           # ユーティリティ・API
│   └── api/                   # FastAPI バックエンド
│       ├── routers/           # API エンドポイント
│       ├── models.py          # データモデル
│       ├── services.py        # ビジネスロジック
│       └── ai_service.py      # AI統合サービス
├── packages/
│   └── scheduler/             # OR-Tools パッケージ
└── supabase/
    └── migrations/            # データベーススキーマ
```

### テスト実行
```bash
# API テスト
cd apps/api
pytest tests/ -v

# フロントエンドテスト
cd apps/web
npm run test
```

### リンター・フォーマッター
```bash
# Python (API)
cd apps/api
ruff check .
ruff format .

# TypeScript (Web)
cd apps/web
npm run lint
npm run type-check
```

## 🚀 デプロイ

### Vercel (フロントエンド)
```bash
cd apps/web
vercel --prod
```

### Fly.io (API)
```bash
cd apps/api
fly deploy
```

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'feat: add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 🆘 トラブルシューティング

### よくある問題

**ポート競合エラー**
```bash
# 別ポートで起動
npm run dev -- -p 3001
```

**Python依存関係エラー**
```bash
# 仮想環境作成
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

**Supabase接続エラー**
```bash
# ローカル起動
supabase start

# 環境変数確認
echo $NEXT_PUBLIC_SUPABASE_URL
```

**OpenAI API エラー**
```bash
# キー確認
echo $OPENAI_API_KEY

# 残高確認: OpenAI Platform → Usage
```

## 📧 サポート・お問い合わせ

- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Documentation**: このREADME + コード内コメント

---

**TaskAgent** で効率的なプロジェクト管理を始めましょう！ 🚀