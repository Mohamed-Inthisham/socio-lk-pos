# Architecture & Tech Decisions

> This document explains the technical choices made in SOCIO.LK POS and the reasoning behind them.

---

## 🏗️ System Architecture

SOCIO.LK POS follows a **modern client-server architecture** with clear separation between frontend and backend.

┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│                     │         │                     │         │                     │
│   React Frontend    │ ──HTTP─▶│   NestJS Backend    │ ──SQL──▶│   PostgreSQL DB     │
│   (Vite + Redux)    │ ◀──────│   (REST API + JWT)  │ ◀──────│                     │
│                     │  JSON   │                     │         │                     │
└─────────────────────┘         └─────────────────────┘         └─────────────────────┘
Browser                       AWS EC2/ECS                    AWS RDS

---

## 🎨 Frontend Stack

### React 19 + Vite
**Why React?**
- Industry-standard UI library with massive ecosystem
- Component-based architecture promotes reusability
- Huge community, abundant resources
- Excellent performance with virtual DOM

**Why Vite over Create React App?**
- ⚡ Significantly faster dev server (uses native ES modules)
- 🔥 Lightning-fast Hot Module Replacement (HMR)
- 📦 Optimized production builds with Rollup
- 🔧 Modern, actively maintained (CRA is deprecated)

### Tailwind CSS v4
**Why Tailwind?**
- Utility-first approach speeds up development
- Smaller production bundle (only used classes shipped)
- Consistent design system through configuration
- No CSS file naming conflicts
- Mobile-first responsive design built-in

**Why v4 specifically?**
- New CSS-first configuration (`@import` and `@layer theme`)
- Better performance than v3
- Simplified setup process

### Redux Toolkit
**Why Redux Toolkit (RTK)?**
- Official Redux team recommendation
- Reduces boilerplate compared to vanilla Redux
- Built-in `createSlice` for clean reducers
- Includes Redux Thunk for async operations
- Excellent DevTools support for debugging

**Why not Context API or Zustand?**
- Context API: Causes unnecessary re-renders for global state
- Zustand: Lighter but less ecosystem support
- RTK: Better suited for complex state (auth, cart, inventory, orders)

### React Router
**Why React Router?**
- De-facto standard for React routing
- Supports protected routes (essential for role-based access)
- Clean URL management
- Lazy loading support for performance

---

## ⚙️ Backend Stack (Planned)

### NestJS
**Why NestJS over Express?**
- Built-in architecture (modules, controllers, services)
- TypeScript-first approach (type safety)
- Excellent for scalable applications
- Built-in support for: validation, guards, interceptors, JWT
- Similar to Angular structure (enterprise-grade)

### PostgreSQL
**Why PostgreSQL over MongoDB?**
- POS data is **relational** (orders → items → products)
- ACID compliance critical for financial transactions
- Strong consistency guarantees
- Better for reporting and analytics
- Industry standard for business applications

### JWT (JSON Web Tokens)
**Why JWT?**
- Stateless authentication (scales horizontally)
- Self-contained (carries user info + role)
- Industry standard for REST APIs
- Works seamlessly with mobile apps in future

---

## 🔐 Authentication Strategy

### Phase 1 (Current): Mock Authentication
- Frontend-only auth simulation
- Mock JWT-like tokens stored in **localStorage**
- Roles embedded in token payload

### Phase 2 (Future): Real JWT with NestJS
- Backend generates real signed JWTs
- Refresh token mechanism for long sessions
- Eventually migrate to **httpOnly cookies** for production security

### Why localStorage Now, Not Cookies?
- No backend exists yet to set httpOnly cookies
- localStorage is industry-standard for SPA learning projects
- Easy migration path when backend is built

---

## 👥 Role-Based Access Control (RBAC)

Three user roles with progressive permissions:

| Role | Permissions |
|------|-------------|
| 👑 **Admin** | Full access to all features (CRUD on everything) |
| 👔 **Manager** | View all, limited edit, can void sales |
| 🛒 **Cashier** | View all, process sales only |

### UI Strategy: "Visible but Disabled"
- All roles see the **same UI**
- Unauthorized actions are **disabled, not hidden**
- Tooltips explain why actions are unavailable
- **Backend enforces permissions** (frontend is for UX only)

---

## 📱 Responsive Design Strategy

**Mobile-First Approach:**
- Designed for tablets and phones first
- Desktop is a progressive enhancement
- Touch-friendly UI (large tap targets)
- Optimized for use in shop environments

**Breakpoints (Tailwind defaults):**
- `sm`: 640px (large phones)
- `md`: 768px (tablets)
- `lg`: 1024px (desktops)
- `xl`: 1280px (large screens)

---

## 📂 Folder Structure Philosophy
src/
├── assets/          # Images, fonts, static files
├── components/      # Reusable UI components
│   ├── common/      # Used across multiple features
│   └── auth/        # Feature-specific components
├── pages/           # Route-level components (full pages)
├── store/           # Redux store, slices
├── hooks/           # Custom React hooks
├── utils/           # Helper functions
├── services/        # API calls, external integrations
└── constants/       # App-wide constants

**Key Principles:**
1. **Feature-based organization** — Group by feature, not by file type
2. **Reusability** — Common components in `common/` folder
3. **Separation of concerns** — Pages handle layout, components handle UI logic
4. **Single responsibility** — Each file does one thing well

---

## 🚀 Deployment Strategy (Planned)

### Infrastructure: AWS
- **Frontend:** AWS S3 + CloudFront (static hosting + CDN)
- **Backend:** AWS EC2 or ECS (containerized with Docker)
- **Database:** AWS RDS (managed PostgreSQL)
- **File Storage:** AWS S3 (product images, receipts)
- **DNS:** AWS Route 53

### CI/CD (Planned)
- **GitHub Actions** for automated testing and deployment
- **Develop branch** → Staging environment
- **Main branch** → Production environment

---

## 🔄 State Management Strategy

### Global State (Redux)
Used for data shared across multiple components:
- Authentication (user, token, role)
- Cart/Active sale
- App-wide settings

### Local State (useState)
Used for component-specific data:
- Form inputs
- UI toggles (modals, dropdowns)
- Temporary UI state

### Server State (Future: React Query)
For API data caching and synchronization:
- Product lists
- Customer data
- Reports

---

## 🧪 Testing Strategy (Planned)

- **Unit tests:** Vitest (for utility functions, hooks)
- **Component tests:** React Testing Library
- **E2E tests:** Playwright (critical user flows)
- **API tests:** Jest + Supertest (NestJS)

---

## 📊 Performance Considerations

- ⚡ Code splitting with React Router lazy loading
- 🖼️ Image optimization (WebP format)
- 📦 Bundle size monitoring
- 🔄 Memoization for expensive computations
- 💾 localStorage caching for offline-ish behavior

---

## 🔒 Security Considerations

- ✅ Never store sensitive data (passwords, card info) in frontend
- ✅ All API calls over HTTPS
- ✅ JWT tokens with reasonable expiry (24h)
- ✅ Backend validates ALL permissions (never trust frontend)
- ✅ SQL injection prevention via ORM
- ✅ XSS prevention via React's auto-escaping
- ✅ CSRF protection (when using cookies)
- ✅ Environment variables for secrets

---

## 📝 Decision Log

Major decisions are documented in [`docs/decisions/`](./decisions/) (Architecture Decision Records).

---

**Last Updated:** May 2026
