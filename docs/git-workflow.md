# Git Workflow & Branching Strategy

> This document defines how we use Git in the SOCIO.LK POS project to maintain clean history and enable smooth collaboration.

---

## 🌿 Branching Strategy: Git Flow

We follow a simplified **Git Flow** model with three main branch types.

main (production)
│
└── develop (integration)
│
├── feature/auth-redux
├── feature/dashboard
├── fix/login-validation
├── docs/initial-documentation
└── refactor/button-component


---

## 🌳 Branch Types

### 1. `main` — Production Branch 🔴

- **Purpose:** Production-ready code only
- **Protected:** Yes (no direct pushes)
- **Updated from:** `develop` (via release PRs)
- **Deployed to:** Production environment
- **Rule:** Every commit on `main` should be deployable

### 2. `develop` — Integration Branch 🟡

- **Purpose:** Integration of completed features
- **Protected:** Yes (PRs required)
- **Updated from:** Feature branches
- **Deployed to:** Staging environment (future)
- **Rule:** Should always be in a working state

### 3. Feature Branches 🟢

Short-lived branches for specific work. Always branched from `develop`.

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/auth-redux` |
| `fix/` | Bug fixes | `fix/login-validation-error` |
| `refactor/` | Code improvements | `refactor/button-component` |
| `docs/` | Documentation | `docs/initial-documentation` |
| `chore/` | Maintenance | `chore/update-dependencies` |
| `style/` | Formatting | `style/prettier-config` |
| `test/` | Tests | `test/auth-unit-tests` |
| `hotfix/` | Urgent prod fixes | `hotfix/payment-crash` |

---

## 📋 Branch Naming Conventions

**Format:** `<type>/<short-description>`

✅ **Good Examples:**
- `feature/auth-redux`
- `fix/login-button-mobile`
- `refactor/api-service-layer`
- `docs/api-endpoints`

❌ **Bad Examples:**
- `my-branch` (no type, vague)
- `feature/AuthRedux` (use kebab-case, not camelCase)
- `feature/redux_auth` (use hyphens, not underscores)
- `feature/working-on-auth-stuff-and-fixes` (too long, mixed concerns)

**Rules:**
- Use **lowercase** with **hyphens**
- Keep it **short but descriptive**
- **One branch = one purpose**

---

## 🔄 Daily Workflow

### Starting a New Feature

```bash
# 1. Switch to develop
git checkout develop

# 2. Pull latest changes
git pull origin develop

# 3. Create new feature branch
git checkout -b feature/your-feature-name

# 4. Start working...
```

### During Development

```bash
# Check what changed
git status

# Stage specific files
git add path/to/file.js

# Stage all changes
git add .

# Commit with conventional message
git commit -m "feat(auth): add login form validation"

# Push to remote
git push origin feature/your-feature-name
```

### Completing a Feature

```bash
# 1. Make sure all changes are committed
git status

# 2. Push final changes
git push origin feature/your-feature-name

# 3. Open Pull Request on GitHub
#    Source: feature/your-feature-name
#    Target: develop

# 4. Wait for review (or self-review)

# 5. Merge PR on GitHub (use "Squash and merge" or "Create merge commit")

# 6. Delete the branch (locally and remotely)
git checkout develop
git pull origin develop
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

---

## 💬 Commit Message Convention

We follow the **Conventional Commits** specification.

### Format

<type>(<scope>): <subject>
[optional body]
[optional footer]

### Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(auth): add login form` |
| `fix` | Bug fix | `fix(button): resolve hover state` |
| `docs` | Documentation only | `docs: update README` |
| `style` | Formatting (no logic change) | `style: format with prettier` |
| `refactor` | Code change (no feature/fix) | `refactor(auth): simplify logic` |
| `perf` | Performance improvement | `perf: lazy load images` |
| `test` | Adding/updating tests | `test(auth): add login tests` |
| `chore` | Maintenance | `chore: update dependencies` |
| `build` | Build system changes | `build: configure vite` |
| `ci` | CI/CD changes | `ci: add github actions` |

### Scope (Optional)

The scope provides context — usually the module or feature:

- `feat(auth)` — Auth module
- `fix(pos)` — POS module
- `style(button)` — Button component
- `docs(api)` — API documentation

### Subject Rules

1. ✅ Use **imperative mood** ("add" not "added")
2. ✅ Use **lowercase** after the colon
3. ✅ **No period** at the end
4. ✅ Keep under **72 characters**
5. ✅ Be **specific and clear**

### Examples

✅ **Good Commits:**
```bash
feat(auth): add JWT token storage in localStorage
fix(login): resolve password visibility toggle on mobile
docs: add architecture documentation
refactor(button): extract loading spinner to separate component
chore: update React to v19.1
```

❌ **Bad Commits:**
```bash
update stuff              # Too vague
Fixed the bug             # Past tense, not specific
WIP                       # Use draft PRs instead
asdf                      # Meaningless
fix: Fixed the login.     # Capitalized, has period
```

### Commit Body (For Complex Changes)

```bash
git commit -m "feat(auth): implement role-based access control

- Add admin, manager, cashier roles
- Create usePermissions custom hook
- Implement 'visible but disabled' UI pattern
- Add role to JWT payload"
```

---

## 🔁 Pull Request (PR) Process

### Creating a PR

1. Push your feature branch to GitHub
2. Click "Compare & pull request"
3. Set **base** branch (usually `develop`)
4. Set **compare** branch (your feature branch)
5. Fill out PR template (see below)
6. Request review (or self-review for solo projects)

### PR Title Format

Same as commit messages:
feat(auth): add Redux Toolkit for authentication state

### PR Description Template

```markdown
## 📝 Description
Brief description of what this PR does.

## 🎯 Changes
- Added X
- Modified Y
- Removed Z

## 🧪 How to Test
1. Step one
2. Step two
3. Expected result

## 📸 Screenshots (if UI changes)
[Add screenshots here]

## ✅ Checklist
- [ ] Code follows project style
- [ ] Tested locally
- [ ] Documentation updated
- [ ] No console errors
- [ ] Responsive on mobile
```

### Merge Strategies

We use **"Squash and merge"** for feature branches:
- ✅ Combines all commits into one clean commit on `develop`
- ✅ Keeps `develop` history clean and readable
- ✅ Easier to revert if needed

---

## 🚨 Important Rules

### DO ✅

- ✅ **Pull before you start** — Always `git pull origin develop` first
- ✅ **Commit often** — Small, focused commits
- ✅ **Write meaningful messages** — Future you will thank you
- ✅ **Push regularly** — Don't hoard local commits
- ✅ **Delete merged branches** — Keep branch list clean
- ✅ **Review your own PR** — Check the diff before requesting review

### DON'T ❌

- ❌ **Never commit directly to `main`** — Always go through `develop`
- ❌ **Never push to `develop` directly** — Always use PRs
- ❌ **Don't mix concerns** — One branch = one purpose
- ❌ **Don't commit secrets** — Use `.env` files (gitignored)
- ❌ **Don't force push to shared branches** — `--force` is dangerous
- ❌ **Don't leave WIP commits** — Squash before merging

---

## 🔧 Useful Git Commands

### Daily Use

```bash
# See current branch and changes
git status

# See commit history
git log --oneline -10

# See visual branch tree
git log --oneline --graph --all --decorate

# Discard changes to a file
git checkout -- filename

# Unstage a file
git reset HEAD filename

# Amend last commit (before push)
git commit --amend

# See what changed in a file
git diff filename
```

### Branch Management

```bash
# List all branches
git branch -a

# Switch branches
git checkout branch-name

# Create and switch
git checkout -b new-branch

# Rename current branch
git branch -m new-name

# Delete local branch
git branch -d branch-name

# Delete remote branch
git push origin --delete branch-name
```

### Syncing with Remote

```bash
# Fetch all remote changes (doesn't merge)
git fetch --all

# Pull latest changes
git pull origin branch-name

# Push to remote
git push origin branch-name

# Set upstream for new branch
git push -u origin branch-name
```

---

## 🆘 Common Scenarios

### Scenario 1: I committed to the wrong branch

```bash
# Save your commit hash
git log --oneline -1

# Reset current branch (keeps changes)
git reset HEAD~1

# Switch to correct branch
git checkout correct-branch

# Commit there
git add .
git commit -m "your message"
```

### Scenario 2: My branch is behind develop

```bash
# On your feature branch
git checkout develop
git pull origin develop
git checkout feature/your-branch
git merge develop

# Resolve any conflicts
# Then commit and push
```

### Scenario 3: I need to undo my last commit

```bash
# Undo commit, keep changes
git reset --soft HEAD~1

# Undo commit, discard changes (CAREFUL!)
git reset --hard HEAD~1
```

### Scenario 4: I accidentally committed sensitive data

```bash
# If not pushed yet
git reset --soft HEAD~1
# Remove sensitive file, add to .gitignore, re-commit

# If already pushed - contact team immediately
# May need to rewrite history (advanced)
```

---

## 🎯 Branch Lifecycle Example

Real example from this project:
feature/login-page created from develop
├── Built Logo component
├── Built InputField component
├── Built Button component
├── Built LoginForm component
├── Built LoginPage
└── PR #3 → Merged to develop ✅
docs/initial-documentation created from develop
├── Added README.md
├── Added architecture.md
├── Added git-workflow.md
├── Added getting-started.md
└── PR #4 → Merge to develop (pending)
feature/auth-redux (next)
├── Configure Redux store
├── Add auth slice
├── Connect login form
├── Add localStorage persistence
├── Add protected routes
└── PR #5 → Merge to develop

---

## 📚 Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Git Flow Original Article](https://nvie.com/posts/a-successful-git-branching-model/)
- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
- [Pro Git Book (Free)](https://git-scm.com/book/en/v2)

---

**Last Updated:** May 2026