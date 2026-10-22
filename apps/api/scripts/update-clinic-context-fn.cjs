const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateFunction() {
  console.log('Updating api.get_clinic_context to include pricing and category in v_services...');
  await prisma.$executeRawUnsafe(`
CREATE OR REPLACE FUNCTION api.get_clinic_context(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_clinic api.clinics%ROWTYPE; v_hours jsonb; v_dentists jsonb; v_services jsonb;
BEGIN
  SELECT * INTO v_clinic FROM api.clinics WHERE id = p_clinic_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'clinic not found'); END IF;
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
    'data', jsonb_build_object('id', v_clinic.id, 'name', v_clinic.name, 'slug', v_clinic.slug, 'timezone', v_clinic.timezone,
      'locale', v_clinic.locale, 'settings', v_clinic.settings, 'business_hours', COALESCE(v_hours, '[]'::jsonb),
      'dentists', COALESCE(v_dentists, '[]'::jsonb), 'services', COALESCE(v_services, '[]'::jsonb)));
END; $function$;
  `);

  console.log('Testing api.get_clinic_context on Demo Clinic...');
  const res = await prisma.$queryRawUnsafe(`SELECT api.get_clinic_context('00000000-0000-0000-0000-000000000001'::uuid) as ctx`);
  console.log('Result:', JSON.stringify(res[0].ctx.data.services, null, 2));
  await prisma.$disconnect();
}

updateFunction().catch(console.error);
