-- Migration: 008_add_patient_archive_fields.sql
-- Description: Non-destructive, additive addition of soft-archive lifecycle fields to api.patients,
-- and creation of api.patient_audit_events for audit trail tracking.
-- Fully backward compatible with existing records, n8n workflows, and active directory queries.
-- is_archived defaults to false so all existing patients remain active.

-- 1. Extend api.patients with soft-archive lifecycle tracking
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES api.users(id) ON DELETE SET NULL;
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS archive_reason text NULL;
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS restored_at timestamptz NULL;
ALTER TABLE api.patients ADD COLUMN IF NOT EXISTS restored_by uuid NULL REFERENCES api.users(id) ON DELETE SET NULL;

-- 2. Indexes for tenant-scoped patient filtering and archive queries
CREATE INDEX IF NOT EXISTS patients_clinic_archived_idx ON api.patients (clinic_id, is_archived);
CREATE INDEX IF NOT EXISTS patients_archived_at_idx ON api.patients (clinic_id, archived_at DESC) WHERE is_archived = true;

-- 3. Dedicated audit trail for patient archive and restore events
CREATE TABLE IF NOT EXISTS api.patient_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES api.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES api.patients(id) ON DELETE CASCADE,
  action varchar(50) NOT NULL, -- 'PATIENT_ARCHIVED', 'PATIENT_RESTORED'
  user_id uuid NULL REFERENCES api.users(id) ON DELETE SET NULL,
  user_email text NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_audit_clinic_idx ON api.patient_audit_events (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS patient_audit_patient_idx ON api.patient_audit_events (patient_id);

-- 4. Documentation comments
COMMENT ON COLUMN api.patients.is_archived IS 'Indicates whether the patient is archived from active clinical directory and booking eligibility';
COMMENT ON COLUMN api.patients.archived_at IS 'Timestamp when the patient was archived';
COMMENT ON COLUMN api.patients.archived_by IS 'User ID who performed the archive action';
COMMENT ON COLUMN api.patients.archive_reason IS 'Clinical or administrative reason for archiving the patient';
COMMENT ON COLUMN api.patients.restored_at IS 'Timestamp when the patient was restored to active directory';
COMMENT ON COLUMN api.patients.restored_by IS 'User ID who performed the restore action';
COMMENT ON TABLE api.patient_audit_events IS 'Audit trail tracking patient archive and restore lifecycle actions';

-- ============================================================================
-- Safe Rollback Script (For Reference):
-- ============================================================================
-- DROP TABLE IF EXISTS api.patient_audit_events;
-- DROP INDEX IF EXISTS api.patients_archived_at_idx;
-- DROP INDEX IF EXISTS api.patients_clinic_archived_idx;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS restored_by;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS restored_at;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS archive_reason;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS archived_by;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS archived_at;
-- ALTER TABLE api.patients DROP COLUMN IF EXISTS is_archived;
