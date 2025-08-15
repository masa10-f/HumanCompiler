"""
Automated Database Backup Scheduler for TaskAgent

This module provides automated, scheduled backup functionality to prevent data loss
incidents like the one that occurred during development. It implements:
- Scheduled backups with configurable intervals
- Local and cloud storage options
- Backup retention policies
- Health monitoring and alerting
- Integration with existing DataBackupManager
"""

import asyncio
import logging
import os
import shutil
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass
from enum import Enum
import json
import smtplib
from email.mime.text import MIMEText as MimeText
from email.mime.multipart import MIMEMultipart as MimeMultipart

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from taskagent_api.safe_migration import DataBackupManager
from taskagent_api.database import db

logger = logging.getLogger(__name__)


class BackupStatus(Enum):
    """Backup operation status"""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    EXPIRED = "expired"


class StorageType(Enum):
    """Backup storage type"""

    LOCAL = "local"
    S3 = "s3"
    GDRIVE = "gdrive"
    DROPBOX = "dropbox"


@dataclass
class BackupConfig:
    """Backup configuration settings"""

    # Schedule settings
    backup_interval_hours: int = 6  # Default: every 6 hours
    daily_backup_time: str = "02:00"  # Daily backup at 2 AM
    weekly_backup_day: int = 0  # Monday = 0

    # Retention policy
    keep_hourly_backups: int = 24  # Keep last 24 hourly backups (1 day)
    keep_daily_backups: int = 30  # Keep last 30 daily backups (1 month)
    keep_weekly_backups: int = 12  # Keep last 12 weekly backups (3 months)
    keep_monthly_backups: int = 12  # Keep last 12 monthly backups (1 year)

    # Storage settings
    local_backup_dir: str = "backups"
    max_backup_size_mb: int = 500  # Alert if backup exceeds this size
    compression_enabled: bool = True

    # Monitoring settings
    alert_on_failure: bool = True
    alert_on_large_backup: bool = True
    health_check_interval_minutes: int = 60

    # Notification settings
    email_alerts_enabled: bool = False
    email_recipients: list[str] | None = None
    smtp_server: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None


@dataclass
class BackupRecord:
    """Record of a backup operation"""

    timestamp: datetime
    backup_path: str
    file_size_bytes: int
    status: BackupStatus
    backup_type: str  # hourly, daily, weekly, monthly
    duration_seconds: float
    error_message: str | None = None
    tables_backed_up: dict[str, int] | None = None  # table_name -> record_count


class BackupScheduler:
    """Main backup scheduler class"""

    def __init__(self, config: BackupConfig | None = None):
        self.config = config or BackupConfig()
        self.backup_manager = DataBackupManager(self.config.local_backup_dir)
        self.scheduler = AsyncIOScheduler()
        self.backup_history: list[BackupRecord] = []
        self.is_running = False

        # Create backup directory
        Path(self.config.local_backup_dir).mkdir(parents=True, exist_ok=True)

        # Load existing backup history
        self._load_backup_history()

    def _load_backup_history(self):
        """Load backup history from metadata file"""
        history_file = Path(self.config.local_backup_dir) / "backup_history.json"
        if history_file.exists():
            try:
                with open(history_file) as f:
                    data = json.load(f)
                    self.backup_history = [
                        BackupRecord(
                            timestamp=datetime.fromisoformat(record["timestamp"]),
                            backup_path=record["backup_path"],
                            file_size_bytes=record["file_size_bytes"],
                            status=BackupStatus(record["status"]),
                            backup_type=record["backup_type"],
                            duration_seconds=record["duration_seconds"],
                            error_message=record.get("error_message"),
                            tables_backed_up=record.get("tables_backed_up", {}),
                        )
                        for record in data
                    ]
                logger.info(
                    f"Loaded {len(self.backup_history)} backup records from history"
                )
            except Exception as e:
                logger.warning(f"Failed to load backup history: {e}")
                self.backup_history = []

    def _save_backup_history(self):
        """Save backup history to metadata file"""
        history_file = Path(self.config.local_backup_dir) / "backup_history.json"
        try:
            data = [
                {
                    "timestamp": record.timestamp.isoformat(),
                    "backup_path": record.backup_path,
                    "file_size_bytes": record.file_size_bytes,
                    "status": record.status.value,
                    "backup_type": record.backup_type,
                    "duration_seconds": record.duration_seconds,
                    "error_message": record.error_message,
                    "tables_backed_up": record.tables_backed_up,
                }
                for record in self.backup_history
            ]
            with open(history_file, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save backup history: {e}")

    async def create_backup(self, backup_type: str = "manual") -> BackupRecord:
        """Create a new backup and return the backup record"""
        start_time = datetime.now(UTC)
        logger.info(f"🚀 Starting {backup_type} backup at {start_time}")

        record = BackupRecord(
            timestamp=start_time,
            backup_path="",
            file_size_bytes=0,
            status=BackupStatus.RUNNING,
            backup_type=backup_type,
            duration_seconds=0.0,
        )

        try:
            # Create backup with timestamp-based naming
            backup_name = f"{backup_type}_backup_{start_time.strftime('%Y%m%d_%H%M%S')}"
            backup_path = self.backup_manager.create_backup(backup_name)

            # Get file size and table counts
            backup_file = Path(backup_path)
            file_size = backup_file.stat().st_size

            # Load backup file to get table counts
            with open(backup_path) as f:
                backup_data = json.load(f)
                tables_backed_up = backup_data.get("metadata", {}).get(
                    "total_records", {}
                )

            # Calculate duration
            end_time = datetime.now(UTC)
            duration = (end_time - start_time).total_seconds()

            # Update record
            record.backup_path = backup_path
            record.file_size_bytes = file_size
            record.status = BackupStatus.SUCCESS
            record.duration_seconds = duration
            record.tables_backed_up = tables_backed_up

            # Add to history
            self.backup_history.append(record)
            self._save_backup_history()

            logger.info(f"✅ {backup_type.capitalize()} backup completed successfully")
            logger.info(f"   📁 File: {backup_path}")
            logger.info(f"   📊 Size: {file_size / 1024 / 1024:.2f} MB")
            logger.info(f"   ⏱️  Duration: {duration:.2f} seconds")
            logger.info(f"   📈 Records: {tables_backed_up}")

            # Check for alerts
            await self._check_backup_alerts(record)

            return record

        except Exception as e:
            # Update record with error
            record.status = BackupStatus.FAILED
            record.error_message = str(e)
            record.duration_seconds = (datetime.now(UTC) - start_time).total_seconds()

            self.backup_history.append(record)
            self._save_backup_history()

            logger.error(f"❌ {backup_type.capitalize()} backup failed: {e}")

            # Send failure alert
            if self.config.alert_on_failure:
                await self._send_alert(
                    "Backup Failed", f"{backup_type.capitalize()} backup failed: {e}"
                )

            raise

    async def _check_backup_alerts(self, record: BackupRecord):
        """Check if backup requires alerts"""
        # Check backup size
        if self.config.alert_on_large_backup:
            size_mb = record.file_size_bytes / 1024 / 1024
            if size_mb > self.config.max_backup_size_mb:
                await self._send_alert(
                    "Large Backup Alert",
                    f"Backup size ({size_mb:.2f} MB) exceeds threshold ({self.config.max_backup_size_mb} MB)\n"
                    f"Path: {record.backup_path}",
                )

    async def _send_alert(self, subject: str, message: str):
        """Send alert notification"""
        logger.warning(f"🚨 ALERT: {subject} - {message}")

        if self.config.email_alerts_enabled and self.config.email_recipients:
            try:
                await self._send_email_alert(subject, message)
            except Exception as e:
                logger.error(f"Failed to send email alert: {e}")

    async def _send_email_alert(self, subject: str, message: str):
        """Send email alert"""
        if not all(
            [
                self.config.smtp_server,
                self.config.smtp_username,
                self.config.smtp_password,
            ]
        ):
            logger.warning("Email configuration incomplete, skipping email alert")
            return

        msg = MimeMultipart()
        msg["From"] = self.config.smtp_username
        msg["To"] = ", ".join(self.config.email_recipients)
        msg["Subject"] = f"TaskAgent Backup Alert: {subject}"

        body = f"""
TaskAgent Database Backup Alert

{message}

Timestamp: {datetime.now(UTC).isoformat()}
Server: {os.getenv("HOSTNAME", "Unknown")}

This is an automated alert from the TaskAgent backup system.
        """

        msg.attach(MimeText(body, "plain"))

        with smtplib.SMTP(self.config.smtp_server, self.config.smtp_port) as server:
            server.starttls()
            server.login(self.config.smtp_username, self.config.smtp_password)
            server.send_message(msg)

        logger.info(f"📧 Email alert sent: {subject}")

    def cleanup_old_backups(self):
        """Clean up old backups according to retention policy"""
        logger.info("🧹 Starting backup cleanup...")

        now = datetime.now(UTC)
        kept_backups = []
        removed_count = 0

        # Sort backups by timestamp (newest first)
        sorted_backups = sorted(
            self.backup_history, key=lambda x: x.timestamp, reverse=True
        )

        # Keep backups according to retention policy
        hourly_count = 0
        daily_count = 0
        weekly_count = 0
        monthly_count = 0

        for record in sorted_backups:
            age = now - record.timestamp
            keep_backup = False

            # Determine backup category and check retention limits
            if age.total_seconds() < 3600:  # Less than 1 hour old
                keep_backup = True  # Always keep very recent backups
            elif age.days == 0 and hourly_count < self.config.keep_hourly_backups:
                keep_backup = True
                hourly_count += 1
            elif (
                age.days <= 30
                and record.backup_type == "daily"
                and daily_count < self.config.keep_daily_backups
            ):
                keep_backup = True
                daily_count += 1
            elif (
                age.days <= 90
                and record.backup_type == "weekly"
                and weekly_count < self.config.keep_weekly_backups
            ):
                keep_backup = True
                weekly_count += 1
            elif (
                record.backup_type == "monthly"
                and monthly_count < self.config.keep_monthly_backups
            ):
                keep_backup = True
                monthly_count += 1

            if keep_backup:
                kept_backups.append(record)
            else:
                # Remove backup file
                try:
                    backup_path = Path(record.backup_path)
                    if backup_path.exists():
                        backup_path.unlink()
                        logger.info(f"🗑️  Removed old backup: {record.backup_path}")
                        removed_count += 1
                except Exception as e:
                    logger.warning(
                        f"Failed to remove backup file {record.backup_path}: {e}"
                    )
                    # Keep record even if file deletion failed
                    kept_backups.append(record)

        # Update backup history
        self.backup_history = kept_backups
        self._save_backup_history()

        logger.info(f"✅ Backup cleanup completed: removed {removed_count} old backups")
        logger.info(f"   📊 Retained: {len(kept_backups)} backups")

    def start(self):
        """Start the backup scheduler"""
        if self.is_running:
            logger.warning("Backup scheduler is already running")
            return

        logger.info("🚀 Starting backup scheduler...")

        # Schedule interval backups (every N hours)
        self.scheduler.add_job(
            self.create_backup,
            trigger=IntervalTrigger(hours=self.config.backup_interval_hours),
            args=["interval"],
            id="interval_backup",
            max_instances=1,
            coalesce=True,
        )

        # Schedule daily backup
        hour, minute = map(int, self.config.daily_backup_time.split(":"))
        self.scheduler.add_job(
            self.create_backup,
            trigger=CronTrigger(hour=hour, minute=minute),
            args=["daily"],
            id="daily_backup",
            max_instances=1,
            coalesce=True,
        )

        # Schedule weekly backup
        self.scheduler.add_job(
            self.create_backup,
            trigger=CronTrigger(
                day_of_week=self.config.weekly_backup_day, hour=hour, minute=minute
            ),
            args=["weekly"],
            id="weekly_backup",
            max_instances=1,
            coalesce=True,
        )

        # Schedule monthly backup
        self.scheduler.add_job(
            self.create_backup,
            trigger=CronTrigger(day=1, hour=hour, minute=minute),
            args=["monthly"],
            id="monthly_backup",
            max_instances=1,
            coalesce=True,
        )

        # Schedule cleanup
        self.scheduler.add_job(
            self.cleanup_old_backups,
            trigger=CronTrigger(hour=3, minute=0),  # Daily at 3 AM
            id="cleanup_backups",
            max_instances=1,
            coalesce=True,
        )

        # Schedule health check
        self.scheduler.add_job(
            self.health_check,
            trigger=IntervalTrigger(minutes=self.config.health_check_interval_minutes),
            id="backup_health_check",
            max_instances=1,
            coalesce=True,
        )

        self.scheduler.start()
        self.is_running = True

        logger.info("✅ Backup scheduler started successfully")
        logger.info(
            f"   🕐 Interval backups: every {self.config.backup_interval_hours} hours"
        )
        logger.info(f"   📅 Daily backups: {self.config.daily_backup_time}")
        logger.info(
            f"   📈 Weekly backups: every {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][self.config.weekly_backup_day]}"
        )
        logger.info("   🗓️  Monthly backups: 1st of each month")

    def stop(self):
        """Stop the backup scheduler"""
        if not self.is_running:
            logger.warning("Backup scheduler is not running")
            return

        logger.info("⏹️  Stopping backup scheduler...")
        self.scheduler.shutdown(wait=True)
        self.is_running = False
        logger.info("✅ Backup scheduler stopped")

    async def health_check(self):
        """Perform health check on backup system"""
        try:
            # Check database connectivity
            db_healthy = await db.health_check()

            # Check backup directory
            backup_dir = Path(self.config.local_backup_dir)
            dir_exists = backup_dir.exists() and backup_dir.is_dir()

            # Check recent backup status
            recent_backup_ok = False
            if self.backup_history:
                latest_backup = max(self.backup_history, key=lambda x: x.timestamp)
                time_since_last = datetime.now(UTC) - latest_backup.timestamp
                recent_backup_ok = (
                    time_since_last.total_seconds()
                    < self.config.backup_interval_hours * 3600 * 2
                    and latest_backup.status == BackupStatus.SUCCESS
                )

            # Check disk space
            disk_space_ok = True
            try:
                disk_usage = shutil.disk_usage(backup_dir)
                free_gb = disk_usage.free / (1024**3)
                disk_space_ok = free_gb > 1.0  # At least 1GB free
            except Exception:
                disk_space_ok = False

            all_healthy = all([db_healthy, dir_exists, recent_backup_ok, disk_space_ok])

            if not all_healthy:
                issues = []
                if not db_healthy:
                    issues.append("Database connectivity issue")
                if not dir_exists:
                    issues.append("Backup directory not accessible")
                if not recent_backup_ok:
                    issues.append("No recent successful backup")
                if not disk_space_ok:
                    issues.append("Insufficient disk space")

                await self._send_alert(
                    "Backup System Health Check Failed",
                    "Health check issues detected:\n"
                    + "\n".join(f"- {issue}" for issue in issues),
                )

            logger.debug(
                f"Health check: DB={db_healthy}, Dir={dir_exists}, Recent={recent_backup_ok}, Disk={disk_space_ok}"
            )

        except Exception as e:
            logger.error(f"Health check failed: {e}")
            await self._send_alert(
                "Health Check Error", f"Health check encountered an error: {e}"
            )

    def get_backup_status(self) -> dict[str, Any]:
        """Get current backup system status"""
        if not self.backup_history:
            return {
                "status": "no_backups",
                "last_backup": None,
                "total_backups": 0,
                "scheduler_running": self.is_running,
            }

        latest_backup = max(self.backup_history, key=lambda x: x.timestamp)
        successful_backups = [
            b for b in self.backup_history if b.status == BackupStatus.SUCCESS
        ]
        failed_backups = [
            b for b in self.backup_history if b.status == BackupStatus.FAILED
        ]

        return {
            "status": "healthy"
            if latest_backup.status == BackupStatus.SUCCESS
            else "unhealthy",
            "last_backup": {
                "timestamp": latest_backup.timestamp.isoformat(),
                "status": latest_backup.status.value,
                "backup_type": latest_backup.backup_type,
                "file_size_mb": latest_backup.file_size_bytes / 1024 / 1024,
                "duration_seconds": latest_backup.duration_seconds,
            },
            "total_backups": len(self.backup_history),
            "successful_backups": len(successful_backups),
            "failed_backups": len(failed_backups),
            "scheduler_running": self.is_running,
            "next_scheduled": self._get_next_scheduled_backup(),
        }

    def _get_next_scheduled_backup(self) -> str | None:
        """Get next scheduled backup time"""
        if not self.is_running:
            return None

        try:
            jobs = self.scheduler.get_jobs()
            next_times = [job.next_run_time for job in jobs if job.next_run_time]
            if next_times:
                return min(next_times).isoformat()
        except Exception:
            pass

        return None


# Global backup scheduler instance
backup_scheduler: BackupScheduler | None = None


def get_backup_scheduler() -> BackupScheduler:
    """Get global backup scheduler instance"""
    global backup_scheduler
    if backup_scheduler is None:
        backup_scheduler = BackupScheduler()
    return backup_scheduler


def init_backup_scheduler(config: BackupConfig | None = None) -> BackupScheduler:
    """Initialize and start backup scheduler"""
    global backup_scheduler
    backup_scheduler = BackupScheduler(config)
    backup_scheduler.start()
    return backup_scheduler


async def create_manual_backup() -> BackupRecord:
    """Create a manual backup"""
    scheduler = get_backup_scheduler()
    return await scheduler.create_backup("manual")
