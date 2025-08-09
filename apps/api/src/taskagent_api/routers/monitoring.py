"""Performance monitoring endpoints for TaskAgent"""

import hmac
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import get_db
from taskagent_api.models import User
from taskagent_api.performance_monitor import performance_monitor

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


def get_current_admin_user(
    current_user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> User:
    """Verify current user has admin privileges

    Temporary implementation using config admin_user_ids until User model has is_admin field.
    """
    from taskagent_api.config import settings

    # Check if user is in admin list using constant-time comparison to prevent timing attacks
    if not any(
        hmac.compare_digest(current_user_id, admin_id)
        for admin_id in settings.admin_user_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required to access performance metrics.",
        )

    # Get user from database
    user = db.get(User, current_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


@router.get("/performance", response_model=dict[str, Any])
async def get_performance_metrics(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Get database performance metrics

    **SECURITY WARNING**: This endpoint exposes sensitive database performance data
    including query patterns, table statistics, and system internals that could be
    used to identify vulnerabilities or plan attacks.

    In production, you MUST:
    1. Consider rate limiting these endpoints
    2. Log access to monitoring endpoints
    3. Potentially restrict to internal network only
    """

    try:
        report = performance_monitor.generate_performance_report(db)
        return report
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate performance report: {str(e)}"
        )


@router.get("/performance/queries", response_model=dict[str, Any])
async def get_query_statistics(
    current_user: User = Depends(get_current_admin_user),
) -> dict[str, Any]:
    """Get query performance statistics

    **SECURITY WARNING**: Exposes actual SQL queries which may reveal database schema
    """
    return {
        "statistics": performance_monitor.get_query_statistics(),
        "slowest_queries": performance_monitor.get_slowest_queries(10),
    }


@router.get("/performance/connections", response_model=dict[str, Any])
async def get_connection_pool_stats(
    current_user: User = Depends(get_current_admin_user),
) -> dict[str, Any]:
    """Get connection pool statistics"""
    return performance_monitor.get_connection_pool_stats()


@router.get("/performance/indexes", response_model=dict[str, Any])
async def get_index_analysis(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Analyze index usage and recommendations"""
    return {
        "index_usage": performance_monitor.analyze_index_usage(db),
        "missing_indexes": performance_monitor.check_missing_indexes(db),
    }


@router.get("/performance/tables", response_model=dict[str, Any])
async def get_table_statistics(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get table-level statistics"""
    return {"tables": performance_monitor.get_table_statistics(db)}


@router.post("/performance/reset")
async def reset_performance_metrics(
    current_admin: User = Depends(get_current_admin_user),
    confirm: bool = False,
) -> dict[str, str]:
    """Reset performance metrics (clears query history)

    Only admins can perform this operation. Requires confirmation.
    """
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation required to reset performance metrics. Pass confirm=true.",
        )

    performance_monitor.query_stats.clear()
    return {"message": "Performance metrics reset successfully"}
