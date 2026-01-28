# CLAUDE.md - Development Guide for HumanCompiler

This document provides essential information for AI assistants (like Claude) and developers working on the HumanCompiler project.

## Project Overview

HumanCompiler is an AI-powered task management system with automated scheduling.

**Tech Stack:**
- **Frontend:** Next.js 15 (App Router), React 18, TypeScript (strict), TailwindCSS, shadcn/ui
- **Backend:** FastAPI (Python 3.11+), SQLModel ORM, Pydantic
- **AI/Optimization:** OpenAI GPT-5, OR-Tools CP-SAT solver
- **Database:** Supabase PostgreSQL (with Row Level Security)
- **Package Manager:** pnpm 9.0.0 (monorepo)

## Project Structure

```
HumanCompiler/
├── apps/
│   ├── web/                    # Next.js Frontend
│   │   ├── src/
│   │   │   ├── app/           # App Router pages
│   │   │   ├── components/    # React components
│   │   │   ├── hooks/         # Custom React hooks
│   │   │   ├── lib/           # Utilities & API client
│   │   │   └── types/         # TypeScript types
│   │   └── package.json
│   │
│   └── api/                    # FastAPI Backend
│       ├── src/humancompiler_api/
│       │   ├── main.py        # FastAPI entry
│       │   ├── routers/       # API endpoints
│       │   ├── ai/            # AI services
│       │   └── scheduler/     # OR-Tools scheduling
│       ├── tests/
│       └── pyproject.toml
│
├── docs/dev/                   # Development documentation
├── .github/                    # GitHub workflows & templates
├── package.json                # Root workspace config
└── pnpm-workspace.yaml
```

## Development Environment Setup

### Prerequisites

- Node.js 18+
- pnpm 9.0.0+
- Python 3.11+
- uv (Python package manager)

### Installation

```bash
# 1. Clone and install frontend dependencies
pnpm install

# 2. Setup backend virtual environment
cd apps/api
uv venv
source .venv/bin/activate  # Linux/Mac
# or: .venv\Scripts\activate  # Windows
uv pip install -e ".[dev]"

# 3. Setup pre-commit hooks (REQUIRED!)
pre-commit install

# 4. Configure environment variables
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Edit each .env file with your credentials
```

### Running Development Servers

```bash
# Frontend (from root)
pnpm dev

# Backend (from apps/api)
uv run python run.py
# or
uvicorn humancompiler_api.main:app --reload --port 8000
```

## Development Commands

### Frontend (apps/web)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Build for production |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Run TypeScript type checking |
| `pnpm test` | Run Jest tests |
| `pnpm test:coverage` | Run tests with coverage |

### Backend (apps/api)

| Command | Description |
|---------|-------------|
| `pytest` | Run all tests |
| `pytest --cov=src` | Run tests with coverage |
| `ruff check .` | Run linter |
| `ruff format .` | Format code |
| `mypy src` | Run type checker |
| `bandit -r src` | Run security scanner |

### Root Commands

| Command | Description |
|---------|-------------|
| `pnpm -r build` | Build all apps |
| `pnpm -r lint` | Lint all apps |
| `pnpm -r test` | Test all apps |

## Pre-Push Checklist

Before pushing code, **always** run the following checks:

### Frontend Changes

```bash
# 1. Type check
pnpm --filter web type-check

# 2. Lint
pnpm --filter web lint

# 3. Run tests
pnpm --filter web test
```

### Backend Changes

```bash
cd apps/api

# 1. Lint and format
ruff check . --fix
ruff format .

# 2. Type check
mypy src

# 3. Security scan
bandit -r src -s B101

# 4. Run tests
pytest -v
```

### Pre-commit Hooks

Pre-commit hooks are configured to run automatically. They include:
- Ruff linting and formatting (Python)
- Trailing whitespace removal
- End-of-file fixes
- YAML/JSON/TOML validation
- Merge conflict detection

If hooks fail, fix the issues and commit again.

## Coding Standards

### TypeScript/React

- Use **strict mode** TypeScript
- Follow ESLint rules (extends `next/core-web-vitals`)
- Unused variables should be prefixed with `_`
- Avoid `any` type (warnings enabled)
- Path aliases: `@/*` → `./src/*`

### Python

- Follow **PEP 8** with Ruff formatting
- Line length: 88 characters
- Use type hints for all functions
- Quote style: double quotes

### File Naming Conventions

**Frontend:**
- Components: PascalCase (`TaskList.tsx`)
- Hooks: camelCase with `use` prefix (`useAuth.ts`)
- Utilities: camelCase (`formatDate.ts`)

**Backend:**
- Modules: snake_case (`task_service.py`)
- Tests: `test_` prefix (`test_api.py`)

### SPDX License Headers

New files require SPDX license headers. See:
- `.spdx-header-typescript.txt` for TypeScript
- `.spdx-header-python.txt` for Python

## Commit Guidelines

Follow **Conventional Commits** format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, no logic change) |
| `refactor` | Code refactoring |
| `test` | Adding or fixing tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvements |

### Examples

```bash
feat(scheduler): Add OR-Tools constraint optimization
fix(auth): Resolve token refresh race condition
docs(api): Update endpoint documentation
refactor(tasks): Consolidate task filtering logic
```

### Rules

- Use English
- Use present tense ("Add feature" not "Added feature")
- Subject line: < 72 characters
- Separate body with blank line
- **Do NOT use `--amend` option** - Always create new commits in this workspace

## Pull Request Guidelines

### PR Template Sections

1. **Description** - What does this PR do?
2. **Type of Change** - bug fix, feature, breaking change, etc.
3. **Changes Made** - List frontend, backend, database, API changes
4. **Related Issues** - Use `Closes #123` or `Fixes #123`
5. **Testing** - Unit, integration, manual tests performed
6. **Screenshots** - For UI changes (before/after)
7. **Breaking Changes** - Document any breaking changes
8. **Deployment Notes** - Migrations, env vars, special steps

### PR Checklist

Before submitting a PR, ensure:

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated if needed
- [ ] Tests added for new features
- [ ] All tests pass locally
- [ ] No new linting errors
- [ ] TypeScript/MyPy checks pass
- [ ] PR title follows Conventional Commits format

## CI/CD Pipeline

GitHub Actions automatically run on PRs:

1. **Linting** - Ruff (Python), ESLint (TypeScript)
2. **Type Checking** - MyPy, TypeScript
3. **Security Scanning** - Bandit, Safety
4. **Tests** - Pytest, Jest with coverage
5. **Preview Deploy** - Fly.io preview environment (PRs)
6. **Production Deploy** - On merge to main

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABASE_URL` | PostgreSQL connection string |

See `.env.example` files for complete list.

## Useful Resources

- [API Documentation](http://localhost:8000/docs) - FastAPI Swagger UI
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Full contribution guidelines
- [docs/dev/database-setup.md](./docs/dev/database-setup.md) - Supabase setup
- [SECURITY.md](./SECURITY.md) - Security guidelines
