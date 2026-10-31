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
- [Returns and Refunds](./returns.md) — Returns on completed sales, refunds, RET- numbers, the inspection list (Phase 6.4 P7)
- [Stock Movement Ledger](./stock-ledger.md) — Every stock and unit change recorded, opening balances, stale-adjustment 409, reconciliation and deployment (Phase 1 T1)
- [Cash Days](./cash-days.md) — Daily opening and closing balance, expected cash, the day summary (Phase 6.4 P9)
- [Used Phones Backend](./used-phones.md) — Customers, per-IMEI ProductUnits, phone purchase intake, serialized sale lines, trade-ins (Phase 6.3.5)
- [Testing](./testing.md) — Test DB, unit and e2e patterns