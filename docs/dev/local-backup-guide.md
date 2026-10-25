# HumanCompiler ローカルバックアップガイド

## 📋 概要

HumanCompilerのローカルサーバー向け軽量バックアップシステムです。
Supabase Free プランの制限に影響されず、シンプルで信頼性の高いバックアップを実現します。

## 🎯 特徴

- **軽量設計**: 100行未満のシンプルなコード
- **自動クリーンアップ**: 古いバックアップの自動削除
- **cron連携**: 標準的なLinux cron での定期実行
- **JSON形式**: 可読性が高く、復旧が簡単

## 📁 ファイル構成

```
HumanCompiler/apps/api/
├── src/humancompiler_api/
│   ├── simple_backup.py       # 軽量バックアップシステム
│   └── safe_migration.py      # 緊急時バックアップ機能
├── migrate.py                 # マイグレーション管理
└── backups/                   # バックアップファイル保存先
    ├── daily_backup_YYYYMMDD_HHMMSS.json
    └── weekly_backup_YYYYMMDD_HHMMSS.json
```

## 🚀 セットアップ

### 1. バックアップディレクトリの準備

```bash
cd /home/masato/projects/humancompiler/HumanCompiler/apps/api
mkdir -p backups
chmod 750 backups
```

### 2. 手動バックアップのテスト

```bash
# 仮想環境をアクティベート
source ../../.venv/bin/activate

# 手動バックアップの実行
PYTHONPATH=src python -c "
from humancompiler_api.simple_backup import create_manual_backup
backup_path = create_manual_backup()
print(f'バックアップ作成: {backup_path}')
"
```

### 3. cron設定（定期バックアップ）

```bash
# crontabを編集
crontab -e

# 以下の行を追加
# 日次バックアップ（毎日午前2時）
0 2 * * * cd /home/masato/projects/humancompiler/HumanCompiler/apps/api && source ../../.venv/bin/activate && PYTHONPATH=src python -c "from humancompiler_api.simple_backup import create_manual_backup; create_manual_backup()" >> /var/log/humancompiler-backup.log 2>&1

# 週次バックアップ（毎週月曜日午前1時）
0 1 * * 1 cd /home/masato/projects/humancompiler/HumanCompiler/apps/api && source ../../.venv/bin/activate && PYTHONPATH=src python -c "from humancompiler_api.simple_backup import get_backup_scheduler; get_backup_scheduler().create_weekly_backup()" >> /var/log/humancompiler-backup.log 2>&1
```

## 📝 使用方法

### 手動バックアップ

#### 即座にバックアップを作成
```bash
cd /home/masato/projects/humancompiler/HumanCompiler/apps/api
source ../../.venv/bin/activate
PYTHONPATH=src python src/humancompiler_api/simple_backup.py
```

#### Pythonコードから実行
```python
from humancompiler_api.simple_backup import get_backup_scheduler

# バックアップスケジューラーを取得
scheduler = get_backup_scheduler()

# 日次バックアップ作成
daily_backup = scheduler.create_daily_backup()
print(f"日次バックアップ: {daily_backup}")

# 週次バックアップ作成
weekly_backup = scheduler.create_weekly_backup()
print(f"週次バックアップ: {weekly_backup}")
```

### バックアップファイルの確認

```bash
# バックアップ一覧表示
ls -la backups/

# 最新のバックアップ表示
ls -t backups/*.json | head -1

# バックアップファイルの内容確認（JSONビューアー使用）
jq . backups/daily_backup_20250815_120000.json | head -20
```

## 🔄 復旧方法

### 1. 緊急時の完全復旧

```bash
cd /home/masato/projects/humancompiler/HumanCompiler/apps/api
source ../../.venv/bin/activate

# バックアップファイルから復旧
PYTHONPATH=src python -c "
from humancompiler_api.safe_migration import DataBackupManager
manager = DataBackupManager()
manager.restore_backup('backups/daily_backup_20250815_120000.json')
print('復旧完了')
"
```

### 2. 特定のテーブルのみ復旧

```python
import json
from sqlmodel import Session
from humancompiler_api.database import db
from humancompiler_api.models import User, Project, Goal, Task

# バックアップファイル読み込み
with open('backups/daily_backup_20250815_120000.json') as f:
    backup_data = json.load(f)

engine = db.get_engine()
with Session(engine) as session:
    # 例: ユーザーデータのみ復旧
    for user_data in backup_data['users']:
        user = User(**user_data)
        session.add(user)
    session.commit()
```

## 📊 監視・メンテナンス

### ログの確認

```bash
# バックアップログの確認
tail -f /var/log/humancompiler-backup.log

# エラーのチェック
grep -i "error\|failed\|❌" /var/log/humancompiler-backup.log

# 成功したバックアップの確認
grep -i "backup created\|✅" /var/log/humancompiler-backup.log
```

### ディスク使用量の監視

```bash
# バックアップディレクトリのサイズ確認
du -sh backups/

# ファイル数の確認
ls backups/*.json | wc -l

# 古いファイルの手動削除（必要に応じて）
find backups/ -name "*.json" -mtime +30 -delete
```

## ⚙️ 設定のカスタマイズ

### 保持期間の変更

`simple_backup.py`の設定を編集：

```python
# 日次バックアップの保持期間（デフォルト: 7日）
self._cleanup_old_backups(days=14)  # 14日に変更

# 週次バックアップの保持期間（デフォルト: 28日）
self._cleanup_old_backups(prefix="weekly_backup_", days=56)  # 8週に変更
```

### バックアップ対象テーブルの変更

`safe_migration.py`の`DataBackupManager.create_backup()`を編集：

```python
# 追加のテーブルをバックアップに含める場合
schedules = session.exec(select(Schedule)).all()
backup_data["schedules"] = [schedule.model_dump() for schedule in schedules]
```

## 🛠️ トラブルシューティング

### よくある問題と解決方法

#### 1. 権限エラー
```bash
# バックアップディレクトリの権限確認・修正
chmod 755 backups/
chown $USER:$USER backups/
```

#### 2. データベース接続エラー
```bash
# DATABASE_URL環境変数の確認
echo $DATABASE_URL

# データベース接続テスト
PYTHONPATH=src python -c "
from humancompiler_api.database import db
import asyncio
result = asyncio.run(db.health_check())
print(f'DB Health: {result}')
"
```

#### 3. 仮想環境の問題
```bash
# 仮想環境の再作成
cd /home/masato/projects/humancompiler/HumanCompiler
rm -rf .venv
python -m venv .venv
source .venv/bin/activate
uv sync --locked --active --project apps/api
```

#### 4. cronが実行されない
```bash
# cronサービスの状態確認
sudo systemctl status cron

# cronログの確認
grep -i humancompiler /var/log/syslog

# 手動実行でのテスト
cd /home/masato/projects/humancompiler/HumanCompiler/apps/api && source ../../.venv/bin/activate && PYTHONPATH=src python -c "from humancompiler_api.simple_backup import create_manual_backup; create_manual_backup()"
```

## 📈 アップグレード時の注意

### Git pullした後の手順

```bash
# 依存関係の更新
cd /home/masato/projects/humancompiler/HumanCompiler/apps/api
source ../../.venv/bin/activate
uv sync --locked --active

# マイグレーション実行
python migrate.py status
python migrate.py apply

# バックアップ機能のテスト
PYTHONPATH=src python -c "from humancompiler_api.simple_backup import create_manual_backup; print('Test OK')"
```

## 🔒 セキュリティ考慮事項

### バックアップファイルの保護

```bash
# バックアップファイルのアクセス権限制限
chmod 600 backups/*.json

# 機密データの暗号化（オプション）
gpg --symmetric --cipher-algo AES256 backups/sensitive_backup.json
```

### 定期的なセキュリティチェック

```bash
# バックアップファイルの整合性確認
PYTHONPATH=src python -c "
import json
with open('backups/latest_backup.json') as f:
    data = json.load(f)
    print(f'Users: {len(data.get(\"users\", []))}')
    print(f'Projects: {len(data.get(\"projects\", []))}')
    print(f'Goals: {len(data.get(\"goals\", []))}')
    print(f'Tasks: {len(data.get(\"tasks\", []))}')
"
```

## 📞 サポート

問題が発生した場合：

1. **ログの確認**: `/var/log/humancompiler-backup.log`
2. **手動実行テスト**: 上記の手動バックアップコマンドを実行
3. **データベース接続確認**: ヘルスチェックを実行
4. **権限確認**: ファイル・ディレクトリの権限をチェック

このシンプルなバックアップシステムにより、HumanCompilerのデータを安全に保護できます。
