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

## Deployment Environments

### Production
- **URL**: https://taskagent-api-masa.fly.dev
- **Trigger**: Push to `main` branch
- **Instance**: 1GB RAM, always running
- **Database**: Production Supabase instance

### Preview (Staging)
- **URL**: https://taskagent-api-masa-preview.fly.dev
- **Trigger**: Pull Request creation/update
- **Instance**: 512MB RAM, auto-scales to zero
- **Database**: Separate preview database (recommended)
- **Cost**: ~$5-10/month (only when active)

### Environment Setup

1. **Create Preview App** (one-time setup):
```bash
./scripts/setup-preview-env.sh
```

2. **Required GitHub Secrets**:
```
FLY_API_TOKEN=your_fly_token
DATABASE_URL=production_database_url
DATABASE_URL_PREVIEW=preview_database_url  # Optional: separate DB for preview
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
```

3. **Preview Deployment**:
- Creates automatically on PR
- Comments deployment URL in PR
- Auto-destroys after PR merge/close

### Cost Optimization Features
- Preview environment scales to zero after 5 minutes
- Smaller instance size for preview (512MB vs 1024MB)
- Shared database option to minimize costs

## API Documentation

When running, visit:
- http://localhost:8000/docs - Swagger UI
- http://localhost:8000/redoc - ReDoc
