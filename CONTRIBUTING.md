# Contributing to HumanCompiler

Thank you for your interest in contributing to HumanCompiler! We welcome contributions from the community and appreciate your time and effort.

---

## 📋 Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [How Can I Contribute?](#how-can-i-contribute)
3. [Development Setup](#development-setup)
4. [Coding Standards](#coding-standards)
5. [Commit Guidelines](#commit-guidelines)
6. [Pull Request Process](#pull-request-process)
7. [License Agreement](#license-agreement)
8. [Getting Help](#getting-help)

---

## 📜 Code of Conduct

By participating in this project, you agree to:

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

---

## 🤝 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When reporting a bug, include:**
- Clear and descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots (if applicable)
- Environment details (OS, browser, versions)

**Example:**
```markdown
**Bug**: Task scheduling fails with OR-Tools constraint error

**Steps to reproduce:**
1. Create a project with 10+ tasks
2. Set tight deadline constraints
3. Run daily scheduling optimization
4. Error occurs: "CP-SAT solver infeasible"

**Expected**: Solver should find optimal solution or provide fallback
**Actual**: Unhandled exception crashes the API

**Environment:**
- OS: Ubuntu 22.04
- Python: 3.13
- OR-Tools: 9.8.3296
```

### Suggesting Features

We welcome feature suggestions! Please:

- Check if the feature has already been requested
- Provide clear use cases and benefits
- Consider backward compatibility
- Explain how it fits the project's goals

**Template:**
```markdown
**Feature Request**: Add Gantt chart visualization

**Use Case**: Users want to visualize project timelines and dependencies

**Benefits:**
- Better project overview
- Easier deadline tracking
- Improved team communication

**Proposed Implementation:**
- Use library like `react-gantt-chart`
- Integrate with existing timeline API
- Add export to PNG/PDF
```

### Contributing Code

We accept contributions for:

- Bug fixes
- New features
- Performance improvements
- Documentation updates
- Test coverage improvements
- UI/UX enhancements

---

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.11+ with uv
- Git
- Code editor (VS Code recommended)

### Initial Setup

1. **Fork and clone the repository:**
```bash
git clone https://github.com/masa10-f/HumanCompiler.git
cd HumanCompiler
```

2. **Install dependencies:**
```bash
# Frontend
pnpm install

# Backend
cd apps/api
python -m venv ../../.venv
source ../../.venv/bin/activate
uv pip install -r requirements.txt
```

3. **Set up environment variables:**
```bash
# Copy example files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# ⚠️ IMPORTANT: Edit the copied files and replace placeholder values with your actual credentials
# - Get Supabase credentials: https://app.supabase.com/project/YOUR_PROJECT/settings/api
# - Get OpenAI API key: https://platform.openai.com/api-keys
# - See the .env.example files for detailed instructions and warnings
```

4. **Run development servers:**
```bash
# Terminal 1 (Backend)
cd apps/api
python src/humancompiler_api/main.py

# Terminal 2 (Frontend)
cd apps/web
npm run dev
```

5. **Verify setup:**
- Frontend (local): http://localhost:3000
- Backend API docs (local): http://localhost:8000/docs
- Backend API docs (production): https://humancompiler-api-masa.fly.dev/docs

---

## 📏 Coding Standards

### General Principles

- Write clean, readable, and maintainable code
- Follow existing code style and patterns
- Add comments for complex logic
- Write self-documenting code with clear variable names

### Language-Specific Guidelines

#### **TypeScript/JavaScript (Frontend)**

- **Language**: TypeScript with strict mode
- **Formatter**: Prettier
- **Linter**: ESLint
- **Style Guide**: Airbnb TypeScript

**Rules:**
```typescript
// ✅ Good
interface Task {
  id: string;
  title: string;
  estimateHours: number;
}

async function fetchTasks(projectId: string): Promise<Task[]> {
  const response = await fetch(`/api/tasks?project=${projectId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tasks: ${response.status}`);
  }
  return response.json();
}

// ❌ Bad
async function getTasks(id) {  // No type annotations
  const res = await fetch('/api/tasks?project=' + id);  // String concatenation
  return res.json();  // No error handling
}
```

**Run checks:**
```bash
cd apps/web
npm run type-check
npm run lint
npm run format
```

#### **Python (Backend)**

- **Language**: Python 3.11+
- **Type Checker**: mypy
- **Linter**: Ruff
- **Formatter**: Ruff
- **Style Guide**: PEP 8

**Rules:**
```python
# ✅ Good
from typing import List
from pydantic import BaseModel

class Task(BaseModel):
    id: str
    title: str
    estimate_hours: float

async def fetch_tasks(project_id: str) -> List[Task]:
    """Fetch all tasks for a given project.

    Args:
        project_id: The ID of the project

    Returns:
        List of tasks belonging to the project

    Raises:
        HTTPException: If project not found
    """
    tasks = session.exec(
        select(Task).where(Task.project_id == project_id)
    ).all()
    return tasks

# ❌ Bad
def get_tasks(id):  # No type hints, unclear function name
    tasks = session.exec(select(Task).where(Task.project_id == id)).all()  # No docstring
    return tasks
```

**Run checks:**
```bash
cd apps/api
pytest                # Run tests
ruff check .          # Linting
ruff format .         # Formatting
mypy src              # Type checking
```

### File Naming Conventions

**Frontend:**
- Components: `PascalCase.tsx` (e.g., `TaskList.tsx`)
- Hooks: `use*.ts` (e.g., `useAuth.ts`)
- Utils: `camelCase.ts` (e.g., `formatDate.ts`)
- Pages: `kebab-case/page.tsx` (e.g., `projects/[id]/page.tsx`)

**Backend:**
- Modules: `snake_case.py` (e.g., `task_service.py`)
- Tests: `test_*.py` (e.g., `test_api.py`)
- Models: `snake_case.py` (e.g., `task_model.py`)

### License Headers (SPDX Identifiers)

**All new source files must include SPDX license identifiers:**

**TypeScript/JavaScript files:**
```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
```

**Python files:**
```python
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
```

Template files are available:
- `.spdx-header-typescript.txt`
- `.spdx-header-python.txt`

---

## 📝 Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build, etc.)
- `perf`: Performance improvements

### Examples

```bash
# Good commits
git commit -m "feat(scheduler): Add OR-Tools constraint optimization"
git commit -m "fix(api): Fix task deletion cascade behavior"
git commit -m "docs(readme): Update installation instructions"
git commit -m "refactor(auth): Simplify Supabase authentication flow"
git commit -m "test(api): Add unit tests for weekly planning service"

# Bad commits
git commit -m "Update code"
git commit -m "Fix bug"
git commit -m "WIP"
```

### Commit Best Practices

- Write commits in **English**
- Use present tense ("Add feature" not "Added feature")
- Keep subject line under 72 characters
- Separate subject from body with a blank line
- Use body to explain **what** and **why**, not **how**

**Example with body:**
```bash
git commit -m "feat(ai): Implement GPT-4 weekly plan generation

Add OpenAI Assistants API integration for automated weekly planning.
The service analyzes project goals, task dependencies, and user workload
to generate optimized weekly schedules.

Closes #123"
```

---

## 🔄 Pull Request Process

### Before Submitting

1. **Create a feature branch:**
```bash
git checkout -b feat/add-gantt-chart
```

2. **Make your changes:**
- Follow coding standards
- Add tests for new features
- Update documentation

3. **Run all checks:**
```bash
# Frontend
cd apps/web
npm run type-check
npm run lint

# Backend
cd apps/api
pytest
ruff check .
mypy src
```

4. **Commit your changes:**
```bash
git add .
git commit -m "feat(ui): Add Gantt chart visualization"
```

5. **Push to your fork:**
```bash
git push origin feat/add-gantt-chart
```

### Submitting the Pull Request

1. **Go to the original repository** on GitHub
2. **Click "New Pull Request"**
3. **Select your branch**
4. **Fill out the PR template:**

```markdown
## Description
Add Gantt chart visualization for project timeline

## Type of Change
- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Changes Made
- Added `GanttChart` component using `react-gantt-chart`
- Created `/api/timeline/{project_id}` endpoint
- Added export to PNG/PDF functionality
- Updated project detail page with chart toggle

## Testing
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed
- [x] No TypeScript errors
- [x] No linting errors

## Screenshots
[Attach screenshots if UI changes]

## Checklist
- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Comments added for complex code
- [x] Documentation updated
- [x] Tests added/updated
- [x] All CI checks pass

## Related Issues
Closes #123
```

### Review Process

- Maintainers will review your PR within 3-5 business days
- Address any requested changes
- Once approved, your PR will be merged

### After Merge

- Your contribution will be included in the next release
- You'll be added to the contributors list
- Thank you! 🎉

---

## 📄 License Agreement

**IMPORTANT**: By submitting a pull request, you agree that:

1. **Your contributions will be dual-licensed** under:
   - GNU Affero General Public License v3.0 (AGPL-3.0)
   - Commercial License (for proprietary use)

2. **You grant the project maintainers** the right to:
   - Relicense your contributions under future license versions
   - Include your contributions in commercial versions
   - Modify and distribute your contributions

3. **You confirm that**:
   - You have the right to submit this contribution
   - Your contribution is your original work
   - Your contribution does not violate any third-party rights

4. **You understand that**:
   - Open-source users will receive your code under AGPL-3.0
   - Commercial license users will receive your code under proprietary terms
   - You will not receive compensation for contributions

If you cannot agree to these terms, please **do not submit a pull request**.

For questions about licensing, contact: masa1063fuk@gmail.com

---

## 🆘 Getting Help

### Documentation

- **README**: General project overview
- **API Docs (Local)**: http://localhost:8000/docs
- **API Docs (Production)**: https://humancompiler-api-masa.fly.dev/docs
- **Wiki**: https://github.com/masa10-f/HumanCompiler/wiki

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and ideas
- **Email**: masa1063fuk@gmail.com (for sensitive matters)

### Asking Good Questions

When asking for help:

1. **Search existing issues first**
2. **Provide context and details**
3. **Share relevant code/error messages**
4. **Describe what you've already tried**

**Example:**
```markdown
**Question**: How do I add a new constraint to OR-Tools scheduler?

**Context**: I want to add a "max tasks per day" constraint

**What I tried**:
- Read OR-Tools documentation
- Looked at existing constraints in `scheduler_service.py`
- Attempted to add `solver.Add(daily_tasks <= 5)` but got error

**Error**:
```
TypeError: 'IntVar' object is not iterable
```

**Code**:
```python
daily_tasks = solver.IntVar(0, 10, 'daily_tasks')
solver.Add(daily_tasks <= 5)  # This fails
```
```

---

## 🙏 Thank You!

Every contribution, no matter how small, helps make HumanCompiler better. We appreciate your time and effort!

**Happy coding!** 🚀

---

*Last updated: 2025-10-05*
