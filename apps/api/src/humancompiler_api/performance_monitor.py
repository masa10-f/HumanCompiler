"""Database performance monitoring for TaskAgent"""

import logging
import re
import time
from collections import deque
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import Pool
from sqlmodel import Session

logger = logging.getLogger(__name__)


class PerformanceMonitor:
    """Monitor and log database performance metrics"""

    def __init__(
        self,
        slow_query_threshold_ms: int | None = None,
        max_query_stats: int | None = None,
    ):
        # Get from settings or use defaults
        from humancompiler_api.config import settings

        if slow_query_threshold_ms is not None:
            self.slow_query_threshold_ms = slow_query_threshold_ms
        else:
            self.slow_query_threshold_ms = getattr(
                settings, "slow_query_threshold_ms", 100
            )

        if max_query_stats is not None:
            self.max_query_stats = max_query_stats
        else:
            self.max_query_stats = getattr(settings, "max_query_stats", 1000)

        # Use deque with maxlen for O(1) append operations and automatic size management
        self.query_stats: deque[dict[str, Any]] = deque(maxlen=self.max_query_stats)
        self.connection_stats = {
            "total_connections": 0,
            "active_connections": 0,
            "idle_connections": 0,
            "overflow_connections": 0,
        }

    def setup_listeners(self, engine: Engine):
        """Setup SQLAlchemy event listeners for performance monitoring"""

        # Monitor query execution time
        @event.listens_for(Engine, "before_cursor_execute", once=False)
        def before_cursor_execute(
            conn, cursor, statement, parameters, context, executemany
        ):
            conn.info.setdefault("query_start_time", []).append(time.time())
            conn.info.setdefault("current_query", []).append(statement)

        @event.listens_for(Engine, "after_cursor_execute", once=False)
        def after_cursor_execute(
            conn, cursor, statement, parameters, context, executemany
        ):
            total_time = time.time() - conn.info["query_start_time"].pop(-1)
            query = conn.info["current_query"].pop(-1)

            # Convert to milliseconds
            duration_ms = total_time * 1000

            # Log slow queries
            if duration_ms > self.slow_query_threshold_ms:
                logger.warning(
                    f"Slow query detected ({duration_ms:.2f}ms): {query[:100]}..."
                )

            # Store query stats with sanitized parameters
            # deque with maxlen automatically handles size management - no need to manually trim
            self.query_stats.append(
                {
                    "query": query,
                    "duration_ms": duration_ms,
                    "timestamp": datetime.utcnow(),
                    "parameters": self._sanitize_parameters(parameters),
                }
            )

        # Monitor connection pool
        @event.listens_for(Pool, "connect", once=False)
        def on_connect(dbapi_conn, connection_record):
            self.connection_stats["total_connections"] += 1
            logger.debug("New database connection established")

        @event.listens_for(Pool, "checkout", once=False)
        def on_checkout(dbapi_conn, connection_record, connection_proxy):
            self.connection_stats["active_connections"] += 1
            self.connection_stats["idle_connections"] -= 1

        @event.listens_for(Pool, "checkin", once=False)
        def on_checkin(dbapi_conn, connection_record):
            self.connection_stats["active_connections"] -= 1
            self.connection_stats["idle_connections"] += 1

        logger.info("Performance monitoring listeners configured")

    def _sanitize_parameters(self, parameters: Any) -> str | None:
        """Sanitize SQL parameters to prevent sensitive data exposure"""
        if not parameters:
            return None

        # Convert parameters to string
        param_str = str(parameters)

        # List of patterns that might indicate sensitive data
        sensitive_patterns = [
            "password",
            "secret",
            "token",
            "api_key",
            "apikey",
            "auth",
            "credential",
            "private",
            "ssn",
        ]

        # Check if parameters might contain sensitive data
        param_lower = param_str.lower()
        has_sensitive_pattern = any(
            pattern in param_lower for pattern in sensitive_patterns
        )
        if has_sensitive_pattern:
            return "[SANITIZED - possibly contains sensitive data]"

        # Check for actual email addresses using regex pattern
        email_pattern = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        email_match = re.search(email_pattern, param_str)
        if email_match is not None:
            return "[SANITIZED - contains email address]"

        # Truncate long parameters
        if len(param_str) > 100:
            return param_str[:100] + "..."

        return param_str

    @contextmanager
    def monitor_operation(self, operation_name: str):
        """Context manager to monitor a specific operation"""
        start_time = time.time()
        logger.debug(f"Starting operation: {operation_name}")

        try:
            yield
        finally:
            duration_ms = (time.time() - start_time) * 1000
            logger.info(
                f"Operation '{operation_name}' completed in {duration_ms:.2f}ms"
            )

    def get_query_statistics(self) -> dict[str, Any]:
        """Get aggregated query statistics"""
        if not self.query_stats:
            return {
                "total_queries": 0,
                "avg_duration_ms": 0,
                "max_duration_ms": 0,
                "slow_queries_count": 0,
            }

        durations = [q["duration_ms"] for q in self.query_stats]
        slow_queries = [
            q
            for q in self.query_stats
            if q["duration_ms"] > self.slow_query_threshold_ms
        ]

        return {
            "total_queries": len(self.query_stats),
            "avg_duration_ms": sum(durations) / len(durations),
            "max_duration_ms": max(durations),
            "min_duration_ms": min(durations),
            "slow_queries_count": len(slow_queries),
            "slow_query_percentage": (len(slow_queries) / len(self.query_stats)) * 100,
        }

    def get_slowest_queries(self, limit: int = 10) -> list[dict[str, Any]]:
        """Get the slowest queries"""
        sorted_queries = sorted(
            self.query_stats, key=lambda x: x["duration_ms"], reverse=True
        )
        return sorted_queries[:limit]

    def get_connection_pool_stats(self) -> dict[str, Any]:
        """Get connection pool statistics"""
        return self.connection_stats.copy()

    def analyze_index_usage(self, session: Session) -> list[dict[str, Any]]:
        """Analyze index usage (PostgreSQL specific)"""
        # Check if we're using PostgreSQL
        if "postgresql" not in str(session.bind.dialect.name).lower():
            return []

        query = text("""
            SELECT
                schemaname,
                tablename,
                indexname,
                idx_scan as index_scans,
                idx_tup_read as tuples_read,
                idx_tup_fetch as tuples_fetched,
                pg_size_pretty(pg_relation_size(indexrelid)) as index_size
            FROM pg_stat_user_indexes
            WHERE schemaname = 'public'
            ORDER BY idx_scan DESC
        """)

        try:
            result = session.exec(query)
            return [
                {
                    "schema": row[0],
                    "table": row[1],
                    "index": row[2],
                    "scans": row[3],
                    "tuples_read": row[4],
                    "tuples_fetched": row[5],
                    "size": row[6],
                }
                for row in result
            ]
        except Exception as e:
            logger.error(f"Failed to analyze index usage: {e}")
            return []

    def get_table_statistics(self, session: Session) -> list[dict[str, Any]]:
        """Get table statistics (PostgreSQL specific)"""
        if "postgresql" not in str(session.bind.dialect.name).lower():
            return []

        query = text("""
            SELECT
                schemaname,
                tablename,
                n_live_tup as live_tuples,
                n_dead_tup as dead_tuples,
                n_tup_ins as inserts,
                n_tup_upd as updates,
                n_tup_del as deletes,
                n_tup_hot_upd as hot_updates,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
            ORDER BY n_live_tup DESC
        """)

        try:
            result = session.exec(query)
            return [
                {
                    "schema": row[0],
                    "table": row[1],
                    "live_tuples": row[2],
                    "dead_tuples": row[3],
                    "inserts": row[4],
                    "updates": row[5],
                    "deletes": row[6],
                    "hot_updates": row[7],
                    "total_size": row[8],
                }
                for row in result
            ]
        except Exception as e:
            logger.error(f"Failed to get table statistics: {e}")
            return []

    def check_missing_indexes(self, session: Session) -> list[dict[str, Any]]:
        """Check for potentially missing indexes based on query patterns"""
        if "postgresql" not in str(session.bind.dialect.name).lower():
            return []

        # This query finds tables with sequential scans but no index scans
        query = text("""
            SELECT
                schemaname,
                tablename,
                seq_scan,
                seq_tup_read,
                idx_scan,
                CASE
                    WHEN seq_scan > 0 THEN
                        ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 2)
                    ELSE 100
                END as index_usage_percent
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
                AND seq_scan > 100  -- Ignore tables with few scans
                AND (idx_scan IS NULL OR idx_scan < seq_scan * 0.1)  -- Less than 10% index usage
            ORDER BY seq_tup_read DESC
        """)

        try:
            result = session.exec(query)
            missing_indexes = []
            for row in result:
                missing_indexes.append(
                    {
                        "schema": row[0],
                        "table": row[1],
                        "seq_scans": row[2],
                        "tuples_read_seq": row[3],
                        "index_scans": row[4] or 0,
                        "index_usage_percent": row[5],
                        "recommendation": f"Consider adding indexes to {row[1]} table",
                    }
                )
            return missing_indexes
        except Exception as e:
            logger.error(f"Failed to check missing indexes: {e}")
            return []

    def generate_performance_report(
        self, session: Session | None = None
    ) -> dict[str, Any]:
        """Generate a comprehensive performance report"""
        report = {
            "timestamp": datetime.utcnow().isoformat(),
            "query_statistics": self.get_query_statistics(),
            "slowest_queries": self.get_slowest_queries(5),
            "connection_pool": self.get_connection_pool_stats(),
        }

        if session:
            report["index_usage"] = self.analyze_index_usage(session)
            report["table_statistics"] = self.get_table_statistics(session)
            report["missing_indexes"] = self.check_missing_indexes(session)

        return report

    def log_performance_summary(self):
        """Log a performance summary"""
        stats = self.get_query_statistics()
        logger.info(
            f"Performance Summary: "
            f"Total queries: {stats['total_queries']}, "
            f"Avg duration: {stats['avg_duration_ms']:.2f}ms, "
            f"Slow queries: {stats['slow_queries_count']} ({stats.get('slow_query_percentage', 0):.1f}%)"
        )


# Global performance monitor instance
performance_monitor = PerformanceMonitor()
