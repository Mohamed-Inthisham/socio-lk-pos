# Audit Logs

## Purpose

Audit logs record who did what, to what, and when, across the app. They exist for accountability and dispute resolution — for example, answering "why did this product's price change?" or "who deactivated this cashier account?"

## What Gets Logged

- **Only mutations**: CREATE, UPDATE, DELETE. Reads (GET) are not logged.
- **Only routes explicitly marked** with `@Auditable(entityType, action)`. Routes without the decorator have zero overhead.

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

`request.ip` currently reads directly from the socket. In production (behind AWS ALB/CloudFront), Express `trust proxy` must be enabled in `main.ts` so the real client IP is read from `X-Forwarded-For` instead of the load balancer's IP. This is deferred to the deployment phase.