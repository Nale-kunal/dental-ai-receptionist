-- Migration: 001_add_dentist_profile_fields.sql
-- Description: Non-destructive, additive addition of professional dentist profile fields
-- Safe defaults, completely backward compatible with existing rows and n8n workflows.
-- Target table: api.dentists

ALTER TABLE api.dentists ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE api.dentists ADD COLUMN IF NOT EXISTS qualifications text;
ALTER TABLE api.dentists ADD COLUMN IF NOT EXISTS experience_years integer;
ALTER TABLE api.dentists ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE api.dentists ADD COLUMN IF NOT EXISTS bio text;

COMMENT ON COLUMN api.dentists.title IS 'Professional title, e.g. Dr., Prof.';
COMMENT ON COLUMN api.dentists.qualifications IS 'Degrees and qualifications, e.g. BDS, MDS, DDS, FICOI';
COMMENT ON COLUMN api.dentists.experience_years IS 'Years of professional clinical experience';
COMMENT ON COLUMN api.dentists.license_number IS 'State Dental Council or National Dental Board license registration number';
COMMENT ON COLUMN api.dentists.bio IS 'Professional biography and clinical background';
