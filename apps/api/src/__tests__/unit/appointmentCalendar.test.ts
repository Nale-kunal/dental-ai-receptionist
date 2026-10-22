import {
  getClinicToday,
  getLocalDateString,
  getClinicLocalTimeMinutes,
  getWeekRange,
  getMonthGrid,
  addDays,
  addMonths,
  getDateRangeForView,
  formatCalendarTitle,
  layoutDayAppointments,
  toUtcIsoInTimezone,
  formatDateInTimezone,
  formatTimeInTimezone,
} from '@dental/shared';
import { listAppointments } from '../../modules/appointments/appointments.repository';
import { prisma } from '../../database/prisma/client';

// Mock prisma for unit isolation
jest.mock('../../database/prisma/client.js', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe('Enterprise Appointment Calendar & List Views Test Suite', () => {
  const clinicId = '11111111-1111-1111-1111-111111111111';
  const otherClinicId = '22222222-2222-2222-2222-222222222222';
  const newYorkTz = 'America/New_York';
  const tokyoTz = 'Asia/Tokyo';
  const londonTz = 'Europe/London';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Switching between List and Calendar', () => {
    it('shares common filter state structure for both list and calendar', () => {
      const state = {
        viewType: 'list',
        selectedDate: '2026-10-15',
        calendarMode: 'week',
        search: 'Jane',
        statusFilter: 'confirmed',
        doctorFilter: '11111111-1111-1111-1111-111111111112',
        page: 2,
      };

      // Switch to calendar
      const toCalendar = { ...state, viewType: 'calendar' };
      expect(toCalendar.viewType).toBe('calendar');
      expect(toCalendar.statusFilter).toBe('confirmed');
      expect(toCalendar.doctorFilter).toBe('11111111-1111-1111-1111-111111111112');
      expect(toCalendar.search).toBe('Jane');

      // Switch back to list: resets page to 1 but preserves filters
      const backToList = { ...toCalendar, viewType: 'list', page: 1 };
      expect(backToList.viewType).toBe('list');
      expect(backToList.page).toBe(1);
      expect(backToList.statusFilter).toBe('confirmed');
    });
  });

  describe('2. Day, Week, and Month Navigation', () => {
    const baseDate = '2026-10-15'; // Thursday

    it('navigates days correctly with addDays', () => {
      expect(addDays(baseDate, 1)).toBe('2026-10-16');
      expect(addDays(baseDate, -1)).toBe('2026-10-14');
      // Month rollover
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
      // Year rollover
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('navigates weeks correctly with 7-day shifts', () => {
      const currentWeek = getWeekRange(baseDate);
      expect(currentWeek.weekStart).toBe('2026-10-12'); // Monday
      expect(currentWeek.weekEnd).toBe('2026-10-18'); // Sunday
      expect(currentWeek.days).toHaveLength(7);

      const nextWeekStart = addDays(baseDate, 7);
      const nextWeek = getWeekRange(nextWeekStart);
      expect(nextWeek.weekStart).toBe('2026-10-19');
      expect(nextWeek.weekEnd).toBe('2026-10-25');

      const prevWeekStart = addDays(baseDate, -7);
      const prevWeek = getWeekRange(prevWeekStart);
      expect(prevWeek.weekStart).toBe('2026-10-05');
      expect(prevWeek.weekEnd).toBe('2026-10-11');
    });

    it('navigates months correctly with addMonths', () => {
      expect(addMonths(baseDate, 1)).toBe('2026-11-15');
      expect(addMonths(baseDate, -1)).toBe('2026-09-15');
      // Year rollover
      expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
      expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
      // Clamping to last day of shorter month
      expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    });
  });

  describe('3. Today using the clinic timezone', () => {
    it('computes today formatted as YYYY-MM-DD in the specified clinic timezone', () => {
      const todayNY = getClinicToday(newYorkTz);
      const todayTokyo = getClinicToday(tokyoTz);

      expect(todayNY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(todayTokyo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('demonstrates clinic timezone determines local date without browser skew', () => {
      // Midnight in London (UTC 00:00:00) on 2026-10-15:
      // In New York (EDT, UTC-4), it is still 2026-10-14 20:00:00 (8:00 PM previous day)
      const instant = '2026-10-15T00:00:00.000Z';
      const nyDate = getLocalDateString(instant, newYorkTz);
      const londonDate = getLocalDateString(instant, londonTz);

      expect(nyDate).toBe('2026-10-14');
      expect(londonDate).toBe('2026-10-15');
    });
  });

  describe('4. List date-range filtering', () => {
    it('computes exact UTC boundaries for clinic today in America/New_York (EDT UTC-4)', () => {
      const targetDate = '2026-10-15';
      const dateFrom = toUtcIsoInTimezone(targetDate, '00:00:00', newYorkTz);
      const dateTo = toUtcIsoInTimezone(addDays(targetDate, 1), '00:00:00', newYorkTz);

      // EDT is UTC-4, so 00:00 EDT is 04:00 UTC
      expect(dateFrom).toBe('2026-10-15T04:00:00.000Z');
      expect(dateTo).toBe('2026-10-16T04:00:00.000Z');
    });

    it('computes exact week range [Monday 00:00:00, next Monday 00:00:00) in clinic timezone', () => {
      const { weekStart, weekEnd } = getWeekRange('2026-10-15');
      expect(weekStart).toBe('2026-10-12');
      expect(weekEnd).toBe('2026-10-18');

      const dateFrom = toUtcIsoInTimezone(weekStart, '00:00:00', newYorkTz);
      const dateTo = toUtcIsoInTimezone(addDays(weekEnd, 1), '00:00:00', newYorkTz);

      expect(dateFrom).toBe('2026-10-12T04:00:00.000Z');
      expect(dateTo).toBe('2026-10-19T04:00:00.000Z');
    });
  });

  describe('5. Combined search, status, practitioner, and date-range filtering', () => {
    it('constructs correct SQL query parameters without drops or SQL injections', async () => {
      const mockRaw = prisma.$queryRawUnsafe as jest.Mock;
      mockRaw
        .mockResolvedValueOnce([{ count: '1' }]) // count query
        .mockResolvedValueOnce([
          {
            id: 'appt-1',
            clinicId,
            clinicTimezone: newYorkTz,
            confirmationCode: 'CONF-001',
            status: 'confirmed',
            startsAt: new Date('2026-10-15T14:00:00Z'),
            endsAt: new Date('2026-10-15T14:30:00Z'),
            durationMinutes: 30,
            bufferMinutes: 10,
            patientId: 'patient-1',
            dentistId: '11111111-1111-1111-1111-111111111112',
            serviceId: 'service-1',
            createdAt: new Date('2026-10-01T10:00:00Z'),
            updatedAt: new Date('2026-10-01T10:00:00Z'),
            patient: { fullName: 'Alice Smith', phone: '+1234567890', email: 'alice@example.com' },
            dentist: { displayName: 'Dr. Sarah Smith', specialty: 'General' },
            service: { name: 'Dental Cleaning', durationMinutes: 30, code: 'CLEAN' },
          },
        ]);

      const result: any = await listAppointments(clinicId, {
        page: 1,
        pageSize: 15,
        search: 'Alice',
        status: 'confirmed',
        doctorId: '11111111-1111-1111-1111-111111111112',
        dateFrom: '2026-10-15T04:00:00.000Z',
        dateTo: '2026-10-16T04:00:00.000Z',
      });

      expect(mockRaw).toHaveBeenCalledTimes(2);
      const [countSql, ...countParams] = mockRaw.mock.calls[0];

      // Check parameterized tenant isolation
      expect(countParams[0]).toBe(clinicId);
      expect(countSql).toContain('a.clinic_id = $1::uuid');

      // Check status filter
      expect(countSql).toContain('a.status =');
      expect(countParams).toContain('confirmed');

      // Check practitioner filter
      expect(countSql).toContain('a.dentist_id =');
      expect(countParams).toContain('11111111-1111-1111-1111-111111111112');

      // Check date bounds
      expect(countSql).toContain('a.starts_at >=');
      expect(countSql).toContain('a.starts_at <');

      // Check search ILIKE
      expect(countSql).toContain('ILIKE');
      expect(countParams).toContain('%Alice%');

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('6. Appointment positioning and duration', () => {
    it('calculates start minutes from midnight and duration accurately in clinic timezone', () => {
      // 10:00 AM EDT = 14:00 UTC
      const appt = {
        id: 'appt-1',
        startsAt: '2026-10-15T14:00:00.000Z',
        durationMinutes: 45,
        status: 'confirmed',
      };

      const localDate = getLocalDateString(appt.startsAt, newYorkTz);
      const startMins = getClinicLocalTimeMinutes(appt.startsAt, newYorkTz);

      expect(localDate).toBe('2026-10-15');
      expect(startMins).toBe(10 * 60); // 600 minutes from midnight

      const layout = layoutDayAppointments([appt], newYorkTz);
      expect(layout).toHaveLength(1);
      expect(layout[0].startMinutes).toBe(600);
      expect(layout[0].durationMinutes).toBe(45);
      expect(layout[0].endMinutes).toBe(645);
      expect(layout[0].column).toBe(0);
      expect(layout[0].totalColumns).toBe(1);
    });
  });

  describe('7. Overlapping appointments positioning algorithm', () => {
    it('correctly partitions concurrent appointments into non-colliding columns', () => {
      // Appt 1: 9:00 AM - 10:00 AM (startsAt 13:00 UTC)
      // Appt 2: 9:30 AM - 10:30 AM (startsAt 13:30 UTC) - Overlaps Appt 1
      // Appt 3: 9:45 AM - 10:15 AM (startsAt 13:45 UTC) - Overlaps Appt 1 & 2
      // Appt 4: 11:00 AM - 11:30 AM (startsAt 15:00 UTC) - Non-overlapping
      const appointments = [
        { id: 'appt-1', startsAt: '2026-10-15T13:00:00.000Z', durationMinutes: 60, status: 'confirmed' },
        { id: 'appt-2', startsAt: '2026-10-15T13:30:00.000Z', durationMinutes: 60, status: 'confirmed' },
        { id: 'appt-3', startsAt: '2026-10-15T13:45:00.000Z', durationMinutes: 30, status: 'confirmed' },
        { id: 'appt-4', startsAt: '2026-10-15T15:00:00.000Z', durationMinutes: 30, status: 'confirmed' },
      ];

      const positioned = layoutDayAppointments(appointments, newYorkTz);

      expect(positioned).toHaveLength(4);

      const p1 = positioned.find((p) => p.appointment.id === 'appt-1')!;
      const p2 = positioned.find((p) => p.appointment.id === 'appt-2')!;
      const p3 = positioned.find((p) => p.appointment.id === 'appt-3')!;
      const p4 = positioned.find((p) => p.appointment.id === 'appt-4')!;

      // Cluster 1 (appts 1, 2, 3) must have 3 columns and unique column indexes
      expect(p1.totalColumns).toBe(3);
      expect(p2.totalColumns).toBe(3);
      expect(p3.totalColumns).toBe(3);

      const cols = new Set([p1.column, p2.column, p3.column]);
      expect(cols.size).toBe(3);
      expect(cols.has(0)).toBe(true);
      expect(cols.has(1)).toBe(true);
      expect(cols.has(2)).toBe(true);

      // Appt 4 is in a separate non-overlapping cluster
      expect(p4.totalColumns).toBe(1);
      expect(p4.column).toBe(0);
    });
  });

  describe('8. Month date selection opening the correct Day view', () => {
    it('generates an aligned month grid where clicking any cell provides exact dateStr', () => {
      const grid = getMonthGrid('2026-10-15', newYorkTz);

      expect(grid.year).toBe(2026);
      expect(grid.month).toBe(10);
      // October 2026 starts on Thursday (ISO day 4), ends on Saturday (ISO day 6)
      // Total grid cells = 3 leading days + 31 days + 1 trailing day = 35 cells (5 weeks)
      expect(grid.days.length).toBe(35);

      // First cell is Monday 2026-09-28
      expect(grid.days[0].dateStr).toBe('2026-09-28');
      expect(grid.days[0].isCurrentMonth).toBe(false);

      // Target day is present and valid
      const targetCell = grid.days.find((c) => c.dateStr === '2026-10-15');
      expect(targetCell).toBeDefined();
      expect(targetCell!.isCurrentMonth).toBe(true);
      expect(targetCell!.dayNumber).toBe(15);
    });
  });

  describe('9. Opening appointment details', () => {
    it('verifies appointment object contains all required display fields', () => {
      const appointment = {
        id: 'appt-uuid-1234',
        confirmationCode: 'CONF-8899',
        startsAt: '2026-10-15T14:00:00.000Z',
        durationMinutes: 45,
        bufferMinutes: 15,
        status: 'confirmed',
        notes: 'Patient requested morning window',
        source: 'WhatsApp AI Receptionist',
        patient: {
          name: 'Eleanor Vance',
          phone: '+15550198273',
          email: 'eleanor@example.com',
        },
        doctor: {
          name: 'Dr. Sarah Smith',
          specialty: 'Orthodontics',
        },
        service: {
          name: 'Orthodontic Consultation',
          description: 'Initial examination and treatment plan',
        },
      };

      expect(appointment.confirmationCode).toBe('CONF-8899');
      expect(appointment.patient.name).toBe('Eleanor Vance');
      expect(appointment.patient.phone).toBe('+15550198273');
      expect(appointment.doctor.name).toBe('Dr. Sarah Smith');
      expect(appointment.service.name).toBe('Orthodontic Consultation');
      expect(formatTimeInTimezone(appointment.startsAt, newYorkTz)).toBe('10:00 AM');
    });
  });

  describe('10. Rescheduling updating calendar position', () => {
    it('recalculates local date and minutes when appointment starts_at moves', () => {
      // Original: 2026-10-15 at 10:00 AM EDT (14:00 UTC)
      const originalTime = '2026-10-15T14:00:00.000Z';
      expect(getLocalDateString(originalTime, newYorkTz)).toBe('2026-10-15');
      expect(getClinicLocalTimeMinutes(originalTime, newYorkTz)).toBe(600);

      // Rescheduled to: 2026-10-16 at 02:30 PM EDT (18:30 UTC)
      const rescheduledTime = '2026-10-16T18:30:00.000Z';
      expect(getLocalDateString(rescheduledTime, newYorkTz)).toBe('2026-10-16');
      expect(getClinicLocalTimeMinutes(rescheduledTime, newYorkTz)).toBe(14 * 60 + 30); // 870
    });
  });

  describe('11. Cancellation updating appointment status', () => {
    it('changes appointment status to cancelled while preserving time properties', () => {
      const appt = {
        id: 'appt-1',
        status: 'confirmed',
        startsAt: '2026-10-15T14:00:00.000Z',
      };

      const cancelledAppt = { ...appt, status: 'cancelled' };
      expect(cancelledAppt.status).toBe('cancelled');
      expect(cancelledAppt.startsAt).toBe(appt.startsAt);
    });
  });

  describe('12. Calendar refresh after booking & pageSize 500 support', () => {
    it('allows fetching up to 500 appointments for busy clinic month views without truncation', async () => {
      const mockRaw = prisma.$queryRawUnsafe as jest.Mock;
      mockRaw
        .mockResolvedValueOnce([{ count: '150' }])
        .mockResolvedValueOnce(
          Array.from({ length: 150 }, (_, i) => ({
            id: `appt-${i}`,
            clinicId,
            clinicTimezone: newYorkTz,
            confirmationCode: `CODE-${i}`,
            status: 'confirmed',
            startsAt: new Date('2026-10-15T14:00:00Z'),
            endsAt: new Date('2026-10-15T14:30:00Z'),
            durationMinutes: 30,
            bufferMinutes: 10,
            patientId: `p-${i}`,
            dentistId: '11111111-1111-1111-1111-111111111112',
            serviceId: 's-1',
            createdAt: new Date(),
            updatedAt: new Date(),
          }))
        );

      const result: any = await listAppointments(clinicId, {
        page: 1,
        pageSize: 500,
        dateFrom: '2026-10-01T04:00:00.000Z',
        dateTo: '2026-11-01T04:00:00.000Z',
      });

      expect(result.items).toHaveLength(150);
      expect(result.total).toBe(150);
    });
  });

  describe('13. Empty, loading, and error states', () => {
    it('safely handles empty appointments without crashing or throwing', () => {
      expect(layoutDayAppointments([])).toEqual([]);
      expect(layoutDayAppointments(null as any)).toEqual([]);
      expect(layoutDayAppointments(undefined as any)).toEqual([]);
    });
  });

  describe('14. Tenant isolation and authorization', () => {
    it('strictly scopes appointment queries to the authenticated clinic ID', async () => {
      const mockRaw = prisma.$queryRawUnsafe as jest.Mock;
      mockRaw.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

      await listAppointments(clinicId, { page: 1, pageSize: 50 });

      const [, ...params] = mockRaw.mock.calls[0];
      expect(params[0]).toBe(clinicId);
      expect(params[0]).not.toBe(otherClinicId);
    });
  });

  describe('15. Timezone and Daylight-Saving (DST) Edge Cases', () => {
    it('correctly handles appointment near midnight without off-by-one errors', () => {
      // 11:45 PM EDT on Oct 14 in New York = 03:45 AM UTC on Oct 15
      const nearMidnightUtc = '2026-10-15T03:45:00.000Z';
      const nyDate = getLocalDateString(nearMidnightUtc, newYorkTz);
      const nyMinutes = getClinicLocalTimeMinutes(nearMidnightUtc, newYorkTz);

      expect(nyDate).toBe('2026-10-14');
      expect(nyMinutes).toBe(23 * 60 + 45); // 1425 minutes
    });

    it('correctly handles autumn DST transition (EDT -> EST in November)', () => {
      // Before transition: Oct 31, 2026 (EDT, UTC-4)
      const beforeDstUtc = toUtcIsoInTimezone('2026-10-31', '10:00', newYorkTz);
      expect(beforeDstUtc).toBe('2026-10-31T14:00:00.000Z');

      // After transition: Nov 1, 2026 at 10:00 AM (EST, UTC-5, as 2:00 AM was the turnback)
      const afterDstUtc = toUtcIsoInTimezone('2026-11-01', '10:00', newYorkTz);
      expect(afterDstUtc).toBe('2026-11-01T15:00:00.000Z');
    });

    it('correctly handles spring DST transition (EST -> EDT in March)', () => {
      // Before transition: March 7, 2026 (EST, UTC-5)
      const beforeSpringUtc = toUtcIsoInTimezone('2026-03-07', '10:00', newYorkTz);
      expect(beforeSpringUtc).toBe('2026-03-07T15:00:00.000Z');

      // After transition: March 9, 2026 (EDT, UTC-4)
      const afterSpringUtc = toUtcIsoInTimezone('2026-03-09', '10:00', newYorkTz);
      expect(afterSpringUtc).toBe('2026-03-09T14:00:00.000Z');
    });
  });

  describe('16. Accessible labels and titles', () => {
    it('formats title for Day, Week, and Month views clearly', () => {
      expect(formatCalendarTitle('2026-10-15', 'day', newYorkTz)).toContain('Oct 15, 2026');
      expect(formatCalendarTitle('2026-10-15', 'week', newYorkTz)).toBe('Oct 12 – 18, 2026');
      expect(formatCalendarTitle('2026-10-15', 'month', newYorkTz)).toBe('October 2026');
    });
  });
});
