"""
Caching module for TaskAgent API
Provides TTL-based in-memory caching with configurable strategies
"""

from typing import Any, Optional, TypeVar, Union
from collections.abc import Awaitable
from collections.abc import Callable
from functools import wraps
import hashlib
import json
import asyncio
from datetime import datetime, timedelta
from cachetools import TTLCache
from cachetools.keys import hashkey
import logging

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Global cache instances with different TTL configurations
caches = {
    "short": TTLCache(maxsize=500, ttl=60),  # 1 minute TTL for frequently changing data
    "medium": TTLCache(maxsize=200, ttl=300),  # 5 minutes TTL for user data
    "long": TTLCache(maxsize=100, ttl=3600),  # 1 hour TTL for AI responses
    "extended": TTLCache(maxsize=50, ttl=900),  # 15 minutes TTL for analysis results
}


def get_cache_key(prefix: str, *args, **kwargs) -> str:
    """
    Generate a consistent cache key from prefix and arguments
    """
    key_parts = [prefix]

    # Add positional arguments
    for arg in args:
        if isinstance(arg, str | int | float | bool):
            key_parts.append(str(arg))
        elif hasattr(arg, "id"):
            key_parts.append(f"{arg.__class__.__name__}:{arg.id}")
        else:
            # For complex objects, use hash (not for security)
            key_parts.append(
                hashlib.md5(str(arg).encode(), usedforsecurity=False).hexdigest()[:8]
            )

    # Add keyword arguments
    for k, v in sorted(kwargs.items()):
        if isinstance(v, str | int | float | bool):
            key_parts.append(f"{k}:{v}")
        else:
            key_parts.append(
                f"{k}:{hashlib.md5(str(v).encode(), usedforsecurity=False).hexdigest()[:8]}"
            )

    return ":".join(key_parts)


def cached(
    cache_type: str = "medium",
    key_prefix: str | None = None,
    condition: Callable[..., bool] | None = None,
):
    """
    Decorator for caching function results

    Args:
        cache_type: Type of cache to use ('short', 'medium', 'long', 'extended')
        key_prefix: Custom prefix for cache key (defaults to function name)
        condition: Optional function to determine if result should be cached
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def async_wrapper(*args, **kwargs) -> Any:
            # Skip caching if condition is False
            if condition and not condition(*args, **kwargs):
                # Type: ignore because we know func is async
                result = func(*args, **kwargs)  # type: ignore
                if asyncio.iscoroutine(result):
                    return await result
                return result

            # Generate cache key
            prefix = key_prefix or f"{func.__module__}.{func.__name__}"
            cache_key = get_cache_key(prefix, *args, **kwargs)

            # Get cache instance
            cache = caches.get(cache_type, caches["medium"])

            # Check cache
            if cache_key in cache:
                logger.debug(f"Cache hit for {cache_key}")
                return cache[cache_key]

            # Execute function and cache result
            logger.debug(f"Cache miss for {cache_key}")
            # Type: ignore because we know func is async
            result = func(*args, **kwargs)  # type: ignore
            if asyncio.iscoroutine(result):
                result = await result

            # Store in cache if not None
            if result is not None:
                cache[cache_key] = result
                logger.debug(f"Cached result for {cache_key}")

            return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs) -> Any:
            # Skip caching if condition is False
            if condition and not condition(*args, **kwargs):
                return func(*args, **kwargs)

            # Generate cache key
            prefix = key_prefix or f"{func.__module__}.{func.__name__}"
            cache_key = get_cache_key(prefix, *args, **kwargs)

            # Get cache instance
            cache = caches.get(cache_type, caches["medium"])

            # Check cache
            if cache_key in cache:
                logger.debug(f"Cache hit for {cache_key}")
                return cache[cache_key]

            # Execute function and cache result
            logger.debug(f"Cache miss for {cache_key}")
            result = func(*args, **kwargs)

            # Store in cache if not None
            if result is not None:
                cache[cache_key] = result
                logger.debug(f"Cached result for {cache_key}")

            return result

        # Return appropriate wrapper based on function type
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


def invalidate_cache(cache_type: str = "all", pattern: str | None = None):
    """
    Invalidate cache entries

    Args:
        cache_type: Type of cache to invalidate ('all' for all caches)
        pattern: Optional pattern to match keys for selective invalidation
    """
    if cache_type == "all":
        target_caches = caches.values()
    else:
        target_caches = [caches.get(cache_type, caches["medium"])]

    for cache in target_caches:
        if pattern:
            # Selective invalidation
            keys_to_delete = [k for k in cache.keys() if pattern in str(k)]
            for key in keys_to_delete:
                del cache[key]
                logger.debug(f"Invalidated cache key: {key}")
        else:
            # Clear entire cache
            cache.clear()
            logger.debug(f"Cleared cache: {cache_type}")


def cache_stats() -> dict:
    """
    Get cache statistics
    """
    stats = {}
    for name, cache in caches.items():
        stats[name] = {
            "size": len(cache),
            "maxsize": cache.maxsize,
            "ttl": cache.ttl,
            "utilization": f"{(len(cache) / cache.maxsize * 100):.1f}%",
        }
    return stats


class CacheManager:
    """
    Context manager for automatic cache invalidation
    """

    def __init__(self, invalidate_on_success: bool = True, cache_types: list = None):
        self.invalidate_on_success = invalidate_on_success
        self.cache_types = cache_types or ["short", "medium"]
        self.success = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.success and self.invalidate_on_success:
            for cache_type in self.cache_types:
                invalidate_cache(cache_type)

    def mark_success(self):
        self.success = True
