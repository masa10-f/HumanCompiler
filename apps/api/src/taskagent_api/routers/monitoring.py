"""Performance monitoring endpoints for TaskAgent"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import get_db
from taskagent_api.models import User
from taskagent_api.performance_monitor import performance_monitor

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


# TODO: Implement admin authorization when User model has is_admin field
# def get_current_admin_user(
#     current_user_id: str = Depends(get_current_user_id),
#     db: Session = Depends(get_db),
# ) -> User:
#     """Verify current user has admin privileges"""
#     user = db.get(User, current_user_id)
#     if not user or not getattr(user, "is_admin", False):
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="Admin privileges required to access performance metrics.",
#         )
#     return user


@router.get("/performance", response_model=dict[str, Any])
async def get_performance_metrics(
    current_user: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Get database performance metrics

    **SECURITY WARNING**: This endpoint exposes sensitive database performance data
    including query patterns, table statistics, and system internals that could be
    used to identify vulnerabilities or plan attacks.

    TODO: Replace get_current_user_id with get_current_admin_user when admin field is available.

    In production, you MUST:
    1. Implement proper admin authorization
    2. Consider rate limiting these endpoints
    3. Log access to monitoring endpoints
    4. Potentially restrict to internal network only
    """
    # CRITICAL SECURITY WARNING: Currently ANY authenticated user can access these metrics!
    # This is a security risk in production environments

    try:
        report = performance_monitor.generate_performance_report(db)
        return report
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate performance report: {str(e)}"
        )


@router.get("/performance/queries", response_model=dict[str, Any])
async def get_query_statistics(
    current_user: str = Depends(get_current_user_id),
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
    current_user: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Get connection pool statistics"""
    return performance_monitor.get_connection_pool_stats()


@router.get("/performance/indexes", response_model=dict[str, Any])
async def get_index_analysis(
    current_user: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Analyze index usage and recommendations"""
    return {
        "index_usage": performance_monitor.analyze_index_usage(db),
        "missing_indexes": performance_monitor.check_missing_indexes(db),
    }


@router.get("/performance/tables", response_model=dict[str, Any])
async def get_table_statistics(
    current_user: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get table-level statistics"""
    return {"tables": performance_monitor.get_table_statistics(db)}


@router.post("/performance/reset")
async def reset_performance_metrics(
    current_user: str = Depends(get_current_user_id),
) -> dict[str, str]:
    """Reset performance metrics (clears query history)"""
    performance_monitor.query_stats.clear()
    return {"message": "Performance metrics reset successfully"}
