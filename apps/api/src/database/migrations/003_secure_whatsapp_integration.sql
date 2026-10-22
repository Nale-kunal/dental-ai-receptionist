-- Migration: 003_secure_whatsapp_integration.sql
-- Version: 1.4.0
-- Scope: Multi-tenant WhatsApp credential security, canonical phone number ID mapping,
--        uniqueness enforcement, and token sanitization in get_clinic_context.

BEGIN;

-- 1. Create dedicated clinic_whatsapp_integrations table in schema 'api'
CREATE TABLE IF NOT EXISTS api.clinic_whatsapp_integrations (
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

-- 2. Enforce Phone Number ID uniqueness: exactly one clinic per WhatsApp phone number ID
CREATE UNIQUE INDEX IF NOT EXISTS clinic_whatsapp_integrations_phone_number_id_uidx
  ON api.clinic_whatsapp_integrations (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clinic_whatsapp_integrations_clinic_idx
  ON api.clinic_whatsapp_integrations (clinic_id);

-- 3. Backfill existing clinic integrations from api.clinics.settings (e.g. Demo Clinic)
INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, enabled, status)
SELECT
  id,
  COALESCE(settings->>'phone_number_id', settings->>'whatsapp_phone_number_id', settings->>'meta_phone_number_id'),
  true,
  'unconfigured'
FROM api.clinics
WHERE (settings->>'phone_number_id' IS NOT NULL
   OR settings->>'whatsapp_phone_number_id' IS NOT NULL
   OR settings->>'meta_phone_number_id' IS NOT NULL)
ON CONFLICT (clinic_id) DO UPDATE
SET phone_number_id = EXCLUDED.phone_number_id,
    updated_at = NOW();

-- 4. Harmonize canonical phone_number_id in api.clinics.settings for transition backward-compatibility
UPDATE api.clinics
SET settings = settings || jsonb_build_object(
  'phone_number_id', COALESCE(settings->>'phone_number_id', settings->>'whatsapp_phone_number_id', settings->>'meta_phone_number_id'),
  'whatsapp_phone_number_id', COALESCE(settings->>'whatsapp_phone_number_id', settings->>'phone_number_id', settings->>'meta_phone_number_id'),
  'meta_phone_number_id', COALESCE(settings->>'meta_phone_number_id', settings->>'phone_number_id', settings->>'whatsapp_phone_number_id')
)
WHERE settings->>'phone_number_id' IS NOT NULL
   OR settings->>'whatsapp_phone_number_id' IS NOT NULL
   OR settings->>'meta_phone_number_id' IS NOT NULL;

-- 5. Stored Procedure: api.get_clinic_by_phone_number_id
-- Safely resolves an inbound Meta phone_number_id to exactly one active clinic.
CREATE OR REPLACE FUNCTION api.get_clinic_by_phone_number_id(p_phone_number_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_match_count int;
  v_clinic record;
  v_sanitized_phone text;
BEGIN
  v_sanitized_phone := trim(p_phone_number_id);
  IF v_sanitized_phone IS NULL OR v_sanitized_phone = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'phone_number_id is required');
  END IF;

  -- Count matching active clinics
  SELECT COUNT(DISTINCT c.id) INTO v_match_count
  FROM api.clinics c
  LEFT JOIN api.clinic_whatsapp_integrations i ON i.clinic_id = c.id
  WHERE (i.phone_number_id = v_sanitized_phone
     OR c.settings->>'phone_number_id' = v_sanitized_phone
     OR c.settings->>'whatsapp_phone_number_id' = v_sanitized_phone
     OR c.settings->>'meta_phone_number_id' = v_sanitized_phone)
    AND c.active = true
    AND c.suspended_at IS NULL
    AND COALESCE(i.enabled, true) = true;

  IF v_match_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMBIGUOUS_MAPPING', 'message', 'Multiple active clinics mapped to this phone number ID');
  END IF;

  IF v_match_count = 0 THEN
    -- Check if clinic exists but is inactive or suspended
    SELECT c.id, c.active, c.suspended_at INTO v_clinic
    FROM api.clinics c
    LEFT JOIN api.clinic_whatsapp_integrations i ON i.clinic_id = c.id
    WHERE (i.phone_number_id = v_sanitized_phone
       OR c.settings->>'phone_number_id' = v_sanitized_phone
       OR c.settings->>'whatsapp_phone_number_id' = v_sanitized_phone
       OR c.settings->>'meta_phone_number_id' = v_sanitized_phone)
    LIMIT 1;

    IF FOUND THEN
      IF NOT v_clinic.active THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE', 'message', 'Clinic is inactive');
      END IF;
      IF v_clinic.suspended_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUSPENDED', 'message', 'Clinic is suspended');
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'No clinic found for this phone number ID');
  END IF;

  -- Return single active clinic
  SELECT c.id, c.name, c.slug, c.timezone, c.locale, COALESCE(i.phone_number_id, v_sanitized_phone) as phone_number_id,
         COALESCE(i.waba_id, c.settings->>'waba_id') as waba_id,
         COALESCE(i.status, 'unconfigured') as integration_status
  INTO v_clinic
  FROM api.clinics c
  LEFT JOIN api.clinic_whatsapp_integrations i ON i.clinic_id = c.id
  WHERE (i.phone_number_id = v_sanitized_phone
     OR c.settings->>'phone_number_id' = v_sanitized_phone
     OR c.settings->>'whatsapp_phone_number_id' = v_sanitized_phone
     OR c.settings->>'meta_phone_number_id' = v_sanitized_phone)
    AND c.active = true
    AND c.suspended_at IS NULL
    AND COALESCE(i.enabled, true) = true
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'data', jsonb_build_object(
      'clinic_id', v_clinic.id,
      'name', v_clinic.name,
      'slug', v_clinic.slug,
      'timezone', v_clinic.timezone,
      'locale', v_clinic.locale,
      'phone_number_id', v_clinic.phone_number_id,
      'waba_id', v_clinic.waba_id,
      'integration_status', v_clinic.integration_status
    )
  );
END; $function$;

-- 6. Update api.get_clinic_context: Strictly sanitize settings to exclude any access tokens or secrets
CREATE OR REPLACE FUNCTION api.get_clinic_context(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_clinic api.clinics%ROWTYPE;
  v_hours jsonb;
  v_dentists jsonb;
  v_services jsonb;
  v_sanitized_settings jsonb;
BEGIN
  SELECT * INTO v_clinic FROM api.clinics WHERE id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'clinic not found');
  END IF;

  -- Strictly strip any credential keys from settings
  v_sanitized_settings := v_clinic.settings
    - 'meta_access_token'
    - 'access_token'
    - 'whatsapp_token'
    - 'encrypted_access_token'
    - 'secret'
    - 'api_key';

  SELECT jsonb_agg(jsonb_build_object('day_of_week', day_of_week, 'opens_at', opens_at, 'closes_at', closes_at) ORDER BY day_of_week)
    INTO v_hours FROM api.business_hours WHERE clinic_id = p_clinic_id;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'specialty', specialty, 'default_buffer_minutes', default_buffer_minutes))
    INTO v_dentists FROM api.dentists WHERE clinic_id = p_clinic_id AND active;

  SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'code', code,
      'name', name,
      'duration_minutes', duration_minutes,
      'buffer_minutes', buffer_minutes,
      'price', price,
      'currency', currency,
      'pricing_model', pricing_model,
      'category', category,
      'description', description
    ))
    INTO v_services FROM api.services WHERE clinic_id = p_clinic_id AND active;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object(
      'id', v_clinic.id,
      'name', v_clinic.name,
      'slug', v_clinic.slug,
      'timezone', v_clinic.timezone,
      'locale', v_clinic.locale,
      'settings', v_sanitized_settings,
      'business_hours', COALESCE(v_hours, '[]'::jsonb),
      'dentists', COALESCE(v_dentists, '[]'::jsonb),
      'services', COALESCE(v_services, '[]'::jsonb)
    )
  );
END; $function$;

COMMIT;
