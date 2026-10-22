# Dental AI Receptionist — Production Deployment & Operations Checklist

## 1. Environment Variables Specification

> [!CAUTION]
> Never commit actual credentials, secret keys, or connection strings to source control or logs. The following lists variable names only.

### Backend API (Render / Node.js)
| Variable Name | Description | Required in Production |
|---|---|---|
| `PORT` | HTTP port for the Express application (default: 3001) | Yes |
| `NODE_ENV` | Runtime environment (`production` or `development`) | Yes |
| `DATABASE_URL` | Neon PostgreSQL pooled connection string (`api` schema) | Yes |
| `DIRECT_URL` | Neon PostgreSQL direct connection string (for migrations) | Yes |
| `JWT_SECRET` | Cryptographically random secret for signing access tokens (min 64 chars) | Yes |
| `JWT_EXPIRES_IN` | Access token lifespan (e.g. `15m`) | Yes |
| `REFRESH_TOKEN_SECRET` | Cryptographically random secret for refresh tokens (min 64 chars) | Yes |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifespan (e.g. `7d`) | Yes |
| `CORS_ORIGIN` | Authorized frontend origin URL(s) (comma-separated for multiple) | Yes |
| `META_VERIFY_TOKEN` | WhatsApp webhook challenge verification token | If WhatsApp enabled |
| `META_APP_SECRET` | Meta app secret for HMAC-SHA256 signature verification | If WhatsApp enabled |
| `N8N_WEBHOOK_URL` | Outbound trigger URL for n8n automation | Optional |
| `LOG_LEVEL` | Minimum log severity level (`info`, `warn`, `error`) | Yes |

### Frontend Application (Vercel / Vite SPA)
| Variable Name | Description | Required in Production |
|---|---|---|
| `VITE_API_BASE_URL` | Base URL of the deployed Express backend (e.g. `https://api.yourclinic.com`) | Yes |

---

## 2. Deployment Sequence

### Phase 1: Database Verification
1. Ensure Neon PostgreSQL database is operational and schema `api` contains valid tables.
2. Confirm Migration `1.3.0` (`002_add_services_pricing_and_holiday_overrides.sql`) is recorded in `api.schema_migrations`.
3. Run database migration verification:
   ```bash
   npx prisma migrate deploy --schema=apps/api/src/database/prisma/schema.prisma
   ```
   *Verify that no existing tables or appointments are modified, truncated, or dropped.*

### Phase 2: Backend API Deployment (Render)
1. Set all required environment variables in Render service dashboard.
2. Trigger deployment from the target branch.
3. Verify build command:
   ```bash
   npm run build
   ```
4. Verify start command:
   ```bash
   node dist/server.js
   ```
5. Check Render deployment logs to confirm:
   - `[INFO] Database connected`
   - `[INFO] 🦷 Dental Clinic API running`
6. Verify API health check:
   ```bash
   curl -i https://<render-backend-url>/health
   ```
   Expected response: `HTTP 200 OK`, `{"status":"ok"}`.

### Phase 3: Frontend Web Deployment (Vercel)
1. Configure `VITE_API_BASE_URL` pointing to the deployed Render backend URL.
2. Deploy the `apps/web` project to Vercel.
3. Verify production build output:
   - `dist/index.html`
   - CSS & JS bundles generated without TypeScript errors (`tsc && vite build`).

---

## 3. Post-Deployment Smoke Test Protocol

Perform these verification checks immediately after deployment:

1. **Clean Tenant Self-Service Registration**:
   - Register a new clinic with test name and jurisdiction (e.g. `Austin Dental Studio`, Country: `US`).
   - Confirm immediate login with new credentials.
   - Verify that the clinic receives its actual clinic name in the sidebar (never "Demo Dental Clinic").
   - Navigate to **Dental Services**: verify `0` demo treatments exist.
   - Navigate to **Dentists & Hours**: verify `0` dentists and an alert banner indicating operating hours are unconfigured.
2. **Service Catalog & Pricing Test**:
   - Add a service with pricing model `starting_from` and fee (e.g. $150.00).
   - Add a consultation service with pricing model `quote_required` (no fee).
   - Hard refresh the page: confirm both services persist and display their appropriate pricing badges.
3. **Public Holidays & Working Day Override Test**:
   - Under **Dentists & Hours > Holidays & Clinic Closures**, select the `Public Holidays` tab.
   - Confirm national holidays for the clinic's configured country appear (e.g. Memorial Day for US, Bank Holidays for GB).
   - Click **Work This Day** on a holiday: verify status changes to `Open (Working Day)`.
4. **Timezone & Appointment Integrity**:
   - Check the top header timezone badge.
   - Confirm it displays the clinic's configured timezone.
   - Check existing appointment `DZXV-CUIN`: verify original time and data remain intact.
5. **AI Receptionist View (Blank-Screen Regression Check)**:
   - Click on the `AI Receptionist` tab.
   - Confirm page renders immediately without blanking out.
   - Confirm active conversation list displays verified patient names (e.g. `Rahul Sharma`).
   - Inspect browser console: verify **0 uncaught TypeErrors** (`d.getTime`).
6. **Tenant Isolation Verification**:
   - In Developer Tools network tab, confirm requests include `Authorization: Bearer <token>`.
   - Confirm that cross-tenant requests reject unauthorized ID access.

---

## 4. Rollback Strategy & Data Safety

In the event of an unforeseen production issue:

1. **Frontend Rollback**:
   - In Vercel, navigate to Deployments and instantly revert to the previous working deployment. No database rollback is required for frontend-only reverts.
2. **Backend Rollback**:
   - In Render, redeploy the previous successful commit tag.
3. **Database Integrity Preservation**:
   - **DO NOT** execute `prisma migrate reset` or `db push --force-reset`.
   - All migrations applied during this cycle are strictly additive and backward-compatible (`ADD COLUMN IF NOT EXISTS`). Rolling back application code will not break existing database relationships or corrupt appointment records.
