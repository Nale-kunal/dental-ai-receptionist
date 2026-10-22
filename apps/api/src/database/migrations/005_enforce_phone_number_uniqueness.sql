-- Migration: 005_enforce_phone_number_uniqueness.sql
-- Version: 1.6.0
-- Scope: Normalize empty/whitespace-only phone IDs to NULL, reject blank values,
--        and enforce uniqueness on trimmed non-empty phone_number_id values across all clinics.
--        Disabled integrations reserve their number. To release a number, phone_number_id must be set to NULL.

BEGIN;

-- 1. Normalize existing empty or whitespace-only phone_number_id values to NULL
UPDATE api.clinic_whatsapp_integrations
SET phone_number_id = NULL,
    updated_at = NOW()
WHERE phone_number_id IS NOT NULL AND btrim(phone_number_id) = '';

-- 2. Prevent future insertion or update of blank/whitespace strings
ALTER TABLE api.clinic_whatsapp_integrations
  DROP CONSTRAINT IF EXISTS clinic_whatsapp_integrations_phone_number_id_check;

ALTER TABLE api.clinic_whatsapp_integrations
  ADD CONSTRAINT clinic_whatsapp_integrations_phone_number_id_check
  CHECK (phone_number_id IS NULL OR btrim(phone_number_id) <> '');

-- 3. Drop existing partial index that did not trim or guard against blank strings
DROP INDEX IF EXISTS api.clinic_whatsapp_integrations_phone_number_id_uidx;

-- 4. Create unique index on trimmed non-empty phone_number_id
-- Ensures exactly one clinic per physical WhatsApp Phone Number ID regardless of enabled status
CREATE UNIQUE INDEX clinic_whatsapp_integrations_phone_number_id_uidx
  ON api.clinic_whatsapp_integrations (btrim(phone_number_id))
  WHERE phone_number_id IS NOT NULL AND btrim(phone_number_id) <> '';

COMMIT;
