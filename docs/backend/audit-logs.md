# Audit Logs

## Purpose

Audit logs record who did what, to what, and when, across the app. They exist for accountability and dispute resolution — for example, answering "why did this product's price change?" or "who deactivated this cashier account?"

## What Gets Logged

- **Only mutations**: CREATE, UPDATE, DELETE. Reads (GET) are not logged.
- **Only routes explicitly marked** with `@Auditable(entityType, action)`. Routes without the decorator have zero overhead.
- **Service-written rows:** this page predates them. Some actions are written by their service with `writeAuditEntry` (`audit-log/utils/write-audit-entry.ts`), inside the action's own transaction, instead of by the interceptor: for example `DAY_OPEN`, `DAY_CLOSE`, `VOID`, `RETURN`, `INSPECTION_PASSED`, the approval-PIN actions and `DRAFT_DISCARDED` (below). Their `action` goes beyond CREATE / UPDATE / DELETE, and their `changes` are whatever the service records, not the interceptor's diff.

## Schema (`audit_logs` table)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid, nullable | FK to users. `ON DELETE SET NULL` — logs survive user deletion. |
| user_name | varchar | Snapshot at time of action. Preserved even if user renamed/deleted. |
| user_role | varchar | Snapshot at time of action. |
| action | varchar | CREATE, UPDATE, or DELETE. |
| entity_type | varchar | e.g. `"User"`, `"Product"`. |
| entity_id | varchar | The row that was affected. |
| changes | jsonb, nullable | Diff of changed fields only. Null for DELETE. |
| description | text, nullable | Optional human note. |
| ip_address | varchar, nullable | Client IP. On localhost, appears as `::1`. |
| created_at | timestamp, **indexed** | For retention purge (indexed) and default sort. |

Audit logs are **append-only** — no `updated_at`, no soft-delete. The only future write is a scheduled purge job.

## Diff Format

For UPDATE actions, `changes` stores only the fields that actually changed:

```json
{
  "full_name": { "old": "John Doe", "new": "Johnny Doe" },
  "email": { "old": "old@x.com", "new": "new@x.com" }
}
```

Noise fields (`updated_at`, `created_at`, `deleted_at`) are excluded from the diff. If nothing meaningful changed, `changes` is `null`.

## Usage

Mark a route as auditable:

```typescript
@Auditable('User', AuditAction.UPDATE)
@Patch(':id')
async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
  return this.usersService.update(id, dto);
}
```

Requirements:
- The route must have an `:id` param for UPDATE/DELETE (needed to fetch before-state).
- The route must be behind `JwtAuthGuard` (default; global via `APP_GUARD`) so `request.user` is populated.

## Architecture

- `@Auditable()` decorator attaches metadata (`entityType`, `action`) to the route.
- `AuditLogInterceptor` (registered globally via `APP_INTERCEPTOR`) reads the metadata via `Reflector`. If none, the request passes through untouched.
- For UPDATE/DELETE, the interceptor fetches the entity from the DB via a generic repository lookup (`dataSource.getRepository(entityType)`) *before* the handler runs, capturing the "before" state.
- After the handler completes, the interceptor computes the diff (UPDATE only) and writes an `AuditLog` row.
- The write is **fire-and-forget** inside `tap()` and wrapped in `try/catch` — a failed audit write **never** breaks the actual user request. Errors are logged to the server console.

## `DRAFT_DISCARDED`

Written by the service, not the interceptor: `writeAuditEntry` (`audit-log/utils/write-audit-entry.ts`) inside the transaction that deletes the draft, so the row commits or rolls back with the delete (#75). One row per discarded draft, from two places:

- **A day close** (`CashDaysService` close, [cash-days.md](./cash-days.md)): every unpaid DRAFT at the closing branch. The actor is the user closing the day.
- **`DELETE /sales/:id`** (`SalesService.discardDraft`, [sales.md](./sales.md)): one unpaid DRAFT. The actor is the user discarding it.

`entity_type` is `"Sale"`, `entity_id` the sale's id, `ip_address` the request's. `changes` holds the draft as it was, since the sale row no longer exists.

Example (values illustrative; the keys and their shape are what the code writes):

```json
{
  "status": { "old": "DRAFT", "new": "DISCARDED" },
  "sale": {
    "old": {
      "id": "…", "branch_id": "…", "cashier_id": "…", "cashier_name": "…", "customer_id": null,
      "subtotal": "1980.00", "discount_total": "0.00", "tax_total": "0.00", "total": "1980.00",
      "notes": null, "created_at": "…", "updated_at": "…",
      "lines": [{
        "line_number": 1, "product_id": "…", "product_sku_snapshot": "…", "product_name_snapshot": "…",
        "quantity": 2, "unit_price": "990.00", "discount_type": null, "discount_value": null,
        "discount_amount": "0.00", "line_total": "1980.00",
        "product_unit_id": null, "imei_snapshot": null, "identifier_type_snapshot": null
      }]
    },
    "new": null
  },
  "discard": { "old": null, "new": { "reason": "AUTO_DISCARD_ON_DAY_CLOSE", "cash_day_id": "…", "business_date": "2026-10-29", "closed_by": "…" } }
}
```

From `DELETE /sales/:id`, `discard.new` is `{ "reason": "MANUAL_DISCARD", "discarded_by": "…" }`. No cost price is stored (`cost_price_snapshot` is never selected). The description names the draft, its line count, total and cashier, and who discarded it. The day close's `DAY_CLOSE` row also records `drafts_discarded`, the number discarded. `GET /audit-logs?action=DRAFT_DISCARDED` lists them.

## Query API

`GET /api/v1/audit-logs` — admin-only.

Query parameters (all optional):

| Param | Type | Notes |
|---|---|---|
| user_id | UUID | Filter by acting user |
| entity_type | string | e.g. `User` |
| entity_id | string | Full history of one record |
| action | enum | CREATE / UPDATE / DELETE |
| from | ISO date | `created_at >= from` |
| to | ISO date | `created_at <= to` |
| page | int, ≥1 | Default 1 |
| limit | int, 1–100 | Default 20 |

Response:
```json
{
  "data": [ /* AuditLog rows, newest first */ ],
  "total": 234,
  "page": 1,
  "limit": 20
}
```

## Retention

- **Policy: 6 months.**
- Purge mechanism is **not yet implemented** — deferred to a later phase.
- `created_at` is indexed to make the future purge job a simple `WHERE created_at < NOW() - INTERVAL '6 months'` DELETE.

## Deployment note

`ip_address` is `request.ip`, which follows `X-Forwarded-For` only through the proxies `TRUST_PROXY` trusts (see [auth.md](./auth.md), "Client IP and trusted proxies"). By default no proxy is trusted and it is the socket's peer address. Behind a load balancer or CDN, production must set `TRUST_PROXY` to match the real proxy chain, or every entry records the proxy's address; the deployment topology that decides the value isn't settled yet.