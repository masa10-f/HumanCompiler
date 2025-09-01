"""
Data Export/Import API Router
ユーザーデータのJSONエクスポート・インポート機能

Issue #131: JSONデータのエクスポート機能
"""

import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session, col

from humancompiler_api.auth import get_current_user, AuthUser
from humancompiler_api.database import db
from humancompiler_api.rate_limiter import limiter
from humancompiler_api.safe_migration import DataBackupManager, SafeMigrationError

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/export/user-data")
@limiter.limit("5 per minute")
async def export_user_data(
    request: Request,
    current_user: AuthUser = Depends(get_current_user),
    db_session: Session = Depends(db.get_session),
) -> FileResponse:
    """
    Export all user data as a JSON file for backup purposes
    認証ユーザーの全データをJSONファイルとしてエクスポート
    """
    try:
        logger.info(f"Starting data export for user: {current_user.user_id}")

        # Create backup manager
        backup_manager = DataBackupManager()

        # Create user-specific backup
        backup_path = backup_manager.create_user_backup(
            user_id=current_user.user_id,
            backup_name=f"user_export_{current_user.user_id}",
        )

        # Prepare file for download
        file_path = Path(backup_path)
        if not file_path.exists():
            raise HTTPException(status_code=500, detail="Failed to create export file")

        # Generate download filename
        download_filename = f"taskagent_data_export_{current_user.user_id}.json"

        logger.info(f"Export successful for user {current_user.user_id}: {backup_path}")

        # Return file as download
        return FileResponse(
            path=backup_path,
            filename=download_filename,
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={download_filename}",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )

    except SafeMigrationError as e:
        logger.error(
            f"Safe migration error during export for user {current_user.user_id}: {e}"
        )
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
    except Exception as e:
        logger.error(
            f"Unexpected error during export for user {current_user.user_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail="An unexpected error occurred during export"
        )


@router.post("/api/import/user-data")
@limiter.limit("3 per minute")
async def import_user_data(
    request: Request,
    file: UploadFile = File(...),
    current_user: AuthUser = Depends(get_current_user),
    db_session: Session = Depends(db.get_session),
) -> JSONResponse:
    """
    Import user data from a JSON backup file
    JSONバックアップファイルからユーザーデータをインポート
    """
    try:
        logger.info(f"Starting data import for user: {current_user.user_id}")

        # Validate file type
        if not file.filename or not file.filename.endswith(".json"):
            raise HTTPException(
                status_code=400, detail="Only JSON files are allowed for import"
            )

        # Check file size (limit to 10MB)
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

        # Read file content
        file_content = await file.read()

        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="File size too large. Maximum allowed size is 10MB",
            )

        # Create temporary file
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".json", delete=False
        ) as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name

        try:
            # Validate JSON content
            import json

            try:
                with open(temp_file_path, encoding="utf-8") as f:
                    json_data = json.load(f)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=400, detail=f"Invalid JSON format: {str(e)}"
                )

            # Basic validation of backup structure
            metadata = json_data.get("metadata", {})
            if metadata.get("backup_type") != "user_specific":
                raise HTTPException(
                    status_code=400,
                    detail="Invalid backup file format. Only user-specific backups are supported for import.",
                )

            # Check required sections
            required_sections = ["users", "projects", "goals", "tasks", "metadata"]
            missing_sections = [
                section for section in required_sections if section not in json_data
            ]
            if missing_sections:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid backup file. Missing sections: {', '.join(missing_sections)}",
                )

            # Create backup manager and restore data
            backup_manager = DataBackupManager()
            backup_manager.restore_user_data(
                backup_path=temp_file_path, target_user_id=current_user.user_id
            )

            # Count imported records
            total_records = metadata.get("total_records", {})
            imported_counts = {
                "projects": total_records.get("projects", 0),
                "goals": total_records.get("goals", 0),
                "tasks": total_records.get("tasks", 0),
                "schedules": total_records.get("schedules", 0),
                "weekly_schedules": total_records.get("weekly_schedules", 0),
                "weekly_recurring_tasks": total_records.get(
                    "weekly_recurring_tasks", 0
                ),
                "logs": total_records.get("logs", 0),
                "user_settings": total_records.get("user_settings", 0),
                "goal_dependencies": total_records.get("goal_dependencies", 0),
                "task_dependencies": total_records.get("task_dependencies", 0),
            }

            logger.info(f"Import successful for user {current_user.user_id}")
            logger.info(f"Imported records: {imported_counts}")

            return JSONResponse(
                content={
                    "message": "Data import completed successfully",
                    "imported_records": imported_counts,
                    "import_date": metadata.get("created_at"),
                    "source_user_id": metadata.get("user_id"),
                },
                status_code=200,
            )

        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_file_path)
            except OSError:
                logger.warning(f"Failed to delete temporary file: {temp_file_path}")

    except SafeMigrationError as e:
        logger.error(
            f"Safe migration error during import for user {current_user.user_id}: {e}"
        )
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error during import for user {current_user.user_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail="An unexpected error occurred during import"
        )


@router.get("/api/export/info")
@limiter.limit("10 per minute")
async def get_export_info(
    request: Request,
    current_user: AuthUser = Depends(get_current_user),
    db_session: Session = Depends(db.get_session),
) -> JSONResponse:
    """
    Get information about the export/import feature
    エクスポート・インポート機能の情報を取得
    """
    try:
        # Count user's current data
        from sqlmodel import select
        from humancompiler_api.models import (
            Project,
            Goal,
            Task,
            Schedule,
            WeeklySchedule,
        )

        with db_session:
            # Count projects
            projects_count = len(
                db_session.exec(
                    select(Project).where(Project.owner_id == current_user.user_id)
                ).all()
            )

            # Count goals
            if projects_count > 0:
                project_ids = [
                    p.id
                    for p in db_session.exec(
                        select(Project).where(Project.owner_id == current_user.user_id)
                    ).all()
                ]
                if project_ids:
                    goals_count = len(
                        db_session.exec(
                            select(Goal).where(col(Goal.project_id).in_(project_ids))
                        ).all()
                    )
                else:
                    goals_count = 0
            else:
                goals_count = 0

            # Count tasks
            if goals_count > 0:
                if projects_count > 0 and project_ids:
                    goal_ids = [
                        g.id
                        for g in db_session.exec(
                            select(Goal).where(col(Goal.project_id).in_(project_ids))
                        ).all()
                    ]
                else:
                    goal_ids = []
                if goal_ids:
                    tasks_count = len(
                        db_session.exec(
                            select(Task).where(col(Task.goal_id).in_(goal_ids))
                        ).all()
                    )
                else:
                    tasks_count = 0
            else:
                tasks_count = 0

            # Count schedules
            schedules_count = len(
                db_session.exec(
                    select(Schedule).where(Schedule.user_id == current_user.user_id)
                ).all()
            )

            # Count weekly schedules
            weekly_schedules_count = len(
                db_session.exec(
                    select(WeeklySchedule).where(
                        WeeklySchedule.user_id == current_user.user_id
                    )
                ).all()
            )

        info = {
            "export_feature": {
                "description": "Export all your TaskAgent data as a JSON backup file",
                "supported_data": [
                    "Projects and goals",
                    "Tasks and task dependencies",
                    "Schedules and weekly schedules",
                    "Weekly recurring tasks",
                    "Task logs and progress data",
                    "User settings",
                    "API usage history",
                ],
                "format": "JSON",
                "rate_limit": "5 exports per minute",
            },
            "import_feature": {
                "description": "Import data from a TaskAgent JSON backup file",
                "notes": [
                    "Only user-specific backup files are supported",
                    "Data will be merged with existing data (no overwrites)",
                    "New UUIDs will be generated to avoid conflicts",
                    "Maximum file size: 10MB",
                ],
                "rate_limit": "3 imports per minute",
            },
            "current_data_summary": {
                "projects": projects_count,
                "goals": goals_count,
                "tasks": tasks_count,
                "schedules": schedules_count,
                "weekly_schedules": weekly_schedules_count,
            },
            "security": {
                "authentication": "Required - only authenticated users can export/import their own data",
                "data_isolation": "Users can only export/import their own data",
                "file_validation": "JSON structure and content validation before import",
            },
        }

        return JSONResponse(content=info)

    except Exception as e:
        logger.error(f"Error getting export info for user {current_user.user_id}: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to retrieve export information"
        )
