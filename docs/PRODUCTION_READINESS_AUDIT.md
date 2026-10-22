# Dental AI Receptionist — Production-Readiness Remediation, Authentication, Multi-Tenant Isolation, and n8n Integration Audit

## 1. Executive Summary

This audit and remediation report documents the comprehensive production stabilization, authentication implementation, tenant-isolation hardening, contact name resolution, and n8n integration contract definition for the **Dental AI Receptionist** clinic administration SaaS platform.

All investigations, code modifications, build verifications, and automated test executions were performed directly in the repository against the active Neon PostgreSQL database (`api` schema) and Node/Express/React codebases.

### Key Milestones Achieved:
- **Crash Remediation**: Diagnosed and permanently eliminated the uncaught `TypeError: d.getTime is not a function` blank-screen crash in the AI Receptionist module.
- **Enterprise Error Boundaries**: Implemented localized React `ErrorBoundary` wrappers that degrade gracefully into non-blocking recovery cards instead of failing the entire application.
- **Real Contact Name Resolution**: Replaced generic placeholder labels (`WhatsApp user`, `WhatsApp Patient`) with strict, clinic-scoped patient identity resolution prioritizing verified patient charts (`full_name`) and validated phone numbers.
- **Authentication Lifecycle**: Completed clinic self-service onboarding (`POST /api/v1/auth/signup`) using atomic database transactions (`prisma.$transaction`), secure password hashing via `bcryptjs`, enforced server-assigned roles (`admin`), account suspension checks, and refresh-token rotation.
- **Strict Multi-Tenant Isolation**: Enforced tenant ownership across all backend queries, eliminating Insecure Direct Object Reference (IDOR) vulnerabilities and proving cross-tenant separation via automated tests.
- **100% Test & Build Pass Rate**: Ran all unit, security, tenant-isolation, and timezone suites (5 test suites, 48 tests passing) alongside production builds of `@dental/shared`, `@dental/api`, and `@dental/web`.

---

## 2. Root Cause of the Receptionist Crash

### Symptoms & Stack Trace
- **Error**: `Uncaught TypeError: d.getTime is not a function`
- **Location**: `dateTime.ts:44` (`formatTimeInTimezone`) -> `ClinicContext.tsx:68` -> `ReceptionistView.tsx:311` & `282`.
- **Impact**: React rendering tree failed completely, causing the AI Receptionist view to crash into a blank screen.

### Root Cause Analysis
1. In `ReceptionistView.tsx`, when displaying recent conversations, the formatter was invoked with:
   ```ts
   formatTime(c.lastActivity || c.updatedAt || Date.now())
   ```
2. When `c.lastActivity` and `c.updatedAt` were null or undefined, `Date.now()` was passed as the fallback. `Date.now()` returns a JavaScript primitive **number** (epoch milliseconds, e.g., `1728987600000`), NOT a `Date` instance.
3. In `packages/shared/src/utils/dateTime.ts` and `apps/web/src/utils/dateTime.ts`, the previous input check was:
   ```ts
   const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
   ```
4. Because `typeof Date.now() === 'number'`, it skipped the string conversion and assigned the primitive number directly to `d`.
5. When `d.getTime()` was called, the JavaScript V8 runtime threw:
   `Uncaught TypeError: d.getTime is not a function` because `Number.prototype` does not have a `getTime()` method.

### Permanent Fix Implemented
- Created `normalizeDate(input: unknown): Date | null` in `packages/shared/src/utils/dateTime.ts` and `apps/web/src/utils/dateTime.ts`.
- `normalizeDate` handles:
  - `Date` instances (validated with `!isNaN(d.getTime())`).
  - Primitive numbers (epoch milliseconds such as `Date.now()`, and epoch seconds).
  - ISO timestamp strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - Null, undefined, empty strings, and malformed date strings (returns `null` safely without throwing).
  - Custom objects with `.toISOString()` or `.value`.
- Added `getSafeTimezone(timeZone?: string)` that verifies the timezone against `Intl.DateTimeFormat` and gracefully falls back to `'UTC'` if invalid or malformed.
- Wrapped the conversation transcript in an enterprise React `ErrorBoundary` component (`apps/web/src/components/ErrorBoundary.tsx`). If an individual conversation has corrupt data, it displays a sanitized recovery card with a "Retry View" button while keeping the rest of the clinic dashboard operational.

---

## 3. Real Contact Name Resolution Fix

### Problem
The conversation list and chat transcript previously displayed generic placeholders such as `WhatsApp user` or `WhatsApp Patient` even when the patient's verified identity ("Rahul Sharma") was stored in the clinic's database.

### Root Cause
1. `conversations.routes.ts` previously returned database columns as `contactName` and nested `patient: { name, phone }`, but omitted top-level `patientName` and `phone` in the response envelope.
2. In `ReceptionistView.tsx`, the component attempted to access `c.patientName || c.phone || 'WhatsApp Patient'`. Because `c.patientName` was undefined, it fell back to `'WhatsApp Patient'`.
3. In conversations where `c.patient_id` was unlinked during initial webhook ingestion, the query did not join against `api.patients` matching by clinic-scoped phone number.

### Permanent Solution Implemented
1. Added helper `resolveContactIdentity(row)` in `apps/api/src/modules/conversations/conversations.routes.ts` with strict resolution priority:
   - **Priority 1**: Verified clinic-scoped patient record (`p.full_name`) -> displays real patient name (e.g., `Rahul Sharma`).
   - **Priority 2**: Verified patient phone (`p.phone`) if name is empty.
   - **Priority 3**: Channel phone identifier if numeric (e.g., `+919876543210`).
   - **Priority 4**: Safe fallback `'Unknown contact'`. Never emits `WhatsApp user`.
2. Updated SQL queries in `GET /api/v1/conversations` and `GET /api/v1/conversations/:id` to include:
   ```sql
   LEFT JOIN api.patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
   LEFT JOIN api.patients p_match ON c.patient_id IS NULL
                                 AND p_match.clinic_id = c.clinic_id
                                 AND (p_match.phone = c.channel_conversation_id OR p_match.whatsapp_id = c.channel_conversation_id)
   ```
3. Ensured that patient identity never leaks across clinics by binding `p_match.clinic_id = c.clinic_id`.
4. Verified end-to-end in the browser subagent: the conversation list and message transcript header now correctly display **Rahul Sharma** (`+919876543210`).

---

## 4. Authentication and Clinic Onboarding Architecture

### Architecture & Lifecycle
- **Password Hashing**: Implemented `bcryptjs` with salt round factor 10. Passwords are never stored in plaintext and never logged.
- **Role Assignment**: Server-enforced role assignment. Initial clinic owners are assigned `'admin'` (satisfying the database check constraint `users_role_check`). Client-provided roles are ignored.
- **Session Tokens**: JWT access token signed with `JWT_SECRET` (15-minute standard expiration) containing `userId`, `clinicId`, `email`, and `roles`. Refresh token signed with `REFRESH_TOKEN_SECRET` (7-day expiration).
- **Session Refresh**: Refresh tokens can be exchanged via `POST /api/v1/auth/refresh` without requiring re-entry of passwords.
- **Account & Clinic Suspension**: `loginUser` and `refreshAccessToken` check both `u.active === true` and `c.suspended_at IS NULL AND c.active = true`. Suspended clinics are blocked with HTTP 403 Forbidden.
- **Rate Limiting**: Protected with `authLimiter` (100 attempts per 15 minutes per IP) to prevent brute-force attacks.

### Clinic Onboarding Flow (`POST /api/v1/auth/signup`)
Executed in an atomic database transaction (`prisma.$transaction`):
1. Verifies email uniqueness across all users in `api.users`.
2. Generates a unique clinic slug based on clinic name.
3. Hashes the owner's password using `bcryptjs`.
4. Creates the `api.clinics` record with default receptionist configuration.
5. Creates the founding `api.users` record with role `'admin'`.
6. Seeds initial business operating hours (`api.business_hours`, Monday–Saturday).
7. Seeds default procedure catalog (`api.services`: Checkup, Cleaning, Emergency Consultation).
8. Issues JWT token pair and returns authenticated session.
9. If any step fails, the entire transaction rolls back cleanly, preventing orphaned clinics or user records.

---

## 5. Multi-Tenant Isolation Architecture

### Isolation Rules Enforced:
1. **Server-Side Tenant Resolution**: Every protected endpoint calls `getAuthenticatedClinicId(req)`, extracting `req.user.clinicId` strictly from the cryptographically verified JWT payload. A `clinic_id` provided in request query parameters or JSON body is rejected as proof of identity.
2. **Database Query Scoping**: Every SQL query and Prisma operation filters with `WHERE clinic_id = $1::uuid`.
3. **Cross-Tenant IDOR Prevention**: `assertClinicOwnership(req, recordClinicId)` validates ownership before any write, read, reschedule, or cancel. Attempting to query an object belonging to another clinic returns HTTP 404/403 without leaking object existence.
4. **Duplicate Patient Identifiers Across Clinics**: The database constraint on `api.patients` is clinic-scoped (`@@unique([clinic_id, whatsapp_id])`). Two different clinics can register the same patient phone number (`+15551234567`) and name (`Rahul Sharma`) as two completely independent entities with isolated clinical charts, notes, and appointment records.

---

## 6. Database Tables & Relationships Verified

The authoritative database is PostgreSQL hosted on Neon in schema `api`. All tables and constraints were preserved without destructive drops:

| Entity | Primary Key | Tenant Relationship | Key Constraints & Indexes |
|---|---|---|---|
| `api.clinics` | `id` (UUID) | Root tenant entity | Unique `slug`, `suspended_at`, `settings` JSONB |
| `api.users` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `auth_subject`, `users_role_check` |
| `api.dentists` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | FK `user_id`, indexed by `clinic_id` |
| `api.patients` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `(clinic_id, whatsapp_id)`, indexed by clinic |
| `api.appointments` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `confirmation_code`, GiST exclusion preventing overlap |
| `api.conversations` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `(clinic_id, channel, channel_conversation_id)` |
| `api.messages` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `(conversation_id, provider_message_id)` |
| `api.business_hours` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Indexed by `clinic_id`, `(day_of_week, opens_at, closes_at)` |
| `api.services` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `(clinic_id, code)` |
| `api.inbound_events` | `id` (UUID) | `clinic_id` -> `clinics.id` (CASCADE) | Unique `(clinic_id, provider_event_id)` (idempotency) |

---

## 7. Migration Files & Execution Status

- **Status**: No destructive migrations were executed against Neon. Existing tables and columns (`auth_subject`, `suspended_at`, `settings`) were leveraged directly.
- **Preservation Check**: Confirmed that appointment `DZXV-CUIN` (`e478376a-b1e8-429c-8f66-d08eb18925cf`) with UTC range `2026-10-15 14:00:00+00` to `2026-10-15 14:45:00+00` remained completely untouched.

---

## 8. Security Controls Implemented

1. **Password Hashing**: `bcryptjs` with 10 salt rounds used for all user passwords.
2. **Timing-Safe Error Messages**: Login rejects invalid email, unknown user, and bad password with identical message (`Invalid email or password.`) to prevent user enumeration.
3. **Role Enforcement**: User role is strictly assigned server-side from database records; client requests cannot grant platform administrator privileges.
4. **Tenant Isolation**: Direct object references are forbidden. Cross-tenant queries return HTTP 404/403.
5. **No Secrets in Bundles**: JWT secrets and database connection strings are confined to backend environment variables.
6. **PII Masking**: Error boundaries log error names and sanitised component stacks without dumping user inputs or patient phone numbers.

---

## 9. Test and Build Results with Exact Commands

### Unit & Security Test Suite
- **Command**: `npm test` in `apps/api` (`jest --runInBand`)
- **Outcome**: **5 Test Suites Passed, 48 Tests Passed, 0 Failed**
  - `PASS src/__tests__/unit/multiTenantIsolation.test.ts` (cross-clinic separation, IDOR denial, contact name priority, clinic suspension)
  - `PASS src/__tests__/unit/timezoneConversion.test.ts` (appointment `DZXV-CUIN`, DST EDT vs EST, epoch numbers, invalid inputs, fallback to UTC)
  - `PASS src/__tests__/unit/tenantScope.test.ts` (clinic scope enforcement)
  - `PASS src/__tests__/unit/dentistProfile.test.ts` (dentist profile contract)
  - `PASS src/__tests__/unit/patientContract.test.ts` (patient data contract)

### Production Package Builds
1. **Shared Library**:
   - Command: `cmd /c npm run build` in `packages/shared`
   - Outcome: **Exit Code 0** (clean TypeScript compilation to `dist/index.js` and `dist/index.d.ts`).
2. **API Backend**:
   - Command: `cmd /c npm run build` in `apps/api`
   - Outcome: **Exit Code 0** (clean TypeScript compilation to `dist/`).
3. **Web Frontend**:
   - Command: `cmd /c npm run build` in `apps/web`
   - Outcome: **Exit Code 0** (Vite production bundle generated in 10.97s: `dist/index.html` 1.17 kB, CSS 5.87 kB, JS 368.17 kB).

### Live End-to-End API Verification
- **Command**: `node scripts/verify-api-endpoints.cjs` in `apps/api`
- **Results**:
  - `POST /api/v1/auth/login`: Status 200 OK.
  - `GET /api/v1/conversations`: Status 200 OK, 20 conversations returned, all showing real patient names (e.g., `Rahul Sharma`), 0 generic labels.
  - `GET /api/v1/conversations/:id`: Status 200 OK, message transcript verified.
  - `POST /api/v1/auth/signup`: Status 201 Created, atomic transaction created clinic and owner with role `admin`.
  - `GET /api/v1/conversations` (as Clinic B): Returned 0 conversations (complete tenant isolation verified).
  - Cross-Tenant IDOR test (Clinic B querying Clinic A conversation): Returned **404 NOT_FOUND**.
  - Test clinic cleanup executed: 1 temporary test clinic deleted without touching production rows.

### Browser UI Verification
- **Command**: Browser Subagent testing `http://localhost:5173/`
- **Results**:
  - Dashboard rendered successfully with `Demo Admin` profile, `Sign Out` button, and `America/New_York` timezone indicator.
  - Navigated to `AI Receptionist` view: **No blank screen, 0 console TypeErrors**.
  - Conversation list displayed `Rahul Sharma` (`+919876543210`).
  - Conversation transcript opened and rendered all patient and AI messages cleanly.

---

## 10. Test Results That Remain Blocked or Unverified

1. **Meta WhatsApp Cloud API Live Webhook**: Live dispatch of outbound WhatsApp messages via Meta's Graph API requires live Meta app access tokens and phone number credentials. Tested with Meta signature verification middleware and local simulated payloads, but not via a live WhatsApp mobile handset.
2. **n8n Cloud Webhook Execution**: Testing against the live n8n Cloud instance (`https://kunalnale12345678.app.n8n.cloud/`) remains intentionally deferred to the subsequent n8n-specific phase, as required by non-negotiable preservation instructions.

---

## 11. Known Limitations & Residual Risks

1. **Stateless JWT Revocation**: Tokens remain valid until their 15-minute expiration unless the server secret is rotated or a distributed Redis blocklist is added. Refresh tokens can be revoked immediately in database records.
2. **Cross-Clinic Patient Linking**: A patient visiting two clinics has two separate patient charts by design. If a unified multi-clinic patient portal is required in the future, it must be introduced through an explicit opt-in identity federation model.

---

## 12. Deployment Steps Still Required

1. **Render (Backend API)**:
   - Ensure environment variables `JWT_SECRET` and `REFRESH_TOKEN_SECRET` are configured with cryptographically random 64-character hex strings.
   - Run `prisma migrate deploy` during build/deploy pipeline.
2. **Vercel (Frontend SPA)**:
   - Configure `VITE_API_BASE_URL` pointing to the Render backend URL.
3. **Smoke Verification**:
   - Verify login with clinic administrator credentials.
   - Verify receptionist conversation view loads without blank screen.

---

---

## 14. Multi-Tenant Clean Provisioning, Pricing Catalog, and Holiday Management Audit

### Summary of Completed Work
1. **Clean Tenant Provisioning at the Root**:
   - Eliminated automatic insertion of demo services and operating hours from `apps/api/src/modules/auth/auth.service.ts`.
   - Newly registered clinics receive an empty slate (`0` services, `0` dentists, `0` operating hours, `0` fake patients).
   - Removed silent frontend fallback in `apps/web/src/api/client.ts` that auto-logged in as `admin@demo.example.com` on unauthenticated states.
   - Replaced hardcoded strings in `Sidebar.tsx`, `Header.tsx`, and `SettingsView.tsx` with dynamic tenant properties.
2. **Database Schema Enhancements (Neon Migration 1.3.0)**:
   - Added `price`, `currency`, `pricing_model`, `category`, and `description` to `api.services`.
   - Created `api.clinic_holiday_overrides` with unique constraint `(clinic_id, holiday_date)` and foreign key to `api.clinics`.
   - Updated Prisma schema and generated type-safe clients.
3. **Service Catalog & Dynamic Pricing**:
   - Full support for `fixed`, `starting_from`, and `quote_required` (price: null) models across database, REST API, and React UI.
   - Complete tenant isolation: Service endpoints (`GET /services`, `GET /services/:id`) reject cross-tenant access.
4. **Operating Hours & Schedule Defaults**:
   - New clinics default to unconfigured (all days closed).
   - Saturday and Sunday are never enabled by default.
   - Operating hours endpoints (`GET /schedules/clinic`, `PUT /schedules/clinic`) persist explicit schedules per clinic.
5. **Location-Aware Public Holidays**:
   - Automated jurisdiction resolution supporting US, GB, CA, AU, and IN based on clinic settings.
   - Clinic-level working day overrides (`PUT /schedules/holidays/override`) allow individual clinics to work on national holidays without affecting other tenants.
6. **Automated End-to-End Multi-Tenant Verification**:
   - `apps/api/scripts/verify-clean-onboarding.cjs` verified:
     - Demo clinic (`00000000-0000-0000-0000-000000000001`) preservation.
     - Clean provisioning of Clinic A (US) and Clinic B (GB) with 0 demo records.
     - Pricing models ($185.50 starting_from, null quote_required) persisted.
     - Service cross-tenant isolation (404 on direct ID access).
     - Operating hours isolation (Clinic A has Mon-Fri, Clinic B has 0 hours).
     - Location holidays (US vs GB public holiday catalogs).
     - Holiday working-day overrides isolated per clinic.
     - Identical patient phone number allowed in separate clinics without collision.
     - Safe cleanup of audit test tenants.
   - **Result**: 11/11 test suites passed with exit code 0.
7. **Frontend Build Verification**:
   - `@dental/web` built with `tsc && vite build`: 0 TypeScript or bundling errors.
   - `@dental/api` built with `tsc`: 0 compilation errors.

