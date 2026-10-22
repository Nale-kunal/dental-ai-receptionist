-- Migration: 004_add_unvalidated_status.sql
-- Version: 1.5.0
-- Scope: Support 'unvalidated' status for newly saved, unverified WhatsApp credentials.

BEGIN;

ALTER TABLE api.clinic_whatsapp_integrations
  DROP CONSTRAINT IF EXISTS clinic_whatsapp_integrations_status_check;

ALTER TABLE api.clinic_whatsapp_integrations
  ADD CONSTRAINT clinic_whatsapp_integrations_status_check
  CHECK (status IN ('unconfigured', 'unvalidated', 'valid', 'invalid', 'expired'));

COMMIT;
