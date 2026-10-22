# Dental AI Receptionist — Clinic Admin Dashboard

## Overview

Production-grade multi-tenant Clinic Admin Dashboard for the Dental AI Receptionist SaaS. Built on the existing Neon PostgreSQL database, preserving all existing n8n workflow compatibility and business logic.

## Architecture

```
dental-clinic-dashboard/
├── apps/
│   ├── api/          — Express + TypeScript + Prisma backend
│   └── web/          — React + Vite + TypeScript + Tailwind frontend
├── packages/
│   └── shared/       — Shared types, schemas, constants
└── docs/             — Architecture, API contracts, DB inventory
```

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0
- Access to the Neon PostgreSQL database (credentials in `.env`)

### 1. Clone and install

```bash
git clone <repository-url>
cd dental-clinic-dashboard
npm install
```

### 2. Configure environment variables

```bash
# Backend
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with real credentials (see Environment Variables below)

# Frontend
cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env with the API base URL
```

### 3. Generate Prisma client and run migrations

```bash
npm run db:generate
npm run db:migrate      # Only after verifying schema against live DB
```

### 4. Run database inventory (read-only, requires DATABASE_URL)

```bash
npm run db:inventory
```

### 5. Start development servers

```bash
npm run dev
# API: http://localhost:3001
# Web: http://localhost:5173
```

## Environment Variables

### `apps/api/.env`

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string (pooled) |
| `DIRECT_URL` | Optional | Neon direct connection (for migrations) |
| `NODE_ENV` | ✅ | `development` / `production` / `test` |
| `PORT` | ✅ | API server port (default: 3001) |
| `JWT_SECRET` | ✅ | HS256 signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | ✅ | Token lifetime e.g. `15m` |
| `REFRESH_TOKEN_SECRET` | ✅ | Refresh token signing secret |
| `REFRESH_TOKEN_EXPIRES_IN` | ✅ | e.g. `7d` |
| `CORS_ORIGINS` | ✅ | Allowed origins e.g. `http://localhost:5173` |
| `LOG_LEVEL` | Optional | `debug` / `info` / `warn` / `error` |
| `SMTP_HOST` | Optional | Email provider host |
| `SMTP_PORT` | Optional | Email provider port |
| `SMTP_USER` | Optional | Email username |
| `SMTP_PASS` | Optional | Email password |
| `SMTP_FROM` | Optional | From address |
| `META_WHATSAPP_TOKEN` | Optional | WhatsApp Business API token (server-side only) |
| `META_PHONE_NUMBER_ID` | Optional | WhatsApp phone number ID |

### `apps/web/.env`

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | ✅ | Backend API base URL e.g. `http://localhost:3001` |

> ⚠️ **Never** put `DATABASE_URL`, `JWT_SECRET`, or any provider secret in the `apps/web/.env` file.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start both API and web in development mode |
| `npm run build` | Production build of all packages |
| `npm run lint` | ESLint across all packages |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run all tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:inventory` | Run read-only database schema inventory |

## Database

- **Provider**: Neon PostgreSQL
- **Application schema**: `api`
- **ORM**: Prisma (for type-safe queries) + raw SQL for complex business functions
- **Business functions**: Preserved from existing `api.*` schema functions
- **n8n compatibility**: All existing workflow database calls remain unmodified

See [`docs/database-inventory.md`](docs/database-inventory.md) for the complete schema inventory.

## Security

- JWT-based authentication with short-lived access tokens and refresh tokens
- All clinic data is scoped server-side using the authenticated user's clinic membership
- No credentials are exposed to the frontend
- Row-level authorization enforced in every API endpoint
- Separate Super Admin area (not included in this application)

## Testing

```bash
npm run test            # All tests
npm run test:api        # API unit + integration tests
npm run test:web        # Frontend tests
```

Security and tenant-isolation tests are in `apps/api/tests/security/`.

## Deployment

See [`docs/deployment.md`](docs/deployment.md) for full deployment instructions.

## Documentation

| Document | Description |
|---|---|
| [`docs/database-inventory.md`](docs/database-inventory.md) | Complete schema inventory |
| [`docs/database-functions.md`](docs/database-functions.md) | Business function contracts |
| [`docs/n8n-compatibility.md`](docs/n8n-compatibility.md) | n8n workflow dependency map |
| [`docs/api-contracts.md`](docs/api-contracts.md) | REST API specifications |
| [`docs/security-review.md`](docs/security-review.md) | Security analysis |
| [`docs/feature-matrix.md`](docs/feature-matrix.md) | Feature implementation status |
| [`docs/deployment.md`](docs/deployment.md) | Deployment guide |
