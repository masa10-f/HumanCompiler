"""Performance monitoring endpoints for TaskAgent"""

import hmac

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.database import get_db
from humancompiler_api.models import User
from humancompiler_api.performance_monitor import performance_monitor
from humancompiler_api.routers.schemas.monitoring import (
    ConnectionPoolStatsResponse,
    IndexAnalysisResponse,
    IndexUsageEntry,
    MissingIndexEntry,
    PerformanceReportResponse,
    QueryStatEntry,
    QueryStatistics,
    QueryStatisticsResponse,
    TableStatisticsEntry,
    TableStatisticsResponse,
)

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


def get_current_admin_user(
    current_user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> User:
    """Verify current user has admin privileges

    Temporary implementation using config admin_user_ids until User model has is_admin field.
    """
    from humancompiler_api.config import settings

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


@router.get("/performance", response_model=PerformanceReportResponse)
async def get_performance_metrics(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> PerformanceReportResponse:
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
        # Convert dict response to Pydantic model
        return PerformanceReportResponse(
            timestamp=report.get("timestamp", ""),
            query_statistics=QueryStatistics(**report.get("query_statistics", {})),
            slowest_queries=[
                QueryStatEntry(**q) for q in report.get("slowest_queries", [])
            ],
            connection_pool=report.get("connection_pool", {}),
            index_usage=[IndexUsageEntry(**i) for i in report.get("index_usage", [])]
            if report.get("index_usage")
            else None,
            table_statistics=[
                TableStatisticsEntry(**t) for t in report.get("table_statistics", [])
            ]
            if report.get("table_statistics")
            else None,
            missing_indexes=[
                MissingIndexEntry(**m) for m in report.get("missing_indexes", [])
            ]
            if report.get("missing_indexes")
            else None,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate performance report: {str(e)}"
        )


@router.get("/performance/queries", response_model=QueryStatisticsResponse)
async def get_query_statistics(
    current_user: User = Depends(get_current_admin_user),
) -> QueryStatisticsResponse:
    """Get query performance statistics

    **SECURITY WARNING**: Exposes actual SQL queries which may reveal database schema
    """
    stats = performance_monitor.get_query_statistics()
    slowest = performance_monitor.get_slowest_queries(10)
    return QueryStatisticsResponse(
        statistics=QueryStatistics(**stats),
        slowest_queries=[QueryStatEntry(**q) for q in slowest],
    )


@router.get("/performance/connections", response_model=ConnectionPoolStatsResponse)
async def get_connection_pool_stats(
    current_user: User = Depends(get_current_admin_user),
) -> ConnectionPoolStatsResponse:
    """Get connection pool statistics"""
    stats = performance_monitor.get_connection_pool_stats()
    return ConnectionPoolStatsResponse(**stats)


@router.get("/performance/indexes", response_model=IndexAnalysisResponse)
async def get_index_analysis(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> IndexAnalysisResponse:
    """Analyze index usage and recommendations"""
    index_usage = performance_monitor.analyze_index_usage(db)
    missing_indexes = performance_monitor.check_missing_indexes(db)
    return IndexAnalysisResponse(
        index_usage=[IndexUsageEntry(**i) for i in index_usage],
        missing_indexes=[MissingIndexEntry(**m) for m in missing_indexes],
    )


@router.get("/performance/tables", response_model=TableStatisticsResponse)
async def get_table_statistics(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> TableStatisticsResponse:
    """Get table-level statistics"""
    tables = performance_monitor.get_table_statistics(db)
    return TableStatisticsResponse(
        tables=[TableStatisticsEntry(**t) for t in tables],
    )


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
