# API Documentation (Swagger / OpenAPI)

## Purpose

The backend exposes an auto-generated, interactive OpenAPI 3.0 specification and browsable Swagger UI. This is the single source of truth for API consumers (currently the React frontend; potentially future integrations).

## Access

- **URL:** `http://localhost:3000/api/docs`
- **Availability: development only.** Swagger is skipped when `NODE_ENV=production`.
- **Rationale:** the API is internal to the POS frontend. Exposing endpoint shapes, DTOs, and validation rules publicly gives an attacker a map of the API surface with no upside.

## How it Works

- `@nestjs/swagger` scans decorated controllers and DTOs at boot and builds an OpenAPI 3.0 document.
- `SwaggerModule.setup('api/docs', ...)` mounts the interactive UI at that path.
- The setup path is mounted **outside** the global `/api/v1` prefix intentionally, so docs live at `/api/docs`, not `/api/v1/api/docs`.

## Authentication in the Docs UI

The API uses **httpOnly cookies** for auth (`access_token`, `refresh_token`), not `Authorization` headers.

- Swagger's "Authorize" dialog is **not used** for cookie-based auth — cookies are sent automatically by the browser on every request, including from the Swagger UI itself.
- The correct flow:
  1. Expand `POST /api/v1/auth/login`, "Try it out", enter credentials, Execute → sets cookies in your browser.
  2. Any subsequent "Try it out" call (including protected endpoints) will send those cookies automatically.
- The padlock icon (🔒) on endpoints indicates the endpoint requires authentication, driven by `@ApiCookieAuth('access_token')`.

## Decorator Conventions

Applied consistently across the codebase:

**DTOs (`class-validator` for runtime validation, `@nestjs/swagger` for docs):**
- `@ApiProperty` on required fields, `@ApiPropertyOptional` on optional ones.
- Always include `example` (realistic value shown in Try It Out), `description` (short one-liner), and constraints (`minLength`, `maxLength`, `enum`) where relevant.
- For DTOs derived via `PartialType`/`OmitType`, always import from `@nestjs/swagger`, not `@nestjs/mapped-types` — the swagger versions preserve `@ApiProperty` metadata.
- **`null` on a NOT NULL field is a 400, never a 500 or a silent no-op.** PATCH semantics: omitted = don't touch, `null` = clear (nullable fields only), value = set. `@IsOptional()` skips validation for `null` as well as `undefined`, so:
  - Update DTOs built with `PartialType` pass `{ skipNullProperties: false }`: an omitted field is skipped, but `null` runs the field's own validators (e.g. "name must be a string").
  - A field that is optional but NOT NULL in the table (`is_active`, `barcode`, `sort_order`, a quantity…) uses `@IsOptionalNotNull()` (`common/validators`) instead of `@IsOptional()`: omitted is fine, `null` is "`<field>` must not be null". Put it on the create DTO; the update DTO inherits it.
  - A nullable field keeps `@IsOptional()` (or `@IsOptional() @ValidateIf((_, v) => v !== null)`), so `null` clears it.
  - `test/null-fields.e2e-spec.ts` checks this per entity.

**Controllers:**
- `@ApiTags('...')` at the class level — groups endpoints in the UI. Use human-readable names ("Audit Logs", "Health").
- `@ApiCookieAuth('access_token')` at the class level when *every* route requires auth; otherwise per-route.
- `@ApiOperation({ summary, description })` on every route. `summary` is imperative and short; `description` gives extra context.
- `@ApiResponse` documenting the realistic status codes: 200/201, plus 400/401/403/404 where they apply. Do not exhaustively enumerate every possible 5xx.
- `@ApiParam` for path params with descriptive labels; `@ApiQuery` if you ever have non-DTO query params.

## Adding a New Endpoint

When adding a new route, minimum decoration:

```typescript
@Get(':id')
@ApiOperation({ summary: 'Short imperative description' })
@ApiParam({ name: 'id', description: 'Resource UUID', format: 'uuid' })
@ApiResponse({ status: 200, description: 'Resource returned' })
@ApiResponse({ status: 404, description: 'Not found' })
async findOne(@Param('id', ParseUUIDPipe) id: string) { ... }
```

If the route uses a DTO, ensure every field on that DTO has `@ApiProperty` or `@ApiPropertyOptional`.

## Deployment Note

Swagger currently loads all NestJS controller metadata at boot; skipping it in production also gives a tiny startup-time win. The check is a simple `NODE_ENV !== 'production'` guard in `main.ts`.