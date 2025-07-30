#!/usr/bin/env python
"""
Entry point for running the TaskAgent API server
"""

import uvicorn

from taskagent_api.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "taskagent_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        reload_dirs=["./src"],
    )
