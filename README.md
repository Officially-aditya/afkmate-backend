# AFKmate Backend

Next.js 15 App Router API backend for the AFKmate VS Code extension. Deployed on Vercel at `https://api.afkmate.in`.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) |
| Auth | BetterAuth v1.5.5 (GitHub + Google OAuth, bearer plugin) |
| Database | Neon (serverless Postgres) + Drizzle ORM |
| Quota / Rate-limit | Upstash Redis + `@upstash/ratelimit` |
| AI | Anthropic SDK (`claude-haiku-4-5` / `claude-sonnet-4`) |
| Payments | LemonSqueezy (webhooks + checkout sessions) |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Database (Neon)
DATABASE_URL=

# BetterAuth
BETTER_AUTH_SECRET=          # random 32+ char secret
BETTER_AUTH_URL=https://api.afkmate.in

# OAuth providers
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Upstash Redis (quota + rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# LemonSqueezy (payments)
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_PREMIUM_VARIANT_ID=
LEMONSQUEEZY_PREMIUM_PLUS_VARIANT_ID=
```

### 3. Push database schema

```bash
npm run db:push
```

### 4. Run locally

```bash
npm run dev       # http://localhost:3000 (Turbopack)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run db:push` | Push schema to DB (no migration file) |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:studio` | Open Drizzle Studio |

## API Reference

All routes are under `/api/`. Authentication uses `Authorization: Bearer <session_token>` (BetterAuth bearer plugin).

### Auth

| Route | Description |
|---|---|
| `GET/POST /api/auth/[...all]` | BetterAuth catch-all (sign-in, sign-out, OAuth callbacks) |
| `GET /api/auth/callback-bridge` | Redirects OAuth session token to `vscode://afkmate.afkmate/auth?token=<token>` after OAuth completes |

**OAuth flow for VS Code extension:**
1. Extension opens browser → `/login?redirect_uri=vscode://afkmate.afkmate/auth`
2. User signs in via GitHub/Google → BetterAuth completes OAuth
3. `/api/auth/callback-bridge` extracts the session token from the cookie and redirects to the `vscode://` URI
4. Extension URI handler saves the token and calls `/api/me`

### User

#### `GET /api/me`
Returns the authenticated user's profile and quota.

**Response:**
```json
{
  "id": "...",
  "name": "username",
  "email": "user@example.com",
  "image": null,
  "tier": "free",
  "quota": {
    "limit": 20,
    "used": 5,
    "remaining": 15
  }
}
```

Premium Plus users receive `limit: -1, remaining: -1` (unlimited).

#### `PATCH /api/me`
Updates the authenticated user's display name.

**Body:** `{ "username": "new name" }`

### Analysis

#### `POST /api/analyze`
Main analysis endpoint. Runs IP-based rate limiting before auth, then checks/increments the user's monthly quota.

**Headers:** `Authorization: Bearer <token>`

**Response headers:** `X-Quota-Used`, `X-Quota-Remaining`, `X-Quota-Limit`

Model used per tier:
- `free` → `claude-haiku-4-5-20251001`
- `premium` / `premium_plus` → `claude-sonnet-4`

### Events (SSE)

#### `GET /api/events`
Server-Sent Events stream for real-time quota updates. The extension subscribes on startup and reconnects with exponential backoff (2s–64s). Falls back to 30-second polling on failure.

**Event format:**
```
event: quota
data: {"tier":"free","quota":{"limit":20,"used":6,"remaining":14}}
```

### Checkout

#### `GET /api/checkout/premium`
#### `GET /api/checkout/premium-plus`
Requires an authenticated session. Creates a LemonSqueezy checkout session with the user's email pre-filled (prevents email mismatch on webhook), then redirects to the checkout URL.

Unauthenticated users are redirected to `/login?next=/api/checkout/<plan>` first.

### Webhooks

#### `POST /api/webhooks/lemonsqueezy`
Verifies HMAC-SHA256 signature against `LEMONSQUEEZY_WEBHOOK_SECRET`. On `order_created` events, resolves the purchased variant to a tier and upgrades the user in the database.

### Health

#### `GET /api/health`
Returns `{ "status": "ok" }`. Used by uptime monitors.

## Database Schema

Defined in `lib/db/schema.ts` (Drizzle + Neon Postgres):

| Table | Purpose |
|---|---|
| `user` | Accounts (includes `tier: free\|premium\|premium_plus`) |
| `session` | BetterAuth sessions |
| `account` | OAuth provider links |
| `verification` | Email verification tokens |

## Tiers & Quota

| Tier | Monthly analyses | Model | Price |
|---|---|---|---|
| Free | 20 | Claude Haiku 4.5 | $0 |
| Premium | 60 | Claude Sonnet 4 | $10/mo |
| Premium Plus | Unlimited | Claude Sonnet 4 | $49/mo |

Quota is tracked in Redis under key `quota:{userId}:{YYYY-MM}` and resets automatically each calendar month.

## Security

- CORS restricted to `afkmate.in`, `www.afkmate.in`, `api.afkmate.in` in production (all origins allowed in development)
- Security headers via `next.config.ts`: `X-Content-Type-Options`, `X-Frame-Options`, `HSTS`, `X-XSS-Protection`
- `x-powered-by` header disabled
- LemonSqueezy webhooks verified with HMAC-SHA256
- Rate limiting on `/api/analyze` before authentication (Upstash Redis)

## Project Structure

```
backend/
├── app/
│   ├── api/
│   │   ├── analyze/             # Main analysis endpoint
│   │   ├── auth/
│   │   │   ├── [...all]/        # BetterAuth catch-all
│   │   │   └── callback-bridge/ # VS Code OAuth redirect
│   │   ├── checkout/[plan]/     # LemonSqueezy checkout
│   │   ├── events/              # SSE quota stream
│   │   ├── health/              # Health check
│   │   ├── me/                  # User profile + quota
│   │   ├── utils/               # auth, quota, rate-limit, validation
│   │   └── webhooks/
│   │       └── lemonsqueezy/    # Purchase → tier upgrade
│   └── login/                   # OAuth sign-in page
├── lib/
│   ├── auth.ts                  # BetterAuth instance
│   └── db/
│       ├── index.ts             # Drizzle + Neon client
│       └── schema.ts            # Table definitions
├── middleware.ts                 # CORS middleware
└── next.config.ts               # Security headers
```
