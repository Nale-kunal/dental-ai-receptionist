# Multi-Tenant WhatsApp Integration Security Audit & Remediation Report

**Date**: October 19, 2026  
**Auditor**: Senior SaaS Architect, Meta WhatsApp Cloud API Specialist & Database Systems Lead  
**Scope**: Multi-Tenant WhatsApp Credentials, Inbound Routing, Outbound Dispatch, Database Isolation, n8n Production Readiness  
**Target Environment**: Neon PostgreSQL (`ep-green-fog-a45g086b`), Express API Server (`port 3001`), n8n Cloud (`kunalnale12345678.app.n8n.cloud`)  

---

## Executive Summary

A critical production-readiness audit of the Dental AI Receptionist platform identified key architectural vulnerabilities in multi-tenant WhatsApp integration:
1. **Unencrypted & Leaked Credential Storage**: Clinic integration settings were stored in unstructured JSONB (`api.clinics.settings`), which were fully exposed via `api.get_clinic_context`, threatening to leak live Meta tokens into AI prompt histories and client API payloads.
2. **Key Inconsistency & Missing Uniqueness**: The codebase had inconsistent keys (`whatsapp_phone_number_id` vs `meta_phone_number_id`) and lacked database-level uniqueness enforcement, permitting multiple clinics to claim identical phone numbers.
3. **Simulated Outbound Dispatch**: Manual staff replies in `conversations.routes.ts` relied on global environment variables and marked messages as "sent" without actually calling Meta Graph API.
4. **Test vs Production n8n Mismatch**: The repository only contained `dental-test-inbound-workflow.json`, which had hardcoded Demo Clinic UUIDs and lacked Meta HMAC signature verification and outbound dispatch nodes.

All database and codebase remediations have been implemented and validated with 11 automated test suites (115 passing tests). **The live n8n workflow was not modified or published, and zero real WhatsApp messages were transmitted during this phase.**

---

## 1. Credential Storage Model & Cryptographic Hardening

### Pre-Remediation State
- No dedicated integrations table existed.
- Settings were stored in plaintext JSONB under `api.clinics.settings`.
- Stored procedure `api.get_clinic_context(p_clinic_id uuid)` returned `'settings', v_clinic.settings` in full, leaking all keys to AI prompts, n8n logs, and API callers.
- A global `isWhatsAppConfigured()` helper relied on `process.env.META_WHATSAPP_TOKEN` and `process.env.META_PHONE_NUMBER_ID`, representing a single-tenant anti-pattern.

### Remediated Architecture (Applied via Migration 1.4.0)
1. **Dedicated Integration Table**: Created `api.clinic_whatsapp_integrations`:
   ```sql
   CREATE TABLE api.clinic_whatsapp_integrations (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     clinic_id uuid NOT NULL UNIQUE REFERENCES api.clinics(id) ON DELETE CASCADE,
     phone_number_id text,
     waba_id text,
     encrypted_access_token text,
     key_version text NOT NULL DEFAULT 'v1',
     enabled boolean NOT NULL DEFAULT true,
     status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured', 'valid', 'invalid', 'expired')),
     token_expires_at timestamptz,
     last_validated_at timestamptz,
     last_error text,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     updated_at timestamptz NOT NULL DEFAULT NOW()
   );
   ```
2. **Authenticated Encryption at Rest (AES-256-GCM)**:
   - Tokens are encrypted using 96-bit random IVs and 128-bit authentication tags.
   - Storage format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
   - Encryption keys are loaded from `process.env.INTEGRATION_ENCRYPTION_KEY` and never stored in the database.
   - Key rotation supported via `key_version`.
3. **Strict Context Sanitization**:
   `api.get_clinic_context` was rewritten to sanitize `v_clinic.settings - 'meta_access_token' - 'access_token' - 'whatsapp_token' - 'encrypted_access_token' - 'secret' - 'api_key'`.
4. **Secret Masking**:
   API responses return masked strings (`••••••••4321`) and boolean flags (`hasToken: true`), never raw access tokens.

---

## 2. Phone Number ID Routing & Uniqueness Enforcement

### Canonical Key Selection
- **Canonical Field**: `phone_number_id`.
- During transition, `whatsapp_phone_number_id` and `meta_phone_number_id` are synchronized in `api.clinics.settings` to maintain 100% backward compatibility.

### Database Uniqueness Constraint
- Created unique partial index:
  ```sql
  CREATE UNIQUE INDEX clinic_whatsapp_integrations_phone_number_id_uidx
    ON api.clinic_whatsapp_integrations (phone_number_id)
    WHERE phone_number_id IS NOT NULL;
  ```
- Guaranteed that one Phone Number ID maps to exactly one clinic platform-wide. Attempts by a second clinic to claim an assigned number fail immediately with HTTP 409 Conflict.

### Safe Inbound Resolution Stored Procedure
- Implemented `api.get_clinic_by_phone_number_id(p_phone_number_id text)`:
  - Validates active status (`c.active = true`) and absence of suspension (`c.suspended_at IS NULL`).
  - Verifies integration is enabled (`i.enabled = true`).
  - Returns `AMBIGUOUS_MAPPING` if duplicate mappings occur.
  - Returns `INACTIVE` or `SUSPENDED` if clinic is deactivated.
  - Returns `NOT_FOUND` if unmapped.

---

## 3. Receptionist & Integration API Endpoints

### Endpoint Updates in `apps/api`
1. `GET /api/v1/receptionist/settings`:
   - Returns canonical `phoneNumberId` and backward-compatible `whatsappPhoneNumberId`.
   - Removed hardcoded "Demo Dental Clinic" fallback greeting; now dynamically uses the authenticated clinic's name.
   - Removed hardcoded US test number (`+15551234567`) fallback for emergency contact.
2. `PUT /api/v1/receptionist/settings`:
   - Accepts `phoneNumberId` and `whatsappPhoneNumberId`.
   - Validates digit-only format (`8–25` characters).
   - Enforces uniqueness against other tenants before saving.
   - Persists to both `api.clinic_whatsapp_integrations` and `api.clinics.settings`.
3. `GET /api/v1/receptionist/integration`:
   - Returns tenant integration status (`status`, `phoneNumberId`, `wabaId`, `enabled`, `hasToken`, `maskedToken`).
   - Never exposes access tokens.
4. `PUT /api/v1/receptionist/integration`:
   - Encrypts access tokens before database storage.
   - Sets status to `'valid'` upon successful token entry.

---

## 4. Outbound WhatsApp Delivery Service

### Real Provider Dispatch
- Implemented `WhatsAppService` (`apps/api/src/services/whatsapp.service.ts`):
  - Resolves authenticated clinic from request context.
  - Decrypts access token in memory.
  - Calls `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages`.
  - Captures real provider message ID (`wamid`) and marks `deliveryStatus: 'sent'`.
  - Captures provider errors (401 Unauthorized, 429 Rate Limit) without leaking tokens in logs.
  - When unconfigured, accurately records `logged_locally` and `not_configured`.
- Updated `conversations.routes.ts` staff reply handler to use `whatsAppService.sendMessage`.

---

## 5. Verification Results

All unit and integration tests executed against Neon PostgreSQL passed cleanly:
- `encryption.test.ts`: AES-256-GCM authenticated encryption, decryption, tamper detection, and key rotation.
- `whatsappIntegrationSecurity.test.ts`: Canonical routing, uniqueness constraint violation, inactive/suspended clinic rejection, token sanitization in `get_clinic_context`, and outbound provider dispatch with mock Meta responses.
- `receptionistSettings.test.ts`: Uniqueness enforcement, validation, masked credential responses, and cross-tenant isolation.
- Pre-existing suites (100% pass): `conversationContinuity`, `appointmentCalendar`, `timezoneConversion`, `tenantScope`, `multiTenantIsolation`, `patientContract`, `holidayOverrideAndScheduling`, `dentistProfile`.
- Total: **11 test suites passed, 115 tests passed, 0 failures**.
- Build: TypeScript check and production builds for `apps/api` and `apps/web` completed with 0 errors.
