# Database Migrations

Schema changes are managed via TypeORM migrations. The app uses `synchronize: false`
in every environment — migrations are the only acceptable way to evolve the schema.

## Why migrations (not auto-sync)

Auto-sync (`synchronize: true`) lets TypeORM mutate the schema to match entities at
runtime. This is dangerous because:

- It can drop columns and lose data
- Two devs editing different entities can corrupt the database
- There is no audit trail of what changed when
- Rollback is impossible

Migrations make every schema change explicit, versioned, reviewable, and reversible.

## Files

| File | Purpose |
|---|---|
| `src/database/data-source.ts` | Standalone TypeORM DataSource used by the migration CLI |
| `src/database/migrations/` | Timestamped migration files (one per schema change) |

## NPM scripts

| Script | What it does |
|---|---|
| `npm run migration:generate -- <path/Name>` | Auto-generates a migration by diffing entities against the database |
| `npm run migration:create -- <path/Name>` | Creates an empty migration (write SQL manually) |
| `npm run migration:run` | Applies pending migrations |
| `npm run migration:revert` | Rolls back the most recently applied migration |
| `npm run migration:show` | Lists migrations and their status |

## Typical workflow (auto-generated)

1. Edit or create an entity (`*.entity.ts`)
2. Generate the migration:
```bash
   npm run migration:generate -- src/database/migrations/AddPhoneToUser
```
3. Review the generated `up()` and `down()` — TypeORM is smart but not perfect
4. Run it locally:
```bash
   npm run migration:run
```
5. Verify the change in DBeaver
6. Commit BOTH the entity change AND the migration file in the same PR

## Manual workflow (data fixes, indexes, seeds)

For things entities can't express (data backfills, complex indexes, seeded rows):

1. Create an empty migration:
```bash
   npm run migration:create -- src/database/migrations/SeedAdminUser
```
2. Write SQL by hand in `up()` and `down()`
3. Run and verify
4. Commit

## Golden rules

- **Always write `down()`.** Without it, the migration is one-way and unsafe.
- **Never edit a migration after merging to develop/main.** It's immutable. Create a new migration to fix it.
- **Always revert before deleting** a local-only migration file.
- **Always review auto-generated migrations** — sometimes they produce destructive SQL.
- **Test locally before pushing.** Run forward, run backward, run forward again.

## Migration tracking

TypeORM auto-creates a `migrations` table on first run. It records which migrations
have been applied. This is how the tool knows what to skip on subsequent `migration:run`
calls.

Don't manually edit this table.

## Production deployment

In production (AWS RDS), migrations run on app startup or as a one-off CI step:

```bash
npm run build
npm run migration:run
npm run start:prod
```

The `synchronize: false` setting ensures no schema changes happen outside this flow.