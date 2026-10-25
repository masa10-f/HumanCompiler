FROM ghcr.io/astral-sh/uv:0.13.5 AS uv

FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/opt/venv/bin:$PATH"

# Install system dependencies for builds and health checks
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    cmake \
    build-essential \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies pinned in uv.lock (the file Dependabot updates),
# without dev extras. --locked fails the build if uv.lock is out of date.
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-cache

# Copy application code
COPY . .

# Daily scheduling uses the PyPI package humancompiler-scheduler, installed
# through uv.lock above. The API router keeps the existing response
# contract while adapting database objects to that package.

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check - simplified for debugging
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application with verbose logging and proxy headers support.
# Trusted forwarders come from $FORWARDED_ALLOW_IPS (uvicorn default: localhost
# only). fly.toml sets it to "*" so X-Forwarded-Proto from the Fly edge works;
# that makes X-Forwarded-For spoofable, so the app takes the client IP from
# Fly-Client-IP instead (see humancompiler_api/client_ip.py).
CMD ["uvicorn", "humancompiler_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--proxy-headers"]
