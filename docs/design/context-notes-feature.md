# コンテキストノート機能 設計計画

## 概要

各プロジェクト・ゴール・タスクに対して、Notionのような操作感でリッチなコンテキスト情報を記録できるノート機能を追加する。

## 現状分析

### 既存の実装
- **タスクメモ**: プレーンテキスト、最大2000文字
- **KPT**: セッション単位、各項目500文字まで
- **Markdownレンダリング**: 未実装（ライブラリなし）
- **リッチテキストエディタ**: 未実装

### 既存のページ構造
```
/projects                           → プロジェクト一覧
/projects/[id]                      → プロジェクト詳細（ゴール一覧含む）
/projects/[id]/goals/[goalId]       → ゴール詳細（タスク一覧含む）
```

---

## 設計方針

### 1. Notionライクな体験の実現

**選択肢の比較:**

| ライブラリ | 特徴 | 長所 | 短所 |
|-----------|------|------|------|
| **Novel** | Notionクローン | 最もNotion的なUI、画像D&D対応 | バンドルサイズ大、依存多 |
| **Tiptap** | ProseMirrorベース | 柔軟、拡張性高 | 設定複雑 |
| **react-markdown + SimpleMDE** | Markdownプレビュー型 | 軽量、シンプル | Notionとは異なるUX |

**推奨**: **Tiptap** を採用
- Markdownインポート/エクスポート対応
- 画像・動画埋め込み拡張可能
- ブロックベースのNotion風UI構築可能
- バンドルサイズのバランスが良い

### 2. データモデル設計

#### 2.1 新規テーブル: `context_notes`

```sql
CREATE TABLE context_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 対象エンティティ（いずれか1つがセット）
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,

    -- コンテンツ
    content TEXT NOT NULL DEFAULT '',           -- Markdown/HTML形式
    content_type VARCHAR(20) DEFAULT 'markdown', -- 'markdown' | 'html' | 'tiptap_json'

    -- メタデータ
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- 制約: 1つのエンティティに対して1つのノート
    CONSTRAINT unique_project_note UNIQUE (project_id),
    CONSTRAINT unique_goal_note UNIQUE (goal_id),
    CONSTRAINT unique_task_note UNIQUE (task_id),

    -- 少なくとも1つのエンティティIDが必要
    CONSTRAINT at_least_one_entity CHECK (
        (project_id IS NOT NULL)::int +
        (goal_id IS NOT NULL)::int +
        (task_id IS NOT NULL)::int = 1
    )
);
```

#### 2.2 新規テーブル: `note_attachments`（画像・ファイル用）

```sql
CREATE TABLE note_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID REFERENCES context_notes(id) ON DELETE CASCADE,

    -- ファイル情報
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,  -- MIME type
    file_size INTEGER NOT NULL,
    storage_path VARCHAR(500) NOT NULL,  -- Supabase Storage path

    -- メタデータ
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 2.3 Pythonモデル（SQLModel）

```python
class ContextNote(SQLModel, table=True):
    __tablename__ = "context_notes"

    id: UUID | None = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID | None = Field(default=None, foreign_key="projects.id")
    goal_id: UUID | None = Field(default=None, foreign_key="goals.id")
    task_id: UUID | None = Field(default=None, foreign_key="tasks.id")
    content: str = Field(default="")
    content_type: str = Field(default="markdown", max_length=20)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class NoteAttachment(SQLModel, table=True):
    __tablename__ = "note_attachments"

    id: UUID | None = Field(default_factory=uuid4, primary_key=True)
    note_id: UUID = Field(foreign_key="context_notes.id")
    filename: str = Field(max_length=255)
    content_type: str = Field(max_length=100)
    file_size: int
    storage_path: str = Field(max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

### 3. API設計

#### 3.1 ノートエンドポイント

```
# プロジェクトノート
GET    /api/projects/{id}/notes          → ノート取得
PUT    /api/projects/{id}/notes          → ノート更新（なければ作成）

# ゴールノート
GET    /api/goals/{id}/notes             → ノート取得
PUT    /api/goals/{id}/notes             → ノート更新

# タスクノート
GET    /api/tasks/{id}/notes             → ノート取得
PUT    /api/tasks/{id}/notes             → ノート更新
```

#### 3.2 添付ファイルエンドポイント

```
POST   /api/notes/{note_id}/attachments  → ファイルアップロード
DELETE /api/notes/{note_id}/attachments/{attachment_id}  → ファイル削除
GET    /api/notes/{note_id}/attachments  → 添付一覧取得
```

### 4. フロントエンド設計

#### 4.1 新規ページ

```
/projects/[id]/notes                           → プロジェクトノートページ
/projects/[id]/goals/[goalId]/notes            → ゴールノートページ
/projects/[id]/goals/[goalId]/tasks/[taskId]   → タスク詳細ページ（ノート統合）
```

#### 4.2 コンポーネント構成

```
src/components/notes/
├── context-note-editor.tsx      # Tiptapエディタラッパー
├── note-toolbar.tsx             # 書式設定ツールバー
├── note-viewer.tsx              # 読み取り専用表示
├── image-upload-dialog.tsx      # 画像アップロードダイアログ
├── embed-dialog.tsx             # URL埋め込みダイアログ
├── note-page-layout.tsx         # ノートページ共通レイアウト
└── index.ts
```

#### 4.3 エディタ機能

**基本機能（Phase 1）:**
- 見出し（H1, H2, H3）
- 太字・斜体・取り消し線
- 箇条書き・番号付きリスト
- チェックボックスリスト
- 引用ブロック
- コードブロック（シンタックスハイライト）
- 水平線
- リンク

**メディア機能（Phase 2）:**
- 画像アップロード（D&D対応）
- 画像リサイズ
- 画像キャプション

**拡張機能（Phase 3）:**
- YouTube埋め込み
- ウェブページプレビュー（OGP）
- テーブル
- 数式（KaTeX）

### 5. UI/UX設計

#### 5.1 ノートページレイアウト

```
┌──────────────────────────────────────────────────┐
│ [← 戻る]  プロジェクト名 / ゴール名              │
├──────────────────────────────────────────────────┤
│                                                  │
│  # ノートタイトル（自動: エンティティ名）        │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ [B] [I] [H1] [H2] [•] [1.] [✓] [</>] [🔗] │   │
│  ├──────────────────────────────────────────┤   │
│  │                                          │   │
│  │  ノート本文...                           │   │
│  │                                          │   │
│  │  画像をドラッグ&ドロップ                 │   │
│  │  または貼り付け                          │   │
│  │                                          │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  最終更新: 2026-01-28 10:30                      │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### 5.2 一覧ページからのアクセス

**プロジェクト詳細ページ:**
```
┌─────────────────────────────────────┐
│ プロジェクト名                      │
│ 説明文...                          │
│                                    │
│ [📝 ノートを編集]  ← 新規ボタン    │
└─────────────────────────────────────┘
```

**ゴール一覧:**
```
┌─────────────────────────────────────┐
│ ゴール名           [📝] [編集] [...] │
│ 説明...                             │
└─────────────────────────────────────┘
       ↑ ノートアイコン（クリックでノートページへ）
```

**タスク一覧:**
```
│ タスク名 │ ... │ [詳細ページへ →] │
```
タスク名クリックでタスク詳細ページ（ノート含む）へ遷移

#### 5.3 タスク詳細ページ

```
┌──────────────────────────────────────────────────┐
│ [← ゴールに戻る]                                 │
├──────────────────────────────────────────────────┤
│ タスク名                           [ステータス]  │
│ 見積: 2h | 実績: 1.5h | 締切: 2026-02-01        │
├──────────────────────────────────────────────────┤
│ [ノート] [ログ] [セッション履歴]   ← タブ切替    │
├──────────────────────────────────────────────────┤
│                                                  │
│  ノートエディタ                                  │
│  ...                                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 6. 画像ストレージ設計

#### 6.1 Supabase Storage構成

```
storage/
└── note-attachments/
    └── {user_id}/
        └── {note_id}/
            └── {uuid}_{filename}
```

#### 6.2 アップロードフロー

```
1. フロントエンド: 画像選択/D&D
2. APIコール: POST /api/notes/{note_id}/attachments
3. バックエンド:
   - ファイルバリデーション（サイズ、形式）
   - Supabase Storageにアップロード
   - note_attachmentsテーブルに記録
   - 公開URLを返却
4. フロントエンド: エディタに画像挿入
```

#### 6.3 制限

- 最大ファイルサイズ: 5MB/画像
- 対応形式: JPEG, PNG, GIF, WebP
- ノートあたり最大: 20枚

---

## 実装フェーズ

### Phase 1: 基盤構築（MVP）
**期間目安: 中規模**

1. データベースマイグレーション
   - context_notesテーブル作成
   - note_attachmentsテーブル作成

2. バックエンドAPI
   - ノートCRUD API
   - 添付ファイルアップロードAPI

3. フロントエンド
   - Tiptapエディタ導入
   - 基本的なテキスト編集機能
   - プロジェクト/ゴール/タスクのノートページ

4. ナビゲーション
   - 各一覧ページからノートへのリンク
   - タスク詳細ページ新設

### Phase 2: 画像・メディア対応
**期間目安: 小〜中規模**

1. Supabase Storage設定
2. 画像アップロード機能
3. D&D対応
4. 画像リサイズ

### Phase 3: 拡張埋め込み
**期間目安: 小規模**

1. YouTube埋め込み
2. URLプレビュー（OGP）
3. コードブロックハイライト

### Phase 4: 高度な機能（オプション）
**期間目安: 中規模**

1. テーブルエディタ
2. 数式サポート（KaTeX）
3. ファイル添付（PDF等）
4. ノート検索機能

---

## 技術スタック追加

### 新規パッケージ（フロントエンド）

```json
{
  "@tiptap/react": "^2.x",
  "@tiptap/starter-kit": "^2.x",
  "@tiptap/extension-image": "^2.x",
  "@tiptap/extension-link": "^2.x",
  "@tiptap/extension-placeholder": "^2.x",
  "@tiptap/extension-code-block-lowlight": "^2.x",
  "@tiptap/extension-task-list": "^2.x",
  "@tiptap/extension-task-item": "^2.x",
  "@tiptap/extension-youtube": "^2.x",
  "lowlight": "^3.x"
}
```

### バックエンド依存関係

既存のFastAPI + SQLModel構成で対応可能。
Supabase Storageとの連携に`supabase-py`を使用（既存）。

---

## セキュリティ考慮

1. **XSS対策**
   - Tiptapのサニタイズ機能活用
   - サーバーサイドでも追加サニタイズ
   - Content-Security-Policy設定

2. **ファイルアップロード**
   - MIMEタイプ検証
   - ファイルサイズ制限
   - 画像マジックナンバー検証

3. **アクセス制御**
   - ノートは所有者のみ編集可能
   - 添付ファイルへのアクセスは認証必須

---

## マイグレーション戦略

既存の`memo`フィールドからの移行:

1. `context_notes`テーブル作成
2. 既存の`task.memo`は**維持**（簡易メモ用途）
3. 新規ノートは独立した詳細ページで管理
4. 将来的に`memo`をノートに統合するかは運用後判断

---

## 次のステップ

1. この設計についてレビュー・フィードバックをいただく
2. Phase 1の詳細タスク分解
3. 実装開始

---

*作成日: 2026-01-28*
