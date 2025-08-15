"""
Backup Management API Routes

This module provides REST API endpoints for managing database backups,
including manual backup creation, backup status monitoring, and backup history.
"""

import logging
from datetime import datetime, UTC
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field

from taskagent_api.backup_scheduler import (
    get_backup_scheduler,
    init_backup_scheduler,
    create_manual_backup,
    BackupConfig,
    BackupRecord,
    BackupStatus
)
from taskagent_api.auth import get_current_user
from taskagent_api.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup", tags=["backup"])


# Request/Response Models
class BackupConfigRequest(BaseModel):
    """Request model for backup configuration"""
    backup_interval_hours: int = Field(default=6, ge=1, le=168)  # 1 hour to 1 week
    daily_backup_time: str = Field(default="02:00", pattern=r"^([01]\d|2[0-3]):([0-5]\d)$")
    weekly_backup_day: int = Field(default=0, ge=0, le=6)  # 0=Monday, 6=Sunday
    
    keep_hourly_backups: int = Field(default=24, ge=1, le=168)
    keep_daily_backups: int = Field(default=30, ge=1, le=365)
    keep_weekly_backups: int = Field(default=12, ge=1, le=52)
    keep_monthly_backups: int = Field(default=12, ge=1, le=60)
    
    max_backup_size_mb: int = Field(default=500, ge=1, le=10000)
    alert_on_failure: bool = True
    alert_on_large_backup: bool = True
    
    email_alerts_enabled: bool = False
    email_recipients: Optional[List[str]] = None
    smtp_server: Optional[str] = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None


class BackupRecordResponse(BaseModel):
    """Response model for backup record"""
    timestamp: datetime
    backup_path: str
    file_size_bytes: int
    file_size_mb: float
    status: str
    backup_type: str
    duration_seconds: float
    error_message: Optional[str] = None
    tables_backed_up: Optional[Dict[str, int]] = None
    
    @classmethod
    def from_backup_record(cls, record: BackupRecord) -> "BackupRecordResponse":
        return cls(
            timestamp=record.timestamp,
            backup_path=record.backup_path,
            file_size_bytes=record.file_size_bytes,
            file_size_mb=record.file_size_bytes / 1024 / 1024,
            status=record.status.value,
            backup_type=record.backup_type,
            duration_seconds=record.duration_seconds,
            error_message=record.error_message,
            tables_backed_up=record.tables_backed_up
        )


class BackupStatusResponse(BaseModel):
    """Response model for backup system status"""
    status: str
    last_backup: Optional[Dict[str, Any]]
    total_backups: int
    successful_backups: int
    failed_backups: int
    scheduler_running: bool
    next_scheduled: Optional[str]
    backup_directory: str
    disk_usage_mb: Optional[float]


class BackupOperationResponse(BaseModel):
    """Response model for backup operations"""
    success: bool
    message: str
    backup_record: Optional[BackupRecordResponse] = None


# API Endpoints

@router.get("/status", response_model=BackupStatusResponse)
async def get_backup_status(current_user: User = Depends(get_current_user)):
    """Get current backup system status"""
    try:
        scheduler = get_backup_scheduler()
        status = scheduler.get_backup_status()
        
        # Add disk usage information
        backup_dir = Path(scheduler.config.local_backup_dir)
        disk_usage_mb = None
        try:
            if backup_dir.exists():
                total_size = sum(f.stat().st_size for f in backup_dir.glob("*.json"))
                disk_usage_mb = total_size / 1024 / 1024
        except Exception as e:
            logger.warning(f"Failed to calculate disk usage: {e}")
        
        return BackupStatusResponse(
            status=status["status"],
            last_backup=status["last_backup"],
            total_backups=status["total_backups"],
            successful_backups=status["successful_backups"],
            failed_backups=status["failed_backups"],
            scheduler_running=status["scheduler_running"],
            next_scheduled=status["next_scheduled"],
            backup_directory=str(backup_dir),
            disk_usage_mb=disk_usage_mb
        )
    except Exception as e:
        logger.error(f"Failed to get backup status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get backup status: {str(e)}")


@router.get("/history", response_model=List[BackupRecordResponse])
async def get_backup_history(
    limit: int = 50,
    status_filter: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get backup history with optional filtering"""
    try:
        scheduler = get_backup_scheduler()
        history = scheduler.backup_history
        
        # Filter by status if specified
        if status_filter:
            try:
                filter_status = BackupStatus(status_filter.lower())
                history = [record for record in history if record.status == filter_status]
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid status filter: {status_filter}")
        
        # Sort by timestamp (newest first) and limit
        history = sorted(history, key=lambda x: x.timestamp, reverse=True)[:limit]
        
        return [BackupRecordResponse.from_backup_record(record) for record in history]
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get backup history: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get backup history: {str(e)}")


@router.post("/create", response_model=BackupOperationResponse)
async def create_backup(
    background_tasks: BackgroundTasks,
    backup_type: str = "manual",
    current_user: User = Depends(get_current_user)
):
    """Create a manual backup"""
    try:
        if backup_type not in ["manual", "urgent", "pre_migration"]:
            raise HTTPException(status_code=400, detail="Invalid backup type")
        
        # Create backup in background
        record = await create_manual_backup()
        
        return BackupOperationResponse(
            success=True,
            message=f"Backup created successfully: {Path(record.backup_path).name}",
            backup_record=BackupRecordResponse.from_backup_record(record)
        )
        
    except Exception as e:
        logger.error(f"Failed to create backup: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to create backup: {str(e)}"
        )


@router.post("/restore", response_model=BackupOperationResponse)
async def restore_backup(
    backup_filename: str,
    current_user: User = Depends(get_current_user)
):
    """Restore database from a backup file"""
    try:
        scheduler = get_backup_scheduler()
        backup_dir = Path(scheduler.config.local_backup_dir)
        backup_path = backup_dir / backup_filename
        
        if not backup_path.exists():
            raise HTTPException(status_code=404, detail=f"Backup file not found: {backup_filename}")
        
        if not backup_path.suffix == ".json":
            raise HTTPException(status_code=400, detail="Only JSON backup files are supported")
        
        # Perform restore
        scheduler.backup_manager.restore_backup(str(backup_path))
        
        return BackupOperationResponse(
            success=True,
            message=f"Database restored successfully from {backup_filename}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to restore backup: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to restore backup: {str(e)}"
        )


@router.post("/scheduler/start", response_model=BackupOperationResponse)
async def start_scheduler(current_user: User = Depends(get_current_user)):
    """Start the backup scheduler"""
    try:
        scheduler = get_backup_scheduler()
        if scheduler.is_running:
            return BackupOperationResponse(
                success=True,
                message="Backup scheduler is already running"
            )
        
        scheduler.start()
        return BackupOperationResponse(
            success=True,
            message="Backup scheduler started successfully"
        )
        
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to start scheduler: {str(e)}"
        )


@router.post("/scheduler/stop", response_model=BackupOperationResponse)
async def stop_scheduler(current_user: User = Depends(get_current_user)):
    """Stop the backup scheduler"""
    try:
        scheduler = get_backup_scheduler()
        if not scheduler.is_running:
            return BackupOperationResponse(
                success=True,
                message="Backup scheduler is not running"
            )
        
        scheduler.stop()
        return BackupOperationResponse(
            success=True,
            message="Backup scheduler stopped successfully"
        )
        
    except Exception as e:
        logger.error(f"Failed to stop scheduler: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to stop scheduler: {str(e)}"
        )


@router.post("/scheduler/configure", response_model=BackupOperationResponse)
async def configure_scheduler(
    config_request: BackupConfigRequest,
    current_user: User = Depends(get_current_user)
):
    """Configure backup scheduler settings"""
    try:
        # Create new config
        config = BackupConfig(
            backup_interval_hours=config_request.backup_interval_hours,
            daily_backup_time=config_request.daily_backup_time,
            weekly_backup_day=config_request.weekly_backup_day,
            keep_hourly_backups=config_request.keep_hourly_backups,
            keep_daily_backups=config_request.keep_daily_backups,
            keep_weekly_backups=config_request.keep_weekly_backups,
            keep_monthly_backups=config_request.keep_monthly_backups,
            max_backup_size_mb=config_request.max_backup_size_mb,
            alert_on_failure=config_request.alert_on_failure,
            alert_on_large_backup=config_request.alert_on_large_backup,
            email_alerts_enabled=config_request.email_alerts_enabled,
            email_recipients=config_request.email_recipients or [],
            smtp_server=config_request.smtp_server,
            smtp_port=config_request.smtp_port,
            smtp_username=config_request.smtp_username,
            smtp_password=config_request.smtp_password
        )
        
        # Stop current scheduler and start with new config
        scheduler = get_backup_scheduler()
        was_running = scheduler.is_running
        
        if was_running:
            scheduler.stop()
        
        # Reinitialize with new config
        new_scheduler = init_backup_scheduler(config)
        
        return BackupOperationResponse(
            success=True,
            message="Backup scheduler configuration updated successfully"
        )
        
    except Exception as e:
        logger.error(f"Failed to configure scheduler: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to configure scheduler: {str(e)}"
        )


@router.post("/cleanup", response_model=BackupOperationResponse)
async def cleanup_old_backups(current_user: User = Depends(get_current_user)):
    """Clean up old backups according to retention policy"""
    try:
        scheduler = get_backup_scheduler()
        initial_count = len(scheduler.backup_history)
        
        scheduler.cleanup_old_backups()
        
        final_count = len(scheduler.backup_history)
        removed_count = initial_count - final_count
        
        return BackupOperationResponse(
            success=True,
            message=f"Cleanup completed: removed {removed_count} old backups, {final_count} backups remaining"
        )
        
    except Exception as e:
        logger.error(f"Failed to cleanup backups: {e}")
        return BackupOperationResponse(
            success=False,
            message=f"Failed to cleanup backups: {str(e)}"
        )


@router.get("/health", response_model=Dict[str, Any])
async def backup_health_check(current_user: User = Depends(get_current_user)):
    """Perform backup system health check"""
    try:
        scheduler = get_backup_scheduler()
        await scheduler.health_check()
        
        return {
            "status": "healthy",
            "message": "Backup system health check passed",
            "timestamp": datetime.now(UTC).isoformat()
        }
        
    except Exception as e:
        logger.error(f"Backup health check failed: {e}")
        return {
            "status": "unhealthy",
            "message": f"Backup system health check failed: {str(e)}",
            "timestamp": datetime.now(UTC).isoformat()
        }