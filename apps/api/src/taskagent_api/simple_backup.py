#!/usr/bin/env python3
"""
Simple Local Backup System for TaskAgent
ローカルサーバー向けの軽量バックアップシステム
"""

import logging
import json
from datetime import datetime, UTC
from pathlib import Path

from taskagent_api.safe_migration import DataBackupManager

logger = logging.getLogger(__name__)


class SimpleBackupScheduler:
    """シンプルなローカルバックアップスケジューラー"""

    def __init__(self, backup_dir: str = "backups"):
        self.backup_manager = DataBackupManager(backup_dir)
        self.backup_dir = Path(backup_dir)

    def create_daily_backup(self) -> str:
        """日次バックアップ作成"""
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        backup_name = f"daily_backup_{timestamp}"

        try:
            backup_path = self.backup_manager.create_backup(backup_name)
            logger.info(f"✅ Daily backup created: {backup_path}")

            # 古いバックアップをクリーンアップ（7日以上前）
            self._cleanup_old_backups(days=7)

            return backup_path

        except Exception as e:
            logger.error(f"❌ Daily backup failed: {e}")
            raise

    def create_weekly_backup(self) -> str:
        """週次バックアップ作成"""
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        backup_name = f"weekly_backup_{timestamp}"

        try:
            backup_path = self.backup_manager.create_backup(backup_name)
            logger.info(f"✅ Weekly backup created: {backup_path}")

            # 古い週次バックアップをクリーンアップ（4週以上前）
            self._cleanup_old_backups(prefix="weekly_backup_", days=28)

            return backup_path

        except Exception as e:
            logger.error(f"❌ Weekly backup failed: {e}")
            raise

    def _cleanup_old_backups(self, days: int = 7, prefix: str = ""):
        """古いバックアップファイルを削除"""
        if not self.backup_dir.exists():
            return

        cutoff_date = datetime.now(UTC).timestamp() - (days * 24 * 3600)
        removed_count = 0

        for backup_file in self.backup_dir.glob(f"{prefix}*.json"):
            if backup_file.stat().st_mtime < cutoff_date:
                try:
                    backup_file.unlink()
                    removed_count += 1
                    logger.info(f"🗑️ Removed old backup: {backup_file.name}")
                except Exception as e:
                    logger.warning(f"Failed to remove {backup_file}: {e}")

        if removed_count > 0:
            logger.info(f"✅ Cleaned up {removed_count} old backup files")


# グローバルインスタンス
_backup_scheduler = None


def get_backup_scheduler() -> SimpleBackupScheduler:
    """バックアップスケジューラーのインスタンスを取得"""
    global _backup_scheduler
    if _backup_scheduler is None:
        _backup_scheduler = SimpleBackupScheduler()
    return _backup_scheduler


def create_manual_backup() -> str:
    """手動バックアップ作成（cron用）"""
    scheduler = get_backup_scheduler()
    return scheduler.create_daily_backup()


if __name__ == "__main__":
    # コマンドライン実行時は手動バックアップ作成
    import sys

    logging.basicConfig(level=logging.INFO)

    try:
        backup_path = create_manual_backup()
        print(f"Backup created: {backup_path}")
        sys.exit(0)
    except Exception as e:
        print(f"Backup failed: {e}")
        sys.exit(1)
