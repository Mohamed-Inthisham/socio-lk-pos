# Security

The backend ships with three production-grade security layers, applied
globally to every endpoint.

## 1. HTTP Security Headers (Helmet)

`helmet()` is registered as Express middleware in `src/main.ts`. It sets ~15
secure HTTP headers that close common attack vectors:

| Header | Protects against |
|---|---|
| `Content-Security-Policy` | XSS by restricting allowed resource sources |
| `Strict-Transport-Security` | Downgrade attacks over HTTPS |
| `X-Content-Type-Options: nosniff` | MIME-sniffing attacks |
| `X-Frame-Options: SAMEORIGIN` | Clickjacking via iframe |
| `Referrer-Policy: no-referrer` | Sensitive URL leakage |

No configuration tuning is needed for the defaults. Verify in DevTools →
Network → any request → Response Headers.

## 2. CORS

Configured in `src/main.ts` via `app.enableCors()`. In development, only
`http://localhost:5173` (the Vite frontend) is allowed. In production, this
should be tightened to the deployed frontend domain.

`credentials: true` is set so authenticated requests (cookies, Authorization
headers) work cross-origin once we move to JWT auth.

## 3. Rate Limiting (Throttler)

`@nestjs/throttler` is wired in `src/app.module.ts` as a global guard with
two tiers:

| Tier | Window | Limit |
|---|---|---|
| `short` | 1 second | 10 requests |
| `long` | 1 minute | 100 requests |

The short tier catches burst attacks (DDoS, automated brute-force).
The long tier catches sustained slow attacks that fly under the short radar.

Returns HTTP `429 Too Many Requests` when exceeded.

### Tuning per endpoint

To override the global limit on a specific endpoint, use `@Throttle()`:

```typescript
import { Throttle } from '@nestjs/throttler';

@Throttle({ short: { limit: 3, ttl: 1000 } })
@Post('login')
login() { ... }
```

The login endpoint should always have a stricter limit than the global default.

## 4. API Versioning

All routes are prefixed with `/api/v1` (configured in `main.ts`). When breaking
changes are needed, introduce `/api/v2` rather than mutating v1. This lets old
clients keep working while new ones migrate.

## Production checklist

- [ ] Tighten CORS to the actual frontend domain
- [ ] Run behind HTTPS (handled by AWS ALB / CloudFront)
- [ ] Move JWT secrets to AWS Secrets Manager
- [ ] Add stricter rate limits on `/auth/*` endpoints
- [ ] Enable PostgreSQL SSL connections