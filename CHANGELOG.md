# Changelog

All notable changes to the SOCIO.LK POS project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Initial project documentation
  - Comprehensive README with project overview, tech stack, and roadmap
  - Architecture documentation explaining tech decisions
  - Git workflow and branching strategy guide
  - Getting started setup guide
  - Changelog for version tracking

### Planned
- Redux Toolkit integration for authentication state
- Role-based access control (RBAC) with admin/manager/cashier roles
- Protected routes implementation
- localStorage persistence for auth state
- Mock JWT authentication

---

## [0.1.0] - 2026-05-14

### Added
- 🎉 Initial project setup
- ⚛️ React 19 with Vite configuration
- 🎨 Tailwind CSS v4 setup with custom theme
- 🛣️ React Router installation
- 📦 Redux Toolkit installation (not yet configured)
- 🗂️ Folder structure established
  - `src/assets/` for images
  - `src/components/common/` for shared components
  - `src/components/auth/` for auth components
  - `src/pages/` for route pages

### Components Built
- 🏷️ **Logo Component** — Brand logo with configurable sizes (sm, md, lg)
- 📝 **InputField Component** — Reusable input with:
  - Icon support (Mail, Lock from lucide-react)
  - Password visibility toggle
  - Focus states
  - Error message display
- 🔘 **Button Component** — Reusable button with:
  - Loading state with spinner
  - Gradient background
  - Full-width option
- 📋 **LoginForm Component** — Form with validation and mock submission
- 🖥️ **LoginPage** — Fully responsive layout:
  - Mobile: Clean white form-first design
  - Desktop: Glass morphism with split-panel layout (55/45)

### Design System
- 🎨 Dark teal/blue gradient theme (#0f2027 → #203a43 → #2c5364)
- ✨ Cyan accent colors (#0ea5e9, #06b6d4, #38bdf8)
- 📱 Mobile-first responsive approach
- 🔍 Glass morphism effects for desktop

### Project Structure
- 🌿 Git Flow branching strategy implemented
  - `main` — Production branch
  - `develop` — Integration branch
  - `feature/*` — Feature branches
- 📋 Pull Request workflow established
- ✅ First PR (#3) merged: `feature/login-page` → `develop`

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0 | 2026-05-14 | Initial setup + login UI |
| Unreleased | TBD | Documentation foundation |

---

## How to Read This Changelog

### Categories

- **Added** — New features
- **Changed** — Changes to existing functionality
- **Deprecated** — Features marked for removal
- **Removed** — Features removed in this version
- **Fixed** — Bug fixes
- **Security** — Security-related changes

### Versioning Format: `MAJOR.MINOR.PATCH`

- **MAJOR** — Breaking changes (e.g., 1.0.0 → 2.0.0)
- **MINOR** — New features, backwards compatible (e.g., 1.0.0 → 1.1.0)
- **PATCH** — Bug fixes only (e.g., 1.0.0 → 1.0.1)

### Example

1 . 2 . 3
│   │   │
│   │   └── Patch (bug fix)
│   └────── Minor (new feature)
└────────── Major (breaking change)

---

## Update Guidelines

When making changes, add entries under `[Unreleased]`:

```markdown
## [Unreleased]

### Added
- New feature description

### Fixed
- Bug fix description
```

When ready to release, move `[Unreleased]` items to a new version section with the date.

---

**Maintained by:** [Mohamed Inthisham](https://github.com/Mohamed-Inthisham)