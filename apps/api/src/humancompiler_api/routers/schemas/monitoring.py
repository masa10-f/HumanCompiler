"""Pydantic schemas for monitoring endpoints."""

from datetime import datetime

from pydantic import BaseModel


class QueryStatEntry(BaseModel):
    """Single query statistics entry."""

    query: str
    duration_ms: float
    timestamp: datetime
    parameters: str | None


class QueryStatistics(BaseModel):
    """Aggregated query statistics."""

    total_queries: int
    avg_duration_ms: float
    max_duration_ms: float
    min_duration_ms: float | None = None
    slow_queries_count: int
    slow_query_percentage: float | None = None


class ConnectionPoolStats(BaseModel):
    """Connection pool statistics."""

    total_connections: int
    active_connections: int
    idle_connections: int
    overflow_connections: int


class IndexUsageEntry(BaseModel):
    """Index usage analysis entry."""

    schema_name: str
    table: str
    index: str
    scans: int
    tuples_read: int
    tuples_fetched: int
    size: str

    class Config:
        """Pydantic config for field aliasing."""

        populate_by_name = True

    def __init__(self, **data):
        # Handle 'schema' key from database query
        if "schema" in data:
            data["schema_name"] = data.pop("schema")
        super().__init__(**data)


class TableStatisticsEntry(BaseModel):
    """Table statistics entry."""

    schema_name: str
    table: str
    live_tuples: int
    dead_tuples: int
    inserts: int
    updates: int
    deletes: int
    hot_updates: int
    total_size: str

    class Config:
        """Pydantic config for field aliasing."""

        populate_by_name = True

    def __init__(self, **data):
        # Handle 'schema' key from database query
        if "schema" in data:
            data["schema_name"] = data.pop("schema")
        super().__init__(**data)


class MissingIndexEntry(BaseModel):
    """Missing index recommendation entry."""

    schema_name: str
    table: str
    seq_scans: int
    tuples_read_seq: int
    index_scans: int | None
    index_usage_percent: float
    recommendation: str

    class Config:
        """Pydantic config for field aliasing."""

        populate_by_name = True

    def __init__(self, **data):
        # Handle 'schema' key from database query
        if "schema" in data:
            data["schema_name"] = data.pop("schema")
        super().__init__(**data)


class PerformanceReportResponse(BaseModel):
    """Full performance report response."""

    timestamp: str
    query_statistics: QueryStatistics
    slowest_queries: list[QueryStatEntry]
    connection_pool: ConnectionPoolStats
    index_usage: list[IndexUsageEntry] | None = None
    table_statistics: list[TableStatisticsEntry] | None = None
    missing_indexes: list[MissingIndexEntry] | None = None


class QueryStatisticsResponse(BaseModel):
    """Query statistics response."""

    statistics: QueryStatistics
    slowest_queries: list[QueryStatEntry]


class ConnectionPoolStatsResponse(BaseModel):
    """Connection pool statistics response."""

    total_connections: int
    active_connections: int
    idle_connections: int
    overflow_connections: int


class IndexAnalysisResponse(BaseModel):
    """Index analysis response."""

    index_usage: list[IndexUsageEntry]
    missing_indexes: list[MissingIndexEntry]


class TableStatisticsResponse(BaseModel):
    """Table statistics response."""

    tables: list[TableStatisticsEntry]
