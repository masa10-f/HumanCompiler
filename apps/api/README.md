# TaskAgent API

AI-powered task management API built with FastAPI.

## Installation

```bash
# Install dependencies
pip install -e .

# Or for development
pip install -e ".[dev]"
```

## Running the API

```bash
# Using the run script
python run.py

# Or using uvicorn directly
uvicorn taskagent_api.main:app --reload

# Or as a module
python -m taskagent_api.main
```

## Project Structure

```
apps/api/
├── src/
│   └── taskagent_api/          # Main package
│       ├── __init__.py
│       ├── main.py             # FastAPI application
│       ├── config.py           # Configuration
│       ├── database.py         # Database connection
│       ├── models.py           # Data models
│       ├── services.py         # Business logic
│       ├── auth.py             # Authentication
│       ├── routers/            # API endpoints
│       ├── ai/                 # AI services
│       └── common/             # Common utilities
├── tests/                      # Test files
├── migrations/                 # Database migrations
└── pyproject.toml             # Package configuration
```

## API Documentation

When running, visit:
- http://localhost:8000/docs - Swagger UI
- http://localhost:8000/redoc - ReDoc
