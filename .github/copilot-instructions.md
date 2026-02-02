# Copilot Instructions - Hisham Alrashdan (Infogleam)

## Permitted Technology Stack

> **ONLY use these technologies unless explicitly requested otherwise.**

| Layer | Permitted Technologies |
|-------|------------------------|
| **Backend** | Node.js, Express.js |
| **Frontend** | React, HTML/CSS |
| **Language** | JavaScript, TypeScript (optional) |
| **API Style** | REST, FHIR R4 |
| **Database** | As needed per project (document in README) |

### Node.js Backend Libraries (Preferred)
| Package | Purpose |
|---------|---------|
| `express` | Web framework |
| `axios` | HTTP client for API calls |
| `dotenv` | Environment variable management |
| `cors` | Cross-origin resource sharing |
| `helmet` | Security headers |
| `express-session` | Session management |
| `jsonwebtoken` | JWT authentication |
| `bcrypt` | Password hashing |
| `morgan` | HTTP request logging |
| `express-validator` | Input validation |

### React Frontend Libraries (Preferred)
| Package | Purpose |
|---------|---------|
| `react-router-dom` | Client-side routing |
| `axios` | HTTP client for API calls |
| `react-query` / `@tanstack/react-query` | Server state & data fetching |
| `react-hook-form` | Form handling |
| `tailwindcss` | Utility-first CSS (optional) |

### Code Style Preferences
- Use ES6+ syntax (arrow functions, async/await, destructuring)
- Prefer `const` over `let`, never use `var`
- Use TypeScript only when type safety adds clear value
- React: Functional components with hooks (no class components)

---

## Development Tools

### Context7 (Required for Library Documentation)
When working with any library/framework, **ALWAYS use Context7** to fetch up-to-date documentation:
1. First call `mcp_context7_resolve-library-id` to get the library ID
2. Then call `mcp_context7_get-library-docs` with the resolved ID

Example workflow:
```
User: "How do I use React Query for data fetching?"
→ resolve-library-id: "react-query" 
→ get-library-docs: "/tanstack/react-query" with topic: "data fetching"
```

---

## Engineering Workflow (Required)

### Output Format for Every Task
1. **Plan** (max 8 bullets)
2. **Proposed file diffs** (list files you will change)
3. **Implement** in small chunks (one feature slice per chunk)
4. **Self-check**: confirm lint/tests pass, summarize what changed

### Boundaries
✅ **Always:**
- Keep changes under 300 lines unless approved
- Prefer existing utilities/patterns; reuse code
- Add/adjust tests for non-trivial logic

⚠️ **Ask first:**
- New dependencies
- Refactors across multiple files
- Any auth/security change

🚫 **Never:**
- Commit secrets or sample real credentials
- Rename folders/restructure without approval
- Add "clever" abstractions unless requested

### Commands Gate
If this repo has these scripts, run them as gates:
```bash
npm ci          # Install
npm run lint    # Lint
npm run test    # Test
```
If a command fails, fix it before continuing.

---

# Freelancer Portfolio & POC Rules (Universal)

> **These rules apply to ALL projects, not just this one.**

## Golden Rule: Code Online, Deep Docs Local

```
GitHub (Public)          Local Machine (Private)
─────────────────        ─────────────────────────
✓ Source code            ✓ docs/ folder
✓ README.md (minimal)    ✓ articles/ folder  
✓ .env.example           ✓ *.secret.md, *.private.md
✓ Architecture diagrams  ✓ Connection strings
✗ NO secrets             ✓ Proprietary logic details
✗ NO internal IPs        ✓ Client-specific configs
✗ NO marketing content   ✓ Upwork/freelance pitches
✗ NO market research     ✓ Competitor analysis
✗ NO client pitches      ✓ Sales templates
```

## Content That Must NEVER Be Published

The following content is for **private/personal use only** and must NEVER appear in public repositories:

- **Market share data** (e.g., "Epic has 35% market share")
- **Competitor comparisons** (e.g., "Why Epic vs Cerner")
- **Freelance pitches** (e.g., "What to say on Upwork")
- **Client acquisition templates** or sales scripts
- **Revenue/pricing strategies**
- **Personal business notes** or career planning
- **"Skills to highlight" or "how to sell yourself" sections**

These belong in local `docs/` or `notes/` folders, NOT in README.md or any committed file.

## Required .gitignore Patterns

Every POC project MUST have these in `.gitignore`:

```gitignore
# Private documentation (ALWAYS ignore)
docs/
articles/
notes/
*.secret.md
*.private.md
*.local.md
INTERNAL-*.md
*-INTERNAL.md
*-PRIVATE.md

# Environment & secrets
.env
.env.*
!.env.example
secrets/
```

## Pre-Push Security Checklist

**Before running `git push`, ALWAYS verify:**

1. **Check .gitignore exists** and contains the patterns above
2. **Run this command** to see what will be committed:
   ```bash
   git status
   git diff --cached --name-only
   ```
3. **Verify NO files match these patterns:**
   - `docs/*` or `articles/*`
   - `*.secret.md` or `*INTERNAL*`
   - `.env` (only `.env.example` is allowed)
   - Any file with IPs, passwords, or client names

4. **If private file staged accidentally:**
   ```bash
   git reset HEAD <filename>
   ```

## Two-Tier Documentation Strategy

### Tier 1: Public POC (GitHub)
**Files:** `README.md`, inline code comments
- High-level architecture diagrams
- Tech stack overview
- Setup instructions (generic)
- **NEVER include:** IPs, URLs like `*.infogleam.com`, database schemas, API keys, client names

### Tier 2: Internal Engineering (Local Only)
**Files:** `docs/INTERNAL-NOTES.md`, `articles/*.md`
- Comprehensive technical deep-dives
- Complex regex, SQL joins, ETL logic
- Step-by-step deployment for private environments
- Client-specific configurations
- Research articles and reference materials

## Triggers

| Command | Action |
|---------|--------|
| "Prepare my POC for GitHub" | Generate Tier 1 docs + run security checklist |
| "Update my private engineering notes" | Generate Tier 2 content in `docs/` folder |
| "Create an Infogleam case study" | Generate marketing summary for portfolio |
| "Check before push" | Run Pre-Push Security Checklist |
| "Publish to GitHub" | Run full GitHub publish workflow below |

---

## GitHub Publish Workflow (Universal)

> **Use this workflow for ANY new or existing project.**

### First-Time Setup (One-Time)
```bash
# Verify GitHub CLI is installed
gh --version

# Authenticate with GitHub (interactive)
gh auth login
# Choose: GitHub.com → HTTPS → Login with browser

# Set git identity (use noreply email for privacy)
git config --global user.name "Hisham Alrashdan"
git config --global user.email "hisham@infogleam.com"
```

### Publishing a NEW Project
```bash
# 1. Initialize git (if not already)
git init
git branch -M main

# 2. Verify .gitignore exists with required patterns
cat .gitignore | grep -E "docs/|\.env|secret"

# 3. Stage and commit
git status                    # Review what will be committed
git add .
git commit -m "Initial commit - POC setup"

# 4. Create repo and push (ONE COMMAND)
gh repo create Hisham-InfoGleam/<repo-name> --public \
  --description "<Short description>" \
  --source=. --remote=origin --push
```

### Updating an EXISTING Project
```bash
# 1. Check current status
git status
git remote -v                 # Verify remote is set

# 2. Stage, commit, push
git add .
git commit -m "Update: <describe changes>"
git push origin main
```

### Quick Reference: gh repo create Flags
| Flag | Purpose |
|------|---------|
| `--public` | Make repo visible to everyone |
| `--private` | Keep repo private (paid plans) |
| `--description "..."` | Set GitHub repo description |
| `--source=.` | Use current folder as source |
| `--remote=origin` | Name the remote "origin" |
| `--push` | Push commits immediately |

### Safety Verification Before Push
```bash
# See what's staged
git diff --cached --name-only

# Confirm no private files
git status | grep -E "docs/|secret|INTERNAL|\.env$"
# ↑ This should return NOTHING if .gitignore is correct

# View recent commits
git log --oneline -3
```

### If Something Goes Wrong
```bash
# Unstage a file (before commit)
git reset HEAD <filename>

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Remove sensitive file from history (DANGEROUS - rewrites history)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch <filename>" HEAD
```
