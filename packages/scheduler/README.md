# Task Scheduler Package

OR-Tools CP-SAT ソルバーを使用したタスクスケジューリングパッケージです。

## 概要

このパッケージは、以下の機能を提供します：

- **制約充足問題 (CSP) によるタスク割り当て最適化**
- **時間スロット管理とリソース制約**
- **優先度・締切・作業時間帯の考慮**
- **REST API用のラッパー関数**

## 主要機能

### 1. スケジューラーコア (`scheduler/core.py`)
- OR-Tools CP-SAT ソルバーの制約定義
- タスク割り当て最適化アルゴリズム
- 目的関数の設定（遅延ペナルティ、プリファレンス違反）

### 2. データモデル (`scheduler/models.py`)
- タスク、時間スロット、スケジュール結果のPydanticモデル
- 入力バリデーションとシリアライゼーション

### 3. API ラッパー (`scheduler/api.py`)
- FastAPI統合用の関数
- JSON入出力とエラーハンドリング

## 使用例

```python
from scheduler import optimize_schedule
from scheduler.models import Task, TimeSlot

# タスク定義
tasks = [
    Task(id="task1", title="研究", estimate_hours=3.0, priority=1),
    Task(id="task2", title="実装", estimate_hours=2.0, priority=2),
]

# 時間スロット定義
slots = [
    TimeSlot(start="09:00", end="12:00", kind="deep"),
    TimeSlot(start="13:00", end="17:00", kind="light"),
]

# スケジュール最適化
result = optimize_schedule(tasks, slots, date="2025-06-23")
print(result)
```

## 制約条件

1. **タスク完了制約**: 各タスクの必要時間が満たされること
2. **スロット容量制約**: 同一時間スロット内で重複しないこと  
3. **締切制約**: 期限内にタスクが完了すること（ソフト制約）
4. **作業時間帯制約**: タスクの種類と時間スロットの適合性（ソフト制約）

## インストール

```bash
cd packages/scheduler
pip install -e .
```

## 開発

```bash
pip install -e ".[dev]"
pytest
black .
mypy .
```