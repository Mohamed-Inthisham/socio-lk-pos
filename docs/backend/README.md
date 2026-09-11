# Backend Documentation

Reference docs for the SOCIO.LK POS backend (NestJS + PostgreSQL + TypeORM).

## Contents

- [Configuration](./configuration.md) — Environment variables and Zod validation
- [Database](./database.md) — TypeORM setup, entity conventions, schema overview
- [Migrations](./migrations.md) — Migration workflow, forward and reverse
- [Authentication](./auth.md) — JWT access + refresh, rotation, cookies
- [RBAC](./rbac.md) — Roles, guards, decorators, 401 vs 403 discipline
- [Audit Logs](./audit-logs.md) — Interceptor, entity design, retention policy
- [Security](./security.md) — Helmet, CORS, rate limiting, cookie hardening
- [API Documentation](./api-documentation.md) — Swagger setup and conventions
- [Products Backend](./products.md) — Branches, brands, categories, products, stock, SKU/barcode counter
- [Sales Backend](./sales.md) — Suppliers, sales lifecycle, lines, payments, complete/void transactions
- [Testing](./testing.md) — Test DB, unit and e2e patterns