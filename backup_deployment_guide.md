# TaskAgent データベースバックアップシステム - 導入ガイド

## 概要

TaskAgentプロジェクト用の包括的なデータベースバックアップソリューションです。このシステムは、過去のデータ消失事故を防ぐために設計された自動バックアップ・リストア機能を提供します。

## 主要機能

### 🔄 自動スケジューリング
- **間隔バックアップ**: 設定可能な時間間隔（デフォルト: 6時間毎）
- **日次バックアップ**: 毎日指定時刻（デフォルト: 午前2時）
- **週次バックアップ**: 毎週指定曜日（デフォルト: 月曜日）
- **月次バックアップ**: 毎月1日
- **自動クリーンアップ**: 保持ポリシーに基づく古いバックアップの削除

### 📦 バックアップ機能
- **完全データバックアップ**: users, projects, goals, tasks全テーブル
- **JSON形式**: 可読性とポータビリティ
- **メタデータ付き**: タイムスタンプ、サイズ、レコード数
- **圧縮サポート**: オプションで有効化可能
- **ファイルサイズ監視**: 異常に大きなバックアップの検出

### 🔄 リストア機能
- **完全復旧**: バックアップファイルからの完全なデータ復旧
- **安全な削除**: 外部キー制約を考慮した順序での削除
- **エラーハンドリング**: 復旧エラーの詳細ログ

### 📊 監視・アラート
- **ヘルスチェック**: システム状態の定期監視
- **失敗アラート**: バックアップ失敗時の通知
- **サイズアラート**: 大容量バックアップ時の警告
- **メール通知**: SMTP経由での自動アラート送信
- **ディスク使用量監視**: バックアップディレクトリの容量チェック

### 🌐 REST API
- **バックアップ作成**: `/api/backup/create`
- **履歴表示**: `/api/backup/history`
- **システム状態**: `/api/backup/status`
- **復旧実行**: `/api/backup/restore`
- **スケジューラ制御**: `/api/backup/scheduler/start|stop`
- **設定管理**: `/api/backup/scheduler/configure`

## インストール手順

### 1. 依存関係のインストール

```bash
cd apps/api
source ../../.venv/bin/activate
pip install apscheduler>=3.10.0
```

### 2. 設定ファイルの準備

環境変数またはコードで設定を調整：

```python
from taskagent_api.backup_scheduler import BackupConfig

config = BackupConfig(
    backup_interval_hours=6,        # 6時間毎のバックアップ
    daily_backup_time="02:00",      # 午前2時の日次バックアップ
    weekly_backup_day=0,            # 月曜日の週次バックアップ
    keep_hourly_backups=24,         # 24時間分のバックアップ保持
    keep_daily_backups=30,          # 30日分のバックアップ保持
    keep_weekly_backups=12,         # 12週分のバックアップ保持
    keep_monthly_backups=12,        # 12ヶ月分のバックアップ保持
    max_backup_size_mb=500,         # 500MB超過時のアラート
    alert_on_failure=True,          # 失敗時アラート有効
    email_alerts_enabled=False,     # メールアラート設定
    # メール設定（必要に応じて）
    email_recipients=["admin@example.com"],
    smtp_server="smtp.gmail.com",
    smtp_port=587,
    smtp_username="backup@example.com",
    smtp_password="your_password"
)
```

### 3. ファイアウォール・セキュリティ設定

バックアップディレクトリのアクセス権限設定：

```bash
mkdir -p backups
chmod 750 backups
chown api_user:api_group backups
```

### 4. API統合の確認

FastAPIアプリが正しくバックアップルートを含んでいることを確認：

```python
# main.pyで確認
from taskagent_api.routes import backup
app.include_router(backup.router)
```

## 使用方法

### 自動バックアップの開始

サーバー起動時に自動的に開始されますが、手動でも制御可能：

```bash
# APIエンドポイント経由
curl -X POST http://localhost:8000/api/backup/scheduler/start \
  -H "Authorization: Bearer your_token"
```

### 手動バックアップの作成

```bash
curl -X POST http://localhost:8000/api/backup/create \
  -H "Authorization: Bearer your_token" \
  -d '{"backup_type": "manual"}'
```

### バックアップ履歴の確認

```bash
curl http://localhost:8000/api/backup/history \
  -H "Authorization: Bearer your_token"
```

### システム状態の確認

```bash
curl http://localhost:8000/api/backup/status \
  -H "Authorization: Bearer your_token"
```

### データの復旧

```bash
curl -X POST http://localhost:8000/api/backup/restore \
  -H "Authorization: Bearer your_token" \
  -d '{"backup_filename": "manual_backup_20250815_034500.json"}'
```

## ローカルサーバーでの定期実行設定

### systemdサービス（推奨）

```bash
# /etc/systemd/system/taskagent-backup.service
[Unit]
Description=TaskAgent Backup Service
After=network.target

[Service]
Type=exec
User=api_user
WorkingDirectory=/path/to/TaskAgent/apps/api
Environment=PYTHONPATH=/path/to/TaskAgent/apps/api/src
ExecStart=/path/to/.venv/bin/python -c "
from taskagent_api.backup_scheduler import init_backup_scheduler
import asyncio
import signal
import sys

scheduler = init_backup_scheduler()

def signal_handler(signum, frame):
    scheduler.stop()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

try:
    asyncio.get_event_loop().run_forever()
except KeyboardInterrupt:
    pass
finally:
    scheduler.stop()
"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# サービス有効化
sudo systemctl enable taskagent-backup.service
sudo systemctl start taskagent-backup.service
sudo systemctl status taskagent-backup.service
```

### cronジョブ（代替案）

```bash
# crontabに追加
# 6時間毎の手動バックアップ
0 */6 * * * cd /path/to/TaskAgent/apps/api && /path/to/.venv/bin/python -c "
import asyncio
from taskagent_api.backup_scheduler import create_manual_backup
asyncio.run(create_manual_backup())
"

# 日次バックアップ（午前2時）
0 2 * * * cd /path/to/TaskAgent/apps/api && /path/to/.venv/bin/python -c "
import asyncio
from taskagent_api.backup_scheduler import create_manual_backup
asyncio.run(create_manual_backup())
"
```

## 監視・アラート設定

### ログ監視

```bash
# バックアップログの監視
tail -f /var/log/taskagent-backup.log

# 特定パターンの監視
grep -i "backup.*failed\|error\|❌" /var/log/taskagent-backup.log
```

### Slack/Discord通知（オプション）

```python
# backup_scheduler.pyのカスタマイズ例
async def _send_slack_alert(self, message: str):
    import httpx
    webhook_url = "https://hooks.slack.com/services/..."
    async with httpx.AsyncClient() as client:
        await client.post(webhook_url, json={"text": message})
```

## トラブルシューティング

### 一般的な問題

1. **スケジューラが開始しない**
   ```bash
   # ログ確認
   grep "backup.*scheduler" /var/log/taskagent.log
   
   # 手動テスト
   python -c "
   from taskagent_api.backup_scheduler import get_backup_scheduler
   scheduler = get_backup_scheduler()
   print(f'Running: {scheduler.is_running}')
   "
   ```

2. **バックアップファイルが作成されない**
   ```bash
   # ディレクトリ権限確認
   ls -la backups/
   
   # 手動バックアップテスト
   python -c "
   import asyncio
   from taskagent_api.backup_scheduler import create_manual_backup
   asyncio.run(create_manual_backup())
   "
   ```

3. **ディスク容量不足**
   ```bash
   # 容量確認
   df -h backups/
   
   # 古いバックアップクリーンアップ
   curl -X POST http://localhost:8000/api/backup/cleanup \
     -H "Authorization: Bearer your_token"
   ```

### ログレベル調整

```python
# より詳細なログが必要な場合
import logging
logging.getLogger("taskagent_api.backup_scheduler").setLevel(logging.DEBUG)
```

## セキュリティ考慮事項

1. **バックアップファイルの暗号化**
   - プロダクション環境では暗号化を検討
   - GPGまたはAES暗号化の実装

2. **アクセス制限**
   - バックアップディレクトリへの適切な権限設定
   - APIエンドポイントの認証確認

3. **オフサイトバックアップ**
   - AWS S3、Google Cloud Storage等への自動アップロード
   - 地理的に分散したバックアップ保存

## パフォーマンス最適化

1. **バックアップ圧縮**
   ```python
   config = BackupConfig(compression_enabled=True)
   ```

2. **バックアップタイミング調整**
   - ピーク時間外でのスケジューリング
   - データベース負荷を考慮した間隔設定

3. **増分バックアップ（今後の機能）**
   - 変更されたデータのみのバックアップ
   - タイムスタンプベースの差分取得

## 今後の拡張計画

1. **クラウドストレージ統合**
   - AWS S3、Google Cloud Storage、Dropbox対応
   - 自動アップロード機能

2. **増分バックアップ**
   - 完全バックアップと増分バックアップの組み合わせ
   - ストレージ効率の向上

3. **バックアップ検証**
   - バックアップファイルの整合性チェック
   - 自動復旧テスト

4. **ウェブダッシュボード**
   - バックアップ状況の可視化
   - リアルタイムモニタリング

## サポート・メンテナンス

定期的なメンテナンス作業：

1. **月次レビュー**
   - バックアップログの確認
   - ディスク使用量の監視
   - 失敗ケースの分析

2. **四半期チェック**
   - 復旧テストの実行
   - 設定の見直し
   - パフォーマンス評価

3. **年次アップデート**
   - 保持ポリシーの調整
   - ストレージ戦略の見直し
   - セキュリティ要件の更新

このバックアップシステムにより、TaskAgentのデータ安全性が大幅に向上し、過去のような データ消失事故を防ぐことができます。