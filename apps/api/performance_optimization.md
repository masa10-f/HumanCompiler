# データベースパフォーマンス最適化提案

## 推奨インデックス

以下のインデックスを追加することで、作業時間ログと進捗計算のパフォーマンスが大幅に向上します：

### 1. Logsテーブルのインデックス

```sql
-- task_idによるログ検索を高速化（進捗計算で頻繁に使用）
CREATE INDEX IF NOT EXISTS idx_logs_task_id ON logs(task_id);

-- 時系列分析用のインデックス
CREATE INDEX IF NOT EXISTS idx_logs_task_id_created_at ON logs(task_id, created_at);

-- ユーザー単位でのログ分析用（将来的な機能拡張のため）
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
```

### 2. Tasksテーブルのインデックス

```sql
-- goal_idによるタスク検索を高速化（進捗計算で使用）
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);

-- ステータス別タスク検索を高速化
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
```

### 3. Goalsテーブルのインデックス

```sql
-- project_idによるゴール検索を高速化
CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id);
```

## 実装方法

### Supabaseの場合
Supabaseコンソールの「SQL Editor」でこれらのCREATE INDEX文を実行してください。

### その他のPostgreSQLの場合
```bash
# psqlコマンドラインから実行
psql -h your-host -d your-database -U your-user -f performance_optimization.sql
```

## 期待される効果

- **進捗計算API**: レスポンス時間50-80%改善
- **大量ログデータでの集計**: クエリ時間90%以上短縮
- **複数プロジェクト同時表示**: ページロード時間大幅改善

## 監視推奨項目

```sql
-- クエリパフォーマンスの監視
EXPLAIN (ANALYZE, BUFFERS)
SELECT task_id, SUM(actual_minutes)
FROM logs
WHERE task_id IN ('task-uuid-1', 'task-uuid-2')
GROUP BY task_id;
```

このクエリの実行時間が10ms以下になることを確認してください。
