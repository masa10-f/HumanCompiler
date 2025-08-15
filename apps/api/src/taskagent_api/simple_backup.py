#!/usr/bin/env python3
"""
Simple Local Backup System for TaskAgent
ローカルサーバー向けの軽量バックアップシステム
"""

import asyncio
import concurrent.futures
import json
import logging
import os
import re
import shutil
import threading
from datetime import datetime, UTC
from pathlib import Path
from typing import Optional

from taskagent_api.safe_migration import DataBackupManager

logger = logging.getLogger(__name__)


class BackupError(Exception):
    """バックアップ操作に関するカスタム例外"""

    pass


class DiskSpaceError(BackupError):
    """ディスク容量不足エラー"""

    pass


class BackupValidationError(BackupError):
    """バックアップファイル検証エラー"""

    pass


class BackupConfig:
    """バックアップ設定管理"""

    def __init__(self):
        # 環境変数から設定を読み込み（デフォルト値付き）
        self.backup_dir = os.getenv("BACKUP_DIR", "backups")
        self.daily_retention_days = int(os.getenv("BACKUP_DAILY_RETENTION", "7"))
        self.weekly_retention_days = int(os.getenv("BACKUP_WEEKLY_RETENTION", "28"))
        self.min_disk_space_mb = int(os.getenv("BACKUP_MIN_DISK_MB", "100"))
        self.enable_audit_log = os.getenv("BACKUP_AUDIT_LOG", "true").lower() == "true"
        self.max_worker_threads = int(os.getenv("BACKUP_MAX_WORKERS", "2"))

        # ファイル権限のロバストなパース
        try:
            self.file_permissions = int(
                os.getenv("BACKUP_FILE_PERMISSIONS", "0o600"), 8
            )
        except ValueError:
            logger.warning("Invalid file permissions, using default 0o600")
            self.file_permissions = 0o600


class SimpleBackupScheduler:
    """シンプルなローカルバックアップスケジューラー"""

    def __init__(self, backup_dir: str | None = None):
        self.config = BackupConfig()
        self.backup_dir = Path(backup_dir or self.config.backup_dir)
        self.backup_manager = DataBackupManager(str(self.backup_dir))

        # バックアップディレクトリの作成と権限設定
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.backup_dir.chmod(0o700)  # ディレクトリは700権限
        except OSError as e:
            logger.warning(f"ディレクトリ権限設定失敗: {e}")

    def _check_disk_space(self, required_mb: int | None = None) -> bool:
        """ディスク容量チェック"""
        try:
            stat = shutil.disk_usage(self.backup_dir)
            free_mb = stat.free // (1024 * 1024)
            min_required = required_mb or self.config.min_disk_space_mb

            if free_mb < min_required:
                raise DiskSpaceError(
                    f"ディスク容量不足: {free_mb}MB < {min_required}MB required"
                )
            return True
        except Exception as e:
            logger.error(f"ディスク容量チェック失敗: {e}")
            if isinstance(e, DiskSpaceError):
                raise
            return False

    def _set_file_permissions(self, file_path: Path):
        """ファイル権限の設定"""
        try:
            file_path.chmod(self.config.file_permissions)
        except OSError as e:
            logger.warning(f"ファイル権限設定失敗 {file_path}: {e}")

    def _sanitize_audit_data(self, data: dict) -> dict:
        """監査ログデータのサニタイズ（ログインジェクション対策）"""

        def sanitize_value(value):
            if isinstance(value, str):
                # 制御文字と改行文字を除去
                return re.sub(r"[\x00-\x1f\x7f-\x9f\n\r]", "", value)[:1000]
            elif isinstance(value, dict):
                return {k: sanitize_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [sanitize_value(v) for v in value]
            else:
                return value

        return sanitize_value(data)

    def _audit_log(self, action: str, details: dict):
        """監査ログの記録（セキュア版）"""
        if not self.config.enable_audit_log:
            return

        audit_file = self.backup_dir / "audit.log"

        # データのサニタイズ
        sanitized_details = self._sanitize_audit_data(details)

        log_entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "action": action,
            "details": sanitized_details,
        }

        try:
            with open(audit_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning(f"監査ログ記録失敗: {e}")

    def _validate_backup(self, backup_path: str) -> bool:
        """バックアップファイルの整合性チェック"""
        try:
            with open(backup_path, encoding="utf-8") as f:
                data = json.load(f)

            # 必須キーの存在確認
            required_keys = ["users", "projects", "goals", "tasks", "metadata"]
            if not all(key in data for key in required_keys):
                return False

            # メタデータの確認
            metadata = data.get("metadata", {})
            if "created_at" not in metadata or "total_records" not in metadata:
                return False

            # レコード数の一致確認
            total_records = metadata.get("total_records", {})
            for table in ["users", "projects", "goals", "tasks"]:
                actual_count = len(data.get(table, []))
                expected_count = total_records.get(table, 0)
                if actual_count != expected_count:
                    logger.warning(
                        f"Record count mismatch for {table}: {actual_count} != {expected_count}"
                    )
                    return False

            return True

        except Exception as e:
            logger.error(f"Backup validation failed: {e}")
            return False

    async def _remove_backup_file(self, file_path: Path) -> bool:
        """単一バックアップファイルの削除（抽出されたメソッド）"""
        try:
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                await loop.run_in_executor(executor, file_path.unlink)
            logger.info(f"🗑️ Removed old backup: {file_path.name}")
            return True
        except Exception as e:
            logger.warning(f"Failed to remove {file_path}: {e}")
            return False

    async def create_daily_backup(self) -> str:
        """日次バックアップ作成（非同期版）"""
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        backup_name = f"daily_backup_{timestamp}"

        try:
            # ディスク容量チェック
            self._check_disk_space()

            # バックアップ作成（制限されたスレッドプールで実行）
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=self.config.max_worker_threads
            ) as executor:
                backup_path = await loop.run_in_executor(
                    executor, self.backup_manager.create_backup, backup_name
                )

            # バックアップ検証
            if not self._validate_backup(backup_path):
                raise BackupValidationError(f"Backup validation failed: {backup_path}")

            # ファイル権限設定
            self._set_file_permissions(Path(backup_path))

            # 監査ログ
            self._audit_log(
                "daily_backup_created",
                {
                    "path": backup_path,
                    "size": Path(backup_path).stat().st_size,
                    "validated": True,
                },
            )

            logger.info(f"✅ Daily backup created and validated: {backup_path}")

            # 古いバックアップを非同期でクリーンアップ
            await self._cleanup_old_backups_async(days=self.config.daily_retention_days)

            return backup_path

        except DiskSpaceError as e:
            logger.error(f"❌ Backup failed due to disk space: {e}")
            self._audit_log(
                "daily_backup_failed", {"error": str(e), "error_type": "disk_space"}
            )
            raise
        except BackupValidationError as e:
            logger.error(f"❌ Backup validation failed: {e}")
            self._audit_log(
                "daily_backup_failed", {"error": str(e), "error_type": "validation"}
            )
            raise
        except OSError as e:
            logger.error(f"❌ IO error during backup: {e}")
            self._audit_log(
                "daily_backup_failed", {"error": str(e), "error_type": "io"}
            )
            raise BackupError(f"IO operation failed: {e}")
        except Exception as e:
            logger.error(f"❌ Unexpected error during backup: {e}")
            self._audit_log(
                "daily_backup_failed", {"error": str(e), "error_type": "unexpected"}
            )
            raise BackupError(f"Backup operation failed: {e}")

    async def create_weekly_backup(self) -> str:
        """週次バックアップ作成（非同期版）"""
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        backup_name = f"weekly_backup_{timestamp}"

        try:
            # ディスク容量チェック
            self._check_disk_space()

            # バックアップ作成
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=self.config.max_worker_threads
            ) as executor:
                backup_path = await loop.run_in_executor(
                    executor, self.backup_manager.create_backup, backup_name
                )

            # バックアップ検証
            if not self._validate_backup(backup_path):
                raise BackupValidationError(
                    f"Weekly backup validation failed: {backup_path}"
                )

            # ファイル権限設定
            self._set_file_permissions(Path(backup_path))

            # 監査ログ
            self._audit_log(
                "weekly_backup_created",
                {
                    "path": backup_path,
                    "size": Path(backup_path).stat().st_size,
                    "validated": True,
                },
            )

            logger.info(f"✅ Weekly backup created and validated: {backup_path}")

            # 古い週次バックアップを非同期でクリーンアップ
            await self._cleanup_old_backups_async(
                prefix="weekly_backup_", days=self.config.weekly_retention_days
            )

            return backup_path

        except DiskSpaceError as e:
            logger.error(f"❌ Weekly backup failed due to disk space: {e}")
            self._audit_log(
                "weekly_backup_failed", {"error": str(e), "error_type": "disk_space"}
            )
            raise
        except BackupValidationError as e:
            logger.error(f"❌ Weekly backup validation failed: {e}")
            self._audit_log(
                "weekly_backup_failed", {"error": str(e), "error_type": "validation"}
            )
            raise
        except Exception as e:
            logger.error(f"❌ Weekly backup failed: {e}")
            self._audit_log(
                "weekly_backup_failed", {"error": str(e), "error_type": "unexpected"}
            )
            raise BackupError(f"Weekly backup failed: {e}")

    async def _cleanup_old_backups_async(self, days: int = 7, prefix: str = ""):
        """古いバックアップファイルを非同期で削除"""
        if not self.backup_dir.exists():
            return

        cutoff_date = datetime.now(UTC).timestamp() - (days * 24 * 3600)
        removed_count = 0
        failed_count = 0

        # 削除対象ファイルの収集
        files_to_remove = []
        for backup_file in self.backup_dir.glob(f"{prefix}*.json"):
            if backup_file.stat().st_mtime < cutoff_date:
                files_to_remove.append(backup_file)

        # 並列削除実行
        if files_to_remove:
            tasks = [
                self._remove_backup_file(file_path) for file_path in files_to_remove
            ]
            results = await asyncio.gather(*tasks)
            removed_count = sum(1 for r in results if r)
            failed_count = sum(1 for r in results if not r)

        if removed_count > 0:
            logger.info(f"✅ Cleaned up {removed_count} old backup files")
            self._audit_log(
                "cleanup_completed",
                {"removed": removed_count, "failed": failed_count, "prefix": prefix},
            )

    def get_backup_status(self) -> dict:
        """バックアップシステムの状態取得"""
        try:
            backup_files = list(self.backup_dir.glob("*.json"))
            backup_files = [f for f in backup_files if f.name != "audit.log"]

            total_size = sum(f.stat().st_size for f in backup_files)

            # 最新バックアップの情報
            latest_backup = None
            if backup_files:
                latest_file = max(backup_files, key=lambda f: f.stat().st_mtime)
                latest_backup = {
                    "name": latest_file.name,
                    "created_at": datetime.fromtimestamp(
                        latest_file.stat().st_mtime, UTC
                    ).isoformat(),
                    "size": latest_file.stat().st_size,
                    "validated": self._validate_backup(str(latest_file)),
                }

            # ディスク情報
            disk_usage = shutil.disk_usage(self.backup_dir)

            return {
                "status": "healthy" if backup_files else "no_backups",
                "total_backups": len(backup_files),
                "total_size_bytes": total_size,
                "latest_backup": latest_backup,
                "disk_usage": {
                    "free_mb": disk_usage.free // (1024 * 1024),
                    "total_mb": disk_usage.total // (1024 * 1024),
                    "used_mb": (disk_usage.total - disk_usage.free) // (1024 * 1024),
                },
                "backup_directory": str(self.backup_dir),
                "config": {
                    "daily_retention_days": self.config.daily_retention_days,
                    "weekly_retention_days": self.config.weekly_retention_days,
                    "min_disk_space_mb": self.config.min_disk_space_mb,
                },
            }
        except Exception as e:
            logger.error(f"Failed to get backup status: {e}")
            return {"status": "error", "error": str(e)}

    # 同期版メソッド（後方互換性のため）
    def create_daily_backup_sync(self) -> str:
        """日次バックアップ作成（同期版）"""
        return asyncio.run(self.create_daily_backup())

    def create_weekly_backup_sync(self) -> str:
        """週次バックアップ作成（同期版）"""
        return asyncio.run(self.create_weekly_backup())


# グローバルインスタンス管理（スレッドセーフ）
_backup_scheduler = None
_lock = threading.Lock()


def get_backup_scheduler() -> SimpleBackupScheduler:
    """バックアップスケジューラーのインスタンスを取得（スレッドセーフ）"""
    global _backup_scheduler
    if _backup_scheduler is None:
        with _lock:
            if _backup_scheduler is None:
                _backup_scheduler = SimpleBackupScheduler()
    return _backup_scheduler


def create_manual_backup() -> str:
    """手動バックアップ作成（cron用）"""
    scheduler = get_backup_scheduler()
    return scheduler.create_daily_backup_sync()


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
