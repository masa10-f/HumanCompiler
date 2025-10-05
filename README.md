# HumanCompiler

**AI-Powered Task Management System with Automated Scheduling**

HumanCompiler is an intelligent task management web application that helps you manage research and development projects using a 4-layer hierarchy: Projects → Goals → Tasks → Actuals. It features AI-powered weekly planning with OpenAI GPT-4 and constraint-based optimization using OR-Tools CP-SAT solver.

---

## ✨ Key Features

- 📊 **4-Layer Project Management**: Projects → Goals → Tasks → Actuals hierarchy
- 🤖 **AI-Powered Planning**: Weekly plan generation using OpenAI GPT-4 Assistants API
- 🎯 **Smart Scheduling**: OR-Tools constraint solver for optimal task scheduling
- 📈 **Workload Analysis**: AI-driven task volume, deadline, and distribution analysis
- 🔄 **Dynamic Rescheduling**: Real-time progress tracking and plan adjustment
- 🔐 **Secure Multi-User**: Supabase authentication with Row Level Security (RLS)
- 📱 **Modern UI**: Responsive design with Next.js 14 and shadcn/ui components

---

## 🏗️ Architecture

### Tech Stack

**Frontend:**
- Next.js 14 (App Router)
- React 18
- TypeScript (strict mode)
- TailwindCSS
- shadcn/ui components

**Backend:**
- FastAPI (Python 3.13)
- Uvicorn ASGI server
- SQLModel ORM
- Pydantic validation

**Database & Services:**
- Supabase Postgres (with RLS)
- OpenAI GPT-4 (Assistants API)
- OR-Tools CP-SAT solver

**Deployment:**
- Frontend: Vercel
- Backend: Fly.io
- Database: Supabase Cloud

### Project Structure

```
HumanCompiler/
├── apps/
│   ├── web/              # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/     # App Router pages
│   │   │   ├── components/
│   │   │   └── lib/
│   │   └── package.json
│   └── api/              # FastAPI backend
│       ├── src/
│       │   └── humancompiler_api/
│       │       ├── routers/
│       │       ├── models/
│       │       ├── ai/
│       │       └── scheduler/
│       └── requirements.txt
└── packages/             # Shared packages (future use)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.11+ with uv
- Supabase account
- OpenAI API key

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/masa10-f/HumanCompiler.git
cd HumanCompiler
```

2. **Install frontend dependencies:**
```bash
pnpm install
```

3. **Set up Python environment:**
```bash
cd apps/api
python -m venv ../../.venv
source ../../.venv/bin/activate  # Windows: ../../.venv/Scripts/activate
uv pip install -r requirements.txt
```

4. **Configure environment variables:**

⚠️ **IMPORTANT**: Copy `.env.example` files and replace placeholder values with your actual credentials. See the example files for detailed instructions.

Create `apps/api/.env`:
```bash
# Copy from example and update with your credentials
cp apps/api/.env.example apps/api/.env

# Then edit apps/api/.env with your actual values:
SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"
SUPABASE_ANON_KEY="your-actual-anon-key-from-supabase-dashboard"
SUPABASE_SERVICE_ROLE_KEY="your-actual-service-role-key-from-supabase-dashboard"
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres"
OPENAI_API_KEY="sk-proj-your-actual-openai-api-key"
ENVIRONMENT="development"
```

Create `apps/web/.env.local`:
```bash
# Copy from example and update with your credentials
cp apps/web/.env.example apps/web/.env.local

# Then edit apps/web/.env.local with your actual values:
NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-actual-anon-key-from-supabase-dashboard"
NEXT_PUBLIC_API_DEVELOPMENT_URL="http://localhost:8000"
```

📚 **Get your Supabase credentials**: https://app.supabase.com/project/YOUR_PROJECT/settings/api

5. **Run development servers:**

Terminal 1 (Backend):
```bash
cd apps/api
python src/humancompiler_api/main.py
# → http://localhost:8000
```

Terminal 2 (Frontend):
```bash
cd apps/web
pnpm run dev
# → http://localhost:3000
```

---

## 📚 API Documentation

Interactive API documentation available at:
- Development: http://localhost:8000/docs
- Production: https://humancompiler-api-masa.fly.dev/docs

### Main Endpoints

**Project Management:**
- `GET/POST/PUT/DELETE /api/projects/`
- `GET/POST/PUT/DELETE /api/goals/`
- `GET/POST/PUT/DELETE /api/tasks/`

**AI Features:**
- `POST /api/ai/weekly-plan` - Generate AI-powered weekly plans
- `POST /api/ai/analyze-workload` - Analyze task workload
- `POST /api/ai/suggest-priorities` - Get AI priority suggestions

**Scheduling:**
- `POST /api/schedule/daily` - OR-Tools constraint optimization

---

## 🧪 Testing & Quality

```bash
# Frontend
cd apps/web
pnpm run type-check    # TypeScript validation
pnpm run lint          # ESLint

# Backend
cd apps/api
pytest                # Run all tests
pytest -v tests/test_api.py
ruff check .          # Linting
ruff format .         # Code formatting
mypy src              # Type checking
```

---

## 📦 Deployment

### Frontend (Vercel)

```bash
cd apps/web
pnpm run build
# Auto-deploy on push to main branch
```

### Backend (Fly.io)

```bash
cd apps/api
~/.fly/bin/flyctl deploy --remote-only
# Auto-deploy via GitHub Actions
```

---

## 🔒 Security

- ✅ Supabase Row Level Security (RLS) enabled
- ✅ HTTPS enforcement in production
- ✅ CORS configuration
- ✅ Rate limiting
- ✅ Encrypted API key storage
- ✅ Input validation (Pydantic/Zod)

See [SECURITY.md](SECURITY.md) and [docs/dev/database-setup.md](docs/dev/database-setup.md) for details.

---

## 📄 License

HumanCompiler is **dual-licensed**:

### Option 1: AGPL-3.0 (Free & Open Source)

For personal use, academic research, and open-source projects.

**Requirements:**
- If you provide this software as a network service (SaaS), you **must** disclose your source code to users under AGPL-3.0

📄 Full license text: [LICENSE-AGPL-3.0](LICENSE-AGPL-3.0)

### Option 2: Commercial License

For commercial SaaS deployment **without** source code disclosure.

**Includes:**
- No source code disclosure requirement
- Priority technical support
- Custom feature development
- Legal indemnification

📧 **Commercial licensing inquiries:** [masa1063fuk@gmail.com]

See [LICENSE](LICENSE) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for full details.

---

## 🤝 Contributing

We welcome contributions! Please note:

1. **By submitting a pull request**, you agree that your contributions will be dual-licensed under AGPL-3.0 and our commercial license
2. Follow the existing code style (Prettier, Ruff)
3. Add tests for new features
4. Update documentation as needed

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 🛠️ Development Guidelines

- Responses to prompts: Japanese
- Code comments, commits, issues, PRs: English
- Commit messages: Conventional Commits format (`feat:`, `fix:`, etc.)
- Python: Use uv virtual environment (`.venv/bin`)
- TypeScript: Strict mode enabled
- Create issues for code quality concerns
- **New files**: Add SPDX license identifier headers (see `.spdx-header-*.txt` templates)

---

## 📞 Support & Contact

- **Documentation**: [GitHub Wiki](https://github.com/masa10-f/HumanCompiler/wiki)
- **Issues**: [GitHub Issues](https://github.com/masa10-f/HumanCompiler/issues)
- **Discussions**: [GitHub Discussions](https://github.com/masa10-f/HumanCompiler/discussions)
- **Commercial License**: [masa1063fuk@gmail.com]

---

## 🙏 Acknowledgments

Built with amazing open-source technologies:
- [Next.js](https://nextjs.org/) (MIT)
- [FastAPI](https://fastapi.tiangolo.com/) (MIT)
- [Supabase](https://supabase.com/) (Apache 2.0)
- [OpenAI](https://openai.com/) (Apache 2.0)
- [OR-Tools](https://developers.google.com/optimization) (Apache 2.0)
- [shadcn/ui](https://ui.shadcn.com/) (MIT)

---

## 📈 Roadmap

- [ ] Mobile app (React Native)
- [ ] Real-time collaboration
- [ ] Gantt chart visualization
- [ ] Team management features
- [ ] Advanced AI analytics
- [ ] Integration with project management tools (Jira, Asana, etc.)

---

**Made with ❤️ by Masato Fukushima**

*Copyright (c) 2024-2025 Masato Fukushima - Licensed under AGPL-3.0 OR Commercial License*
