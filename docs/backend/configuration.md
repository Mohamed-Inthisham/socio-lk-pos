# Configuration

The backend uses a strict, fail-fast configuration system. All environment
variables are validated at startup with Zod. The app refuses to boot if any
required variable is missing or invalid.

## Files

| File | Purpose |
|---|---|
| `.env` | Real local values. **Not committed.** |
| `.env.example` | Template with placeholder values. Committed. |
| `src/config/env.validation.ts` | Zod schema describing every env var |
| `src/config/validate-env.ts` | Function that runs the schema and throws on invalid config |
| `src/config/typed-config.service.ts` | Type-safe wrapper around `ConfigService` |
| `src/config/config.module.ts` | Global module exporting `TypedConfigService` |
| `src/config/typeorm.config.ts` | Factory that builds TypeORM config from validated env |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | No | `development` | One of: `development`, `production`, `test` |
| `PORT` | No | `3000` | HTTP port |
| `DB_HOST` | Yes | — | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_USERNAME` | Yes | — | PostgreSQL user |
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `DB_NAME` | Yes | — | Database name |
| `JWT_ACCESS_SECRET` | Yes | — | Min 16 chars |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL |
| `JWT_REFRESH_SECRET` | Yes | — | Min 16 chars, different from access secret |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |

## How to use config in code

Inject `TypedConfigService` into any provider or controller. The `get()` method
is fully typed — autocomplete suggests valid keys, and return types are inferred.

```typescript
import { Injectable } from '@nestjs/common';
import { TypedConfigService } from './config/typed-config.service';

@Injectable()
export class SomeService {
  constructor(private readonly config: TypedConfigService) {}

  doSomething() {
    const dbHost = this.config.get('DB_HOST'); // typed as string
    const port = this.config.get('PORT');     // typed as number
  }
}
```

## Adding a new env variable

1. Add it to `.env` (local) with the real value
2. Add it to `.env.example` with a placeholder
3. Add it to `envSchema` in `env.validation.ts` with the right Zod type
4. The `Env` type updates automatically via `z.infer<typeof envSchema>`
5. Use it in code via `config.get('YOUR_NEW_VAR')`

## Why this design

- **Fail fast**: invalid config crashes the app at startup, not at runtime
- **Type safety**: no untyped `process.env.X` strings sprinkled through the code
- **Single source of truth**: the schema documents every required variable
- **Cross-environment safe**: same schema validates dev, test, and production

## Security

- `.env` is in `.gitignore` and must never be committed
- JWT secrets must be at least 16 characters and unique between access and refresh
- In production, prefer a secrets manager (AWS Secrets Manager) over `.env` files