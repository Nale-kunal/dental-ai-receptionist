import { z } from 'zod';

const patientSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  notes: z.string().max(2000).optional(),
});

function normalizePatientNames<T extends { fullName?: string; firstName?: string; lastName?: string }>(data: T): T & { fullName: string; firstName: string; lastName: string } {
  let fullName = data.fullName?.trim();
  let firstName = data.firstName?.trim();
  let lastName = data.lastName?.trim();

  if (fullName && (!firstName || !lastName)) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] || 'Unknown';
    lastName = parts.slice(1).join(' ') || parts[0] || 'Patient';
  } else if (!fullName && (firstName || lastName)) {
    fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown Patient';
    firstName = firstName || 'Unknown';
    lastName = lastName || 'Patient';
  } else if (!fullName && !firstName && !lastName) {
    fullName = 'New Patient';
    firstName = 'New';
    lastName = 'Patient';
  }

  return {
    ...data,
    fullName: fullName!,
    firstName: firstName!,
    lastName: lastName!,
  };
}

describe('Patient Contract & Normalization Unit Tests', () => {
  it('successfully parses and normalizes a payload containing fullName (UI format)', () => {
    const payload = {
      fullName: 'Sarah Elizabeth Connor',
      phone: '+14155551234',
      email: 'sarah.connor@example.com',
      dateOfBirth: '1985-05-12',
      notes: 'Late evening appointments preferred',
    };

    const parsed = patientSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const normalized = normalizePatientNames(parsed.data);
      expect(normalized.fullName).toBe('Sarah Elizabeth Connor');
      expect(normalized.firstName).toBe('Sarah');
      expect(normalized.lastName).toBe('Elizabeth Connor');
    }
  });

  it('successfully parses and normalizes legacy payload containing firstName and lastName', () => {
    const payload = {
      firstName: 'John',
      lastName: 'Doe',
      phone: '+14155555678',
    };

    const parsed = patientSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const normalized = normalizePatientNames(parsed.data);
      expect(normalized.fullName).toBe('John Doe');
      expect(normalized.firstName).toBe('John');
      expect(normalized.lastName).toBe('Doe');
    }
  });

  it('handles single-word names correctly without crashing', () => {
    const payload = {
      fullName: 'Madonna',
      phone: '+14155550000',
    };

    const parsed = patientSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const normalized = normalizePatientNames(parsed.data);
      expect(normalized.firstName).toBe('Madonna');
      expect(normalized.lastName).toBe('Madonna');
      expect(normalized.fullName).toBe('Madonna');
    }
  });

  it('allows empty email string as valid optional value', () => {
    const payload = {
      fullName: 'Test Patient',
      email: '',
    };

    const parsed = patientSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
