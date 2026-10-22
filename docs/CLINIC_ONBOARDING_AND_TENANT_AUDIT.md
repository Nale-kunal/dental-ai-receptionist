# Clinic Onboarding and Tenant Isolation Technical Audit

## 1. Executive Summary & Root Cause Analysis

### The Problem
When newly registered clinic administrators created an account, their dashboard initially presented:
- Clinic name: **Demo Dental Clinic**
- Sidebar clinic brand: Demo Dental Clinic
- Pre-populated demo dental treatments (Checkup, Cleaning, Emergency Exam)
- Pre-populated business hours (Monday–Friday 09:00–17:00, Saturday 09:00–14:00)
- Pre-populated mock addresses, contact details, and notification defaults

### Root Causes Identified in the Codebase

1. **Automatic Demo Record Insertion in `auth.service.ts`**:
   - In `apps/api/src/modules/auth/auth.service.ts`, the `signupClinic` function was explicitly executing SQL queries during new clinic registration to populate:
     - 6 days of demo business hours (`09:00-17:00` weekdays, `09:00-14:00` Saturdays).
     - 3 standard demo treatment services (`CHECKUP`, `CLEANING`, `EMERGENCY`).
   - This caused every newly registered tenant to inherit identical dummy records at the database level.

2. **Silent Frontend Auto-Login Fallback to Demo Account in `client.ts`**:
   - In `apps/web/src/api/client.ts`, `ensureAuthenticated()` had fallback logic that automatically issued a login request with `admin@demo.example.com` and `password123` whenever token storage was uninitialized, expired, or encountered a 401 error.
   - This silently re-authenticated any user as the Demo Dental Clinic tenant (`00000000-0000-0000-0000-000000000001`), destroying tenant context.

3. **Hardcoded Demo Strings in Frontend Components**:
   - `apps/web/src/components/Sidebar.tsx` (line 119) hardcoded `Demo Dental Clinic` as the display title instead of reading `clinic.name` from `ClinicContext`.
   - `apps/web/src/components/Header.tsx` defaulted missing user information to `Demo Admin` and `admin@demo.example.com`.
   - `apps/web/src/views/SettingsView.tsx` defaulted empty address/phone/insurance fields to `100 Medical Center Blvd`, `San Francisco, CA`, and `+1 (555) 123-4567`.

---

## 2. Implemented Remedies & Architecture

### A. Clean Tenant Provisioning (`auth.service.ts`)
- **Atomic Registration**:
  - `signupClinic` runs within a strict database transaction (`prisma.$transaction`).
  - Creates the clinic in `api.clinics` with a unique slug and UUID primary key.
  - Creates the founding administrator in `api.users` with the verified `admin` role.
  - Stores location details (`country`, `state`, `city`, `currency`, `postalCode`) directly into `settings`.
- **Zero Prepopulated Operational Data**:
  - The transaction completely omits automatic insertions into `api.business_hours` and `api.services`.
  - A new clinic starts with `0` services, `0` dentists, `0` business hours, `0` patients, and `0` appointments.
- **Fail-Safe Rollback**:
  - If any part of the registration fails, the transaction rolls back completely, preventing orphan clinic or user records.

### B. Client Isolation & Authentication Boundary (`client.ts`, `ClinicContext.tsx`)
- **Removed Demo Auto-Login**:
  - `ensureAuthenticated()` in `apps/web/src/api/client.ts` now throws an `UNAUTHENTICATED` error if no valid session exists.
  - On 401 errors, it attempts token refresh via `/auth/refresh`. If refresh fails, it clears local state and redirects to `/login`.
  - Under no circumstances does the application silently switch to `admin@demo.example.com`.
- **Dynamic Clinic Identity**:
  - `apps/web/src/components/Sidebar.tsx` dynamically renders `clinicDisplayName` (`clinic?.name || 'My Dental Clinic'`).
  - `apps/web/src/components/Header.tsx` displays the authenticated user's actual name or `Clinic Administrator`.
  - `apps/web/src/views/SettingsView.tsx` cleanly renders empty states with `"Needs Setup"` badges when contact details or addresses have not yet been configured.

### C. Preservation of Demo Dental Clinic
- The existing Demo Dental Clinic (`id: 00000000-0000-0000-0000-000000000001`, user `admin@demo.example.com`) was left completely intact.
- Its existing services, dentists, and test history remain in place for isolated demo purposes.
- Real signups are guaranteed distinct random UUIDs and isolated database scopes.

---

## 3. Automated Verification & Isolation Results

Verification was performed using `apps/api/scripts/verify-clean-onboarding.cjs` running against the live Neon PostgreSQL database:

| Test Case | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- |
| **Demo Clinic Preservation** | `00000000-0000-0000-0000-000000000001` retains original services and user | Intact and login succeeds | **PASS** |
| **Clinic A Provisioning (US)** | Distinct UUID, name matches, 0 services, 0 dentists, 0 hours | UUID: `d6708438-...`, 0 demo records | **PASS** |
| **Clinic B Provisioning (GB)** | Distinct UUID from Clinic A, 0 demo records | UUID: `f85774ab-...`, 0 demo records | **PASS** |
| **Service Catalog Persistence** | Clinic A creates service with starting_from price $185.50 | Persisted as $185.50 USD `starting_from` | **PASS** |
| **Service Cross-Tenant Isolation**| Clinic B queries `/services` and `/services/:id` of Clinic A | Clinic B cannot see Clinic A service (404 on direct ID) | **PASS** |
| **Operating Hours Independence** | Clinic A sets Mon-Fri 08:30-16:30; Sat/Sun closed | Clinic A has 5 days; Clinic B has 0 days | **PASS** |
| **Location Holidays (US vs GB)** | Clinic A gets US holidays; Clinic B gets GB holidays | Clinic A gets Thanksgiving; Clinic B gets Bank Holidays | **PASS** |
| **Holiday Overrides Isolation** | Clinic A marks Memorial Day as working day | Clinic A shows working day; Clinic B unaffected | **PASS** |
| **Duplicate Patient Phone** | Same phone number registered in Clinic A & Clinic B | Both patients created; strictly isolated by clinic | **PASS** |

---

## 4. Residual Risks & Operational Guidance

1. **Unconfigured Schedule Alert**:
   - Because newly created clinics have 0 configured operating hours, bookable slots cannot be generated until the administrator visits **Dentists & Hours** and clicks **Save Schedule**.
   - The UI includes prominent informational banners alerting the administrator to configure their hours.
2. **First-Time Service Creation**:
   - Appointment booking and AI receptionist availability inquiries require at least one active service and one practitioner.
   - The onboarding lifecycle requires administrators to add their first treatment before activating public booking.
