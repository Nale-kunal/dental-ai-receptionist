-- Migration: 002_add_services_pricing_and_holiday_overrides.sql
-- Description: Non-destructive, additive addition of pricing, pricing models, descriptions
-- to clinic dental services, and creation of clinic-specific holiday overrides.
-- Fully backward compatible with existing rows and n8n workflows.

-- 1. Extend api.services with rich pricing and clinical categorization
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS price numeric(10, 2) NULL;
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS currency varchar(10) NOT NULL DEFAULT 'USD';
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS pricing_model varchar(30) NOT NULL DEFAULT 'fixed';
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS description text NULL;
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS category varchar(100) NULL;
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE api.services ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN api.services.price IS 'Clinical procedure price (numeric with 2 decimal precision); NULL if consultation/quote required';
COMMENT ON COLUMN api.services.currency IS 'Currency code, e.g. USD, GBP, EUR, CAD, AUD';
COMMENT ON COLUMN api.services.pricing_model IS 'Pricing structure: fixed, starting_from, or quote_required';
COMMENT ON COLUMN api.services.description IS 'Patient-facing and clinical description of the treatment';
COMMENT ON COLUMN api.services.category IS 'Clinical specialty categorization, e.g. General, Cosmetic, Surgery, Orthodontics';

-- 2. Create clinic holiday overrides table for location-aware holidays & working-day exceptions
CREATE TABLE IF NOT EXISTS api.clinic_holiday_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES api.clinics(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  holiday_name text NOT NULL,
  country_code varchar(10) NOT NULL DEFAULT 'US',
  action varchar(30) NOT NULL DEFAULT 'closed', -- 'closed', 'working_day', 'modified_hours'
  custom_opens_at time without time zone NULL,
  custom_closes_at time without time zone NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_clinic_holiday_date UNIQUE (clinic_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS clinic_holiday_overrides_clinic_idx ON api.clinic_holiday_overrides (clinic_id);
CREATE INDEX IF NOT EXISTS clinic_holiday_overrides_date_idx ON api.clinic_holiday_overrides (holiday_date);

COMMENT ON TABLE api.clinic_holiday_overrides IS 'Clinic-specific overrides for national/regional public holidays and holiday working hours';
