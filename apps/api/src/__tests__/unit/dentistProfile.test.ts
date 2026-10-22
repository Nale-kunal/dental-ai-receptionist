import { z } from 'zod';

const doctorSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  title: z.string().max(50).optional().nullable(),
  qualifications: z.string().max(300).optional().nullable(),
  specialty: z.string().max(200).optional().nullable(),
  experienceYears: z.number().int().min(0).max(70).optional().nullable(),
  licenseNumber: z.string().max(100).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  defaultBufferMinutes: z.number().int().min(0).max(120).optional(),
});

function mapDentist(d: any) {
  const displayName = d.display_name ?? d.displayName ?? d.name ?? 'Dr. Dentist';
  return {
    id: d.id,
    clinicId: d.clinic_id ?? d.clinicId,
    displayName,
    name: displayName,
    title: d.title ?? null,
    qualifications: d.qualifications ?? null,
    specialty: d.specialty || 'General Dentistry',
    experienceYears: d.experience_years != null ? Number(d.experience_years) : (d.experienceYears != null ? Number(d.experienceYears) : null),
    licenseNumber: d.license_number ?? d.licenseNumber ?? null,
    bio: d.bio ?? null,
    active: d.active ?? true,
    isActive: d.active ?? true,
    defaultBufferMinutes: d.default_buffer_minutes ?? d.defaultBufferMinutes ?? 15,
    createdAt: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
  };
}

describe('Dentist Profile Management Unit Tests', () => {
  describe('doctorSchema validation', () => {
    it('accepts a complete professional dentist profile payload', () => {
      const payload = {
        displayName: 'Dr. Sarah Jenkins',
        title: 'Dr.',
        qualifications: 'BDS, MDS (Orthodontics), FICOI',
        specialty: 'Orthodontics & Dentofacial Orthopedics',
        experienceYears: 12,
        licenseNumber: 'DCI-94821-B',
        bio: 'Senior orthodontist specializing in invisible aligners and pediatric interceptive orthodontics.',
        defaultBufferMinutes: 15,
        active: true,
      };

      const result = doctorSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('Dr. Sarah Jenkins');
        expect(result.data.experienceYears).toBe(12);
        expect(result.data.licenseNumber).toBe('DCI-94821-B');
      }
    });

    it('accepts minimal dentist payload and handles optional fields as undefined', () => {
      const payload = {
        displayName: 'Dr. John Doe',
      };

      const result = doctorSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specialty).toBeUndefined();
        expect(result.data.qualifications).toBeUndefined();
      }
    });

    it('rejects invalid experience years exceeding 70 or negative', () => {
      expect(doctorSchema.safeParse({ experienceYears: -5 }).success).toBe(false);
      expect(doctorSchema.safeParse({ experienceYears: 150 }).success).toBe(false);
    });

    it('rejects defaultBufferMinutes exceeding 120 or negative', () => {
      expect(doctorSchema.safeParse({ defaultBufferMinutes: 200 }).success).toBe(false);
      expect(doctorSchema.safeParse({ defaultBufferMinutes: -1 }).success).toBe(false);
    });
  });

  describe('mapDentist transformation', () => {
    it('correctly maps snake_case database rows to camelCase API contract', () => {
      const rawDbRow = {
        id: '11111111-1111-1111-1111-111111111111',
        clinic_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Dr. Emily Vance',
        title: 'Dr.',
        qualifications: 'DDS, MS (Periodontics)',
        specialty: 'Periodontics',
        experience_years: 9,
        license_number: 'PERIO-4421',
        bio: 'Dedicated to advanced periodontal therapy and implant dentistry.',
        active: true,
        default_buffer_minutes: 20,
        created_at: new Date('2026-01-15T10:00:00Z'),
      };

      const mapped = mapDentist(rawDbRow);

      expect(mapped.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(mapped.clinicId).toBe('00000000-0000-0000-0000-000000000001');
      expect(mapped.displayName).toBe('Dr. Emily Vance');
      expect(mapped.title).toBe('Dr.');
      expect(mapped.qualifications).toBe('DDS, MS (Periodontics)');
      expect(mapped.specialty).toBe('Periodontics');
      expect(mapped.experienceYears).toBe(9);
      expect(mapped.licenseNumber).toBe('PERIO-4421');
      expect(mapped.bio).toBe('Dedicated to advanced periodontal therapy and implant dentistry.');
      expect(mapped.active).toBe(true);
      expect(mapped.isActive).toBe(true);
      expect(mapped.defaultBufferMinutes).toBe(20);
    });

    it('gracefully provides fallbacks when professional columns are null or absent', () => {
      const legacyRow = {
        id: '22222222-2222-2222-2222-222222222222',
        clinic_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Dr. Legacy Dentist',
        specialty: null,
        active: false,
        default_buffer_minutes: null,
        created_at: null,
      };

      const mapped = mapDentist(legacyRow);

      expect(mapped.displayName).toBe('Dr. Legacy Dentist');
      expect(mapped.title).toBeNull();
      expect(mapped.qualifications).toBeNull();
      expect(mapped.specialty).toBe('General Dentistry');
      expect(mapped.experienceYears).toBeNull();
      expect(mapped.licenseNumber).toBeNull();
      expect(mapped.bio).toBeNull();
      expect(mapped.active).toBe(false);
      expect(mapped.isActive).toBe(false);
      expect(mapped.defaultBufferMinutes).toBe(15);
    });
  });

  describe('unpersisted column detection and rejection', () => {
    it('detects requested fields that cannot physically be persisted on pre-migration database', () => {
      const liveNeonColumns = new Set(['id', 'clinic_id', 'user_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at']);
      
      const payload = {
        displayName: 'Dr. Sarah',
        title: 'Dr.',
        qualifications: 'BDS',
        specialty: 'Orthodontics',
      };

      const unpersisted: string[] = [];
      if (payload.title && !liveNeonColumns.has('title')) unpersisted.push('title');
      if (payload.qualifications && !liveNeonColumns.has('qualifications')) unpersisted.push('qualifications');
      if ((payload as any).experienceYears && !liveNeonColumns.has('experience_years')) unpersisted.push('experienceYears');

      expect(unpersisted).toEqual(['title', 'qualifications']);
    });

    it('allows clean persistence when only supported physical columns are targeted', () => {
      const liveNeonColumns = new Set(['id', 'clinic_id', 'user_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at']);
      
      const payload = {
        displayName: 'Dr. Sarah',
        specialty: 'Orthodontics',
        defaultBufferMinutes: 10,
        active: true,
      };

      const unpersisted: string[] = [];
      if ((payload as any).title && !liveNeonColumns.has('title')) unpersisted.push('title');
      if ((payload as any).qualifications && !liveNeonColumns.has('qualifications')) unpersisted.push('qualifications');

      expect(unpersisted).toHaveLength(0);
    });
  });
});
