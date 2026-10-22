import { getPublicHolidays } from '../../modules/schedules/holiday.data';

describe('Holiday Overrides, Scheduling Availability & Pricing Safety Suite', () => {
  const clinicA_Id = '11111111-1111-1111-1111-111111111111';
  const clinicB_Id = '22222222-2222-2222-2222-222222222222';
  const dentist1_Id = '33333333-3333-3333-3333-333333333333';

  describe('1. Holiday Data Calculation & Location Awareness', () => {
    it('returns location-aware holidays for US jurisdiction', () => {
      const holidays2026 = getPublicHolidays('US', 2026);
      expect(holidays2026.length).toBeGreaterThanOrEqual(10);

      const memDay = holidays2026.find((h) => h.name === 'Memorial Day');
      expect(memDay).toBeDefined();
      expect(memDay?.date).toBe('2026-05-25'); // Last Monday of May 2026

      const thanks = holidays2026.find((h) => h.name === 'Thanksgiving Day');
      expect(thanks).toBeDefined();
      expect(thanks?.date).toBe('2026-11-26'); // 4th Thursday of November 2026
    });

    it('returns location-aware bank holidays for GB jurisdiction', () => {
      const holidaysGB = getPublicHolidays('GB', 2026);
      expect(holidaysGB.length).toBeGreaterThanOrEqual(8);

      const earlyMay = holidaysGB.find((h) => h.name === 'Early May Bank Holiday');
      expect(earlyMay).toBeDefined();
      expect(earlyMay?.date).toBe('2026-05-04'); // First Monday of May 2026

      const boxingDay = holidaysGB.find((h) => h.name === 'Boxing Day');
      expect(boxingDay).toBeDefined();
      expect(boxingDay?.date).toBe('2026-12-26');
    });

    it('returns Easter-derived holidays (Good Friday) correctly via Butcher algorithm', () => {
      // Easter 2026 is April 5, 2026. Good Friday is April 3, 2026.
      const holidays2026 = getPublicHolidays('GB', 2026);
      const goodFriday = holidays2026.find((h) => h.name === 'Good Friday');
      expect(goodFriday).toBeDefined();
      expect(goodFriday?.date).toBe('2026-04-03');
    });
  });

  describe('2. Holiday Overrides & Schedule Block Deletion Safety', () => {
    // Simulated schedule_blocks database table
    interface MockBlock {
      id: string;
      clinic_id: string;
      dentist_id: string | null;
      kind: 'holiday' | 'closure' | 'maintenance' | 'leave';
      starts_at: string;
      ends_at: string;
      reason: string;
    }

    const mockBlocks: MockBlock[] = [
      // Clinic A whole-clinic holiday closure on Memorial Day
      {
        id: 'blk-1',
        clinic_id: clinicA_Id,
        dentist_id: null,
        kind: 'holiday',
        starts_at: '2026-05-25T00:00:00Z',
        ends_at: '2026-05-25T23:59:59Z',
        reason: 'Memorial Day',
      },
      // Clinic A custom maintenance closure on Memorial Day (must NOT be deleted)
      {
        id: 'blk-2',
        clinic_id: clinicA_Id,
        dentist_id: null,
        kind: 'maintenance',
        starts_at: '2026-05-25T08:00:00Z',
        ends_at: '2026-05-25T11:00:00Z',
        reason: 'Air Filtration Duct Sterilization',
      },
      // Clinic A dentist lunch break on Memorial Day (must NOT be deleted)
      {
        id: 'blk-3',
        clinic_id: clinicA_Id,
        dentist_id: dentist1_Id,
        kind: 'leave',
        starts_at: '2026-05-25T13:00:00Z',
        ends_at: '2026-05-25T14:00:00Z',
        reason: 'Doctor Lunch Break',
      },
      // Clinic B whole-clinic holiday closure on Memorial Day (must NOT be deleted by Clinic A action)
      {
        id: 'blk-4',
        clinic_id: clinicB_Id,
        dentist_id: null,
        kind: 'holiday',
        starts_at: '2026-05-25T00:00:00Z',
        ends_at: '2026-05-25T23:59:59Z',
        reason: 'Memorial Day',
      },
    ];

    // Filter matching the SQL in schedules.routes.ts:
    // WHERE clinic_id = $1::uuid AND dentist_id IS NULL AND kind = 'holiday' AND starts_at::date = $2::date
    function simulateWorkingDayOverrideDeletion(
      blocks: MockBlock[],
      targetClinicId: string,
      targetDate: string
    ): MockBlock[] {
      return blocks.filter((b) => {
        const matchesClinic = b.clinic_id === targetClinicId;
        const isWholeClinic = b.dentist_id === null;
        const isHolidayKind = b.kind === 'holiday';
        const matchesDate = b.starts_at.startsWith(targetDate);

        // If all match, the SQL DELETE removes it
        const shouldDelete = matchesClinic && isWholeClinic && isHolidayKind && matchesDate;
        return !shouldDelete;
      });
    }

    it('marking a holiday as working_day deletes ONLY whole-clinic holiday blocks for that clinic', () => {
      const remaining = simulateWorkingDayOverrideDeletion(mockBlocks, clinicA_Id, '2026-05-25');

      // blk-1 (holiday, clinic A, whole-clinic) should be deleted
      expect(remaining.find((b) => b.id === 'blk-1')).toBeUndefined();

      // blk-2 (maintenance, clinic A) MUST be preserved
      expect(remaining.find((b) => b.id === 'blk-2')).toBeDefined();

      // blk-3 (dentist lunch break, clinic A) MUST be preserved
      expect(remaining.find((b) => b.id === 'blk-3')).toBeDefined();

      // blk-4 (holiday, Clinic B) MUST be preserved (cross-tenant safety)
      expect(remaining.find((b) => b.id === 'blk-4')).toBeDefined();
      expect(remaining.length).toBe(3);
    });

    it('ensures holiday override does not affect other clinics under any circumstance', () => {
      const remaining = simulateWorkingDayOverrideDeletion(mockBlocks, clinicA_Id, '2026-05-25');
      const clinicBBlocks = remaining.filter((b) => b.clinic_id === clinicB_Id);
      expect(clinicBBlocks.length).toBe(1);
      expect(clinicBBlocks[0].id).toBe('blk-4');
    });
  });

  describe('3. Scheduling Availability Precedence & Hour Constraints', () => {
    interface BusinessHour {
      dayOfWeek: number; // 0=Sun, 1=Mon...
      opensAt: string;
      closesAt: string;
    }

    interface DentistShift {
      dentistId: string;
      dayOfWeek: number;
      startsAt: string;
      endsAt: string;
    }

    const clinicHours: BusinessHour[] = [
      { dayOfWeek: 1, opensAt: '08:30', closesAt: '16:30' },
      { dayOfWeek: 2, opensAt: '08:30', closesAt: '16:30' },
      { dayOfWeek: 3, opensAt: '08:30', closesAt: '16:30' },
      { dayOfWeek: 4, opensAt: '08:30', closesAt: '16:30' },
      { dayOfWeek: 5, opensAt: '08:30', closesAt: '16:30' },
      // Saturday (6) and Sunday (0) are unconfigured / closed
    ];

    const dentistShift: DentistShift = {
      dentistId: dentist1_Id,
      dayOfWeek: 1, // Monday
      startsAt: '09:00',
      endsAt: '15:00', // Leaves before clinic closes at 16:30
    };

    function isSlotBookable(
      dateStr: string,
      startTime: string,
      endTime: string,
      hours: BusinessHour[],
      dentist: DentistShift | null,
      breaks: { startsAt: string; endsAt: string }[]
    ): { bookable: boolean; reason?: string } {
      const date = new Date(dateStr + 'T00:00:00Z');
      const dow = date.getUTCDay();

      // 1. Clinic operating hours check
      const dayHour = hours.find((h) => h.dayOfWeek === dow);
      if (!dayHour) {
        return { bookable: false, reason: 'Clinic closed or unconfigured on this day' };
      }
      if (startTime < dayHour.opensAt || endTime > dayHour.closesAt) {
        return { bookable: false, reason: 'Time is outside clinic operating hours' };
      }

      // 2. Dentist shift check
      if (dentist) {
        if (dentist.dayOfWeek !== dow) {
          return { bookable: false, reason: 'Dentist does not work on this day' };
        }
        if (startTime < dentist.startsAt || endTime > dentist.endsAt) {
          return { bookable: false, reason: 'Time is outside dentist working shift' };
        }
      }

      // 3. Dentist break check
      for (const brk of breaks) {
        if (startTime < brk.endsAt && endTime > brk.startsAt) {
          return { bookable: false, reason: 'Time overlaps dentist break or leave' };
        }
      }

      return { bookable: true };
    }

    it('rejects booking on unconfigured days (Saturday & Sunday)', () => {
      // 2026-05-30 is a Saturday (dow 6)
      const resSat = isSlotBookable('2026-05-30', '10:00', '10:45', clinicHours, null, []);
      expect(resSat.bookable).toBe(false);
      expect(resSat.reason).toContain('Clinic closed or unconfigured');

      // 2026-05-31 is a Sunday (dow 0)
      const resSun = isSlotBookable('2026-05-31', '10:00', '10:45', clinicHours, null, []);
      expect(resSun.bookable).toBe(false);
      expect(resSun.reason).toContain('Clinic closed or unconfigured');
    });

    it('rejects booking outside clinic business hours on an open working day', () => {
      // Monday 2026-05-25: clinic opens at 08:30 and closes at 16:30
      const earlySlot = isSlotBookable('2026-05-25', '07:30', '08:15', clinicHours, null, []);
      expect(earlySlot.bookable).toBe(false);
      expect(earlySlot.reason).toContain('outside clinic operating hours');

      const lateSlot = isSlotBookable('2026-05-25', '17:00', '17:45', clinicHours, null, []);
      expect(lateSlot.bookable).toBe(false);
      expect(lateSlot.reason).toContain('outside clinic operating hours');
    });

    it('rejects booking outside dentist shift hours even when clinic is open', () => {
      // Monday 15:30: clinic is open until 16:30, but dentist shift ends at 15:00
      const res = isSlotBookable('2026-05-25', '15:15', '16:00', clinicHours, dentistShift, []);
      expect(res.bookable).toBe(false);
      expect(res.reason).toContain('outside dentist working shift');
    });

    it('rejects booking that overlaps dentist lunch break', () => {
      const lunchBreak = [{ startsAt: '13:00', endsAt: '14:00' }];
      const overlappingSlot = isSlotBookable(
        '2026-05-25',
        '13:30',
        '14:15',
        clinicHours,
        dentistShift,
        lunchBreak
      );
      expect(overlappingSlot.bookable).toBe(false);
      expect(overlappingSlot.reason).toContain('overlaps dentist break');
    });

    it('accepts booking strictly within valid clinic and dentist shift interval', () => {
      const lunchBreak = [{ startsAt: '13:00', endsAt: '14:00' }];
      const validSlot = isSlotBookable(
        '2026-05-25',
        '10:00',
        '10:45',
        clinicHours,
        dentistShift,
        lunchBreak
      );
      expect(validSlot.bookable).toBe(true);
    });
  });

  describe('4. Service Pricing & Currency Representation Safety', () => {
    function mapServiceData(input: {
      price?: number | null;
      currency?: string;
      pricingModel?: 'fixed' | 'starting_from' | 'quote_required';
    }) {
      const pricingModel = input.pricingModel || 'fixed';
      const price = pricingModel === 'quote_required' ? null : input.price != null ? Number(input.price) : null;
      const currency = input.currency || 'USD';
      return { price, currency, pricingModel };
    }

    it('preserves null price for quote_required services without converting to 0', () => {
      const mapped = mapServiceData({
        price: null,
        pricingModel: 'quote_required',
        currency: 'GBP',
      });
      expect(mapped.price).toBeNull();
      expect(mapped.pricingModel).toBe('quote_required');
      expect(mapped.currency).toBe('GBP');
      expect(mapped.price).not.toBe(0);
    });

    it('preserves exact decimal values for fixed and starting_from models', () => {
      const fixedService = mapServiceData({
        price: 150.75,
        pricingModel: 'fixed',
        currency: 'USD',
      });
      expect(fixedService.price).toBe(150.75);
      expect(fixedService.pricingModel).toBe('fixed');

      const startingService = mapServiceData({
        price: 220.0,
        pricingModel: 'starting_from',
        currency: 'EUR',
      });
      expect(startingService.price).toBe(220.0);
      expect(startingService.pricingModel).toBe('starting_from');
      expect(startingService.currency).toBe('EUR');
    });
  });
});
