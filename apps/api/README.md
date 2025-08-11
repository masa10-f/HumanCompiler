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
- **Database**: Same as production (default) or separate preview DB
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
DATABASE_URL_PREVIEW=preview_database_url  # Optional: if not set, uses production DB
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
```

### Database Configuration Options

**Option 1: Shared Database (Recommended for small teams)**
- Set only `DATABASE_URL` (production)
- Preview automatically uses production database
- ✅ **Pros**: Cost-effective, real data testing
- ⚠️ **Cons**: Preview tests affect production data

**Option 2: Separate Preview Database**
- Set both `DATABASE_URL` and `DATABASE_URL_PREVIEW`
- Create separate Supabase project for preview
- ✅ **Pros**: Complete isolation, safe testing
- ⚠️ **Cons**: Additional ~$25/month for separate DB

3. **Preview Deployment**:
- Creates automatically on PR
- Comments deployment URL in PR
- Auto-destroys after PR merge/close

### Cost Optimization Features
- Preview environment scales to zero after 5 minutes
- Smaller instance size for preview (512MB vs 1024MB)
- Shared database option: $0 additional DB cost
- Total additional cost: ~$5-10/month (vs ~$30-35/month with separate DB)

## API Documentation

When running, visit:
- http://localhost:8000/docs - Swagger UI
- http://localhost:8000/redoc - ReDoc
