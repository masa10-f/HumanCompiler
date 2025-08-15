"""
Simple Backup API Router
シンプルなバックアップAPI（読み取り専用、ヘルスチェック用）
"""

import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from taskagent_api.auth import get_current_user
from taskagent_api.rate_limiter import limiter
from taskagent_api.simple_backup import get_backup_scheduler

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/backup/status")
@limiter.limit("10 per minute")
async def get_backup_status(request: Request):
    """
    バックアップシステムの状態を取得
    手動バックアップやトリガーは含まない（セキュリティ考慮）
    """
    try:
        # 認証チェックは行わず、読み取り専用のヘルスチェック用途
        scheduler = get_backup_scheduler()
        status = scheduler.get_backup_status()

        # セキュリティのため、パス情報は除去
        if "backup_directory" in status:
            del status["backup_directory"]
        if "latest_backup" in status and status["latest_backup"]:
            if "path" in status["latest_backup"]:
                del status["latest_backup"]["path"]

        return JSONResponse(content=status)

    except Exception as e:
        logger.error(f"Failed to get backup status: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve backup status")


@router.get("/api/backup/health")
@limiter.limit("30 per minute")
async def backup_health_check(request: Request):
    """
    バックアップシステムのシンプルなヘルスチェック
    監視システム用途
    """
    try:
        scheduler = get_backup_scheduler()
        status = scheduler.get_backup_status()

        # シンプルなヘルスチェック情報のみ
        health_status = {
            "backup_system": "operational",
            "has_backups": status["total_backups"] > 0,
            "disk_status": "ok"
            if status.get("disk_usage", {}).get("free_mb", 0) > 100
            else "low",
            "last_check": status.get("latest_backup", {}).get("created_at")
            if status.get("latest_backup")
            else None,
        }

        # ヘルスチェック全体の評価
        overall_health = "healthy"
        if not health_status["has_backups"]:
            overall_health = "warning"
        if health_status["disk_status"] == "low":
            overall_health = "warning"

        health_status["status"] = overall_health

        return JSONResponse(content=health_status)

    except Exception as e:
        logger.error(f"Backup health check failed: {e}")
        return JSONResponse(
            content={"backup_system": "error", "status": "unhealthy", "error": str(e)},
            status_code=503,
        )


@router.get("/api/backup/info")
@limiter.limit("5 per minute")
async def get_backup_info(request: Request):
    """
    バックアップシステムの設定情報（読み取り専用）
    管理用途
    """
    try:
        scheduler = get_backup_scheduler()
        config = scheduler.config

        info = {
            "backup_system": "simple_local_backup",
            "version": "2.0",
            "features": [
                "async_operations",
                "file_validation",
                "audit_logging",
                "disk_space_monitoring",
                "configurable_retention",
            ],
            "configuration": {
                "daily_retention_days": config.daily_retention_days,
                "weekly_retention_days": config.weekly_retention_days,
                "min_disk_space_mb": config.min_disk_space_mb,
                "max_worker_threads": config.max_worker_threads,
                "audit_log_enabled": config.enable_audit_log,
            },
            "note": "Manual backups should be triggered via cron jobs for security",
        }

        return JSONResponse(content=info)

    except Exception as e:
        logger.error(f"Failed to get backup info: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve backup information"
        )
