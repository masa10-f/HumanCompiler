"""Performance monitoring endpoints for TaskAgent"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from taskagent_api.auth import get_current_user_id
from taskagent_api.database import get_db
from taskagent_api.models import User
from taskagent_api.performance_monitor import performance_monitor

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/performance", response_model=dict[str, Any])
async def get_performance_metrics(
    current_user: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Get database performance metrics

    Note: This endpoint is restricted to admin users in production
    """
    # In production, you should check if the user is an admin
    # For now, we'll allow any authenticated user to view metrics

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
    """Get query performance statistics"""
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
