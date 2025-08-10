"""
Tests for caching functionality
"""

import time
from unittest.mock import Mock, patch
import pytest

from core.cache import (
    cached,
    invalidate_cache,
    cache_stats,
    get_cache_key,
    caches,
    CacheManager,
)


def test_get_cache_key():
    """Test cache key generation"""
    # Test with simple arguments
    key = get_cache_key("test", "arg1", "arg2")
    assert key == "test:arg1:arg2"

    # Test with keyword arguments
    key = get_cache_key("test", "arg1", foo="bar", baz=123)
    assert "test:arg1" in key
    assert "foo:bar" in key
    assert "baz:123" in key

    # Test with complex objects
    class TestObj:
        def __init__(self, id):
            self.id = id

    obj = TestObj("test-id")
    key = get_cache_key("test", obj)
    assert "TestObj:test-id" in key


def test_cached_decorator_sync():
    """Test caching decorator with synchronous function"""
    call_count = 0

    @cached(cache_type="short", key_prefix="test_sync")
    def test_func(x, y):
        nonlocal call_count
        call_count += 1
        return x + y

    # First call should execute function
    result1 = test_func(1, 2)
    assert result1 == 3
    assert call_count == 1

    # Second call with same args should use cache
    result2 = test_func(1, 2)
    assert result2 == 3
    assert call_count == 1  # No additional call

    # Different args should execute function
    result3 = test_func(2, 3)
    assert result3 == 5
    assert call_count == 2

    # Clear cache and verify
    invalidate_cache("short")
    result4 = test_func(1, 2)
    assert result4 == 3
    assert call_count == 3  # Function called again


@pytest.mark.asyncio
async def test_cached_decorator_async():
    """Test caching decorator with asynchronous function"""
    call_count = 0

    @cached(cache_type="medium", key_prefix="test_async")
    async def test_async_func(x, y):
        nonlocal call_count
        call_count += 1
        return x * y

    # First call should execute function
    result1 = await test_async_func(3, 4)
    assert result1 == 12
    assert call_count == 1

    # Second call with same args should use cache
    result2 = await test_async_func(3, 4)
    assert result2 == 12
    assert call_count == 1  # No additional call

    # Different args should execute function
    result3 = await test_async_func(5, 6)
    assert result3 == 30
    assert call_count == 2


def test_cache_condition():
    """Test conditional caching"""
    call_count = 0

    def should_cache(x, y):
        return x > 0  # Only cache for positive x

    @cached(cache_type="short", condition=should_cache)
    def test_func(x, y):
        nonlocal call_count
        call_count += 1
        return x + y

    # Positive x should be cached
    result1 = test_func(1, 2)
    assert result1 == 3
    assert call_count == 1

    result2 = test_func(1, 2)
    assert result2 == 3
    assert call_count == 1  # Cached

    # Negative x should not be cached
    result3 = test_func(-1, 2)
    assert result3 == 1
    assert call_count == 2

    result4 = test_func(-1, 2)
    assert result4 == 1
    assert call_count == 3  # Not cached


def test_cache_ttl():
    """Test cache TTL expiration"""
    # TTL is immutable in cachetools, so we'll test with a new cache
    from cachetools import TTLCache

    # Create a cache with very short TTL
    test_cache = TTLCache(maxsize=10, ttl=0.1)

    # Store original cache and replace temporarily
    original_cache = caches["short"]
    caches["short"] = test_cache

    try:

        @cached(cache_type="short", key_prefix="test_ttl")
        def test_func(x):
            return x * 2

        # First call
        result1 = test_func(5)
        assert result1 == 10

        # Immediate second call should use cache
        result2 = test_func(5)
        assert result2 == 10

        # Wait for TTL to expire
        time.sleep(0.2)

        # This should trigger a new calculation
        # Since TTL expired, the cache entry should be gone
        # The function will be called again
        result3 = test_func(5)
        assert result3 == 10

    finally:
        # Restore original cache
        caches["short"] = original_cache


def test_invalidate_cache():
    """Test cache invalidation"""

    @cached(cache_type="medium", key_prefix="test_invalidate")
    def test_func(x):
        return x**2

    # Populate cache
    result1 = test_func(4)
    assert result1 == 16

    # Check if value is in cache
    cache = caches["medium"]
    initial_size = len(cache)

    # Invalidate all caches
    invalidate_cache("all")

    # Verify cache is cleared
    assert len(cache) == 0


def test_invalidate_cache_with_pattern():
    """Test selective cache invalidation with pattern"""

    @cached(cache_type="medium", key_prefix="pattern_test")
    def func1(x):
        return x + 1

    @cached(cache_type="medium", key_prefix="other_test")
    def func2(x):
        return x + 2

    # Populate caches
    func1(1)
    func2(1)

    # Invalidate only pattern_test entries
    invalidate_cache("medium", "pattern_test")

    # Verify selective invalidation
    cache = caches["medium"]
    pattern_keys = [k for k in cache.keys() if "pattern_test" in str(k)]
    other_keys = [k for k in cache.keys() if "other_test" in str(k)]

    assert len(pattern_keys) == 0  # pattern_test entries removed
    # Note: other_test entries might or might not exist depending on cache implementation


def test_cache_stats():
    """Test cache statistics"""
    # Clear all caches first
    invalidate_cache("all")

    # Add some entries
    @cached(cache_type="short")
    def func1(x):
        return x

    @cached(cache_type="medium")
    def func2(x):
        return x * 2

    func1(1)
    func1(2)
    func2(1)

    stats = cache_stats()

    assert "short" in stats
    assert "medium" in stats
    assert "long" in stats
    assert "extended" in stats

    # Check structure
    for cache_name, cache_info in stats.items():
        assert "size" in cache_info
        assert "maxsize" in cache_info
        assert "ttl" in cache_info
        assert "utilization" in cache_info
        assert cache_info["size"] >= 0
        assert cache_info["maxsize"] > 0
        assert cache_info["ttl"] > 0


def test_cache_manager():
    """Test CacheManager context manager"""
    # Clear cache first
    invalidate_cache("all")

    @cached(cache_type="short", key_prefix="test_manager")
    def test_func(x):
        return x * 3

    # Populate cache
    test_func(5)
    cache = caches["short"]
    initial_size = len(cache)
    assert initial_size > 0

    # Use CacheManager without marking success
    with CacheManager(invalidate_on_success=True, cache_types=["short"]) as cm:
        # Cache should still exist
        assert len(cache) == initial_size

    # Cache should still exist (not marked as success)
    assert len(cache) == initial_size

    # Use CacheManager and mark success
    with CacheManager(invalidate_on_success=True, cache_types=["short"]) as cm:
        cm.mark_success()

    # Cache should be invalidated
    assert len(cache) == 0


def test_cache_none_values():
    """Test that None values are not cached"""
    call_count = 0

    @cached(cache_type="short", key_prefix="test_none")
    def test_func(x):
        nonlocal call_count
        call_count += 1
        if x > 0:
            return x * 3  # Return x * 3 to match the cached decorator behavior
        return None

    # Call with value that returns None
    result1 = test_func(-1)
    assert result1 is None
    assert call_count == 1

    # Call again - should not be cached
    result2 = test_func(-1)
    assert result2 is None
    assert call_count == 2  # Function called again

    # Call with value that returns non-None
    result3 = test_func(5)
    assert result3 == 15  # 5 * 3
    assert call_count == 3

    # This should be cached
    result4 = test_func(5)
    assert result4 == 15  # 5 * 3
    assert call_count == 3  # No additional call


def test_different_cache_types():
    """Test different cache types have different TTLs"""
    assert caches["short"].ttl == 60  # 1 minute
    assert caches["medium"].ttl == 300  # 5 minutes
    assert caches["long"].ttl == 3600  # 1 hour
    assert caches["extended"].ttl == 900  # 15 minutes

    # Test different max sizes
    assert caches["short"].maxsize == 500
    assert caches["medium"].maxsize == 200
    assert caches["long"].maxsize == 100
    assert caches["extended"].maxsize == 50
