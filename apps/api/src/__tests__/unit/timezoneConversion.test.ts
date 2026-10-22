import {
  formatDateInTimezone,
  formatTimeInTimezone,
  formatDateTimeInTimezone,
  toUtcIsoInTimezone,
} from '@dental/shared';

describe('Clinic Timezone Display & Conversion Regression Suite', () => {
  describe('Appointment DZXV-CUIN Verified Evidence Regression', () => {
    const verifiedUtcStartsAt = '2026-10-15T14:00:00.000Z';
    const clinicTimezone = 'America/New_York';

    it('formats UTC starts_at correctly in clinic timezone (EDT)', () => {
      const dateDisplay = formatDateInTimezone(verifiedUtcStartsAt, clinicTimezone);
      const timeDisplay = formatTimeInTimezone(verifiedUtcStartsAt, clinicTimezone);
      const fullDisplay = formatDateTimeInTimezone(verifiedUtcStartsAt, clinicTimezone);

      expect(dateDisplay).toBe('10/15/2026');
      expect(timeDisplay).toBe('10:00 AM');
      expect(fullDisplay).toBe('10/15/2026 at 10:00 AM');
    });

    it('demonstrates the root cause when client timezone (Asia/Kolkata +05:30) is mistakenly used', () => {
      // In Asia/Kolkata (UTC+5:30), 14:00 UTC is 19:30 (7:30 PM)
      const browserDisplayInIndia = formatTimeInTimezone(verifiedUtcStartsAt, 'Asia/Kolkata');
      expect(browserDisplayInIndia).toBe('07:30 PM');

      // The clinic timezone MUST always override the browser timezone:
      const clinicDisplay = formatTimeInTimezone(verifiedUtcStartsAt, clinicTimezone);
      expect(clinicDisplay).toBe('10:00 AM');
      expect(clinicDisplay).not.toBe(browserDisplayInIndia);
    });

    it('converts requested clinic local time (10:00 AM on 2026-10-15) back to exact UTC ISO', () => {
      const utcIso24h = toUtcIsoInTimezone('2026-10-15', '10:00', clinicTimezone);
      expect(utcIso24h).toBe('2026-10-15T14:00:00.000Z');

      const utcIso12h = toUtcIsoInTimezone('2026-10-15', '10:00 AM', clinicTimezone);
      expect(utcIso12h).toBe('2026-10-15T14:00:00.000Z');
    });

    it('proves that 2026-10-15T14:00:00Z displays as 10:00 AM on October 15 in America/New_York, while the same timestamp displays in another timezone when that other clinic is selected', () => {
      const timestamp = '2026-10-15T14:00:00Z';

      // Clinic A: America/New_York (EDT, UTC-4) -> 10:00 AM
      expect(formatDateInTimezone(timestamp, 'America/New_York')).toBe('10/15/2026');
      expect(formatTimeInTimezone(timestamp, 'America/New_York')).toBe('10:00 AM');
      expect(formatDateTimeInTimezone(timestamp, 'America/New_York')).toBe('10/15/2026 at 10:00 AM');

      // Clinic B: America/Los_Angeles (PDT, UTC-7) -> 07:00 AM
      expect(formatDateInTimezone(timestamp, 'America/Los_Angeles')).toBe('10/15/2026');
      expect(formatTimeInTimezone(timestamp, 'America/Los_Angeles')).toBe('07:00 AM');
      expect(formatDateTimeInTimezone(timestamp, 'America/Los_Angeles')).toBe('10/15/2026 at 07:00 AM');

      // Clinic C: Europe/London (BST, UTC+1) -> 03:00 PM
      expect(formatDateInTimezone(timestamp, 'Europe/London')).toBe('10/15/2026');
      expect(formatTimeInTimezone(timestamp, 'Europe/London')).toBe('03:00 PM');
      expect(formatDateTimeInTimezone(timestamp, 'Europe/London')).toBe('10/15/2026 at 03:00 PM');

      // Clinic D: Asia/Tokyo (JST, UTC+9) -> 11:00 PM
      expect(formatDateInTimezone(timestamp, 'Asia/Tokyo')).toBe('10/15/2026');
      expect(formatTimeInTimezone(timestamp, 'Asia/Tokyo')).toBe('11:00 PM');
      expect(formatDateTimeInTimezone(timestamp, 'Asia/Tokyo')).toBe('10/15/2026 at 11:00 PM');
    });
  });

  describe('Daylight Saving vs Standard Time in America/New_York', () => {
    const clinicTimezone = 'America/New_York';

    it('handles EDT (Daylight Saving Time, UTC-4 in October)', () => {
      // 10:00 AM EDT -> 14:00 UTC
      const utc = toUtcIsoInTimezone('2026-10-15', '10:00', clinicTimezone);
      expect(utc).toBe('2026-10-15T14:00:00.000Z');
      expect(formatTimeInTimezone(utc, clinicTimezone)).toBe('10:00 AM');
    });

    it('handles EST (Standard Time, UTC-5 in January)', () => {
      // 10:00 AM EST -> 15:00 UTC
      const utc = toUtcIsoInTimezone('2026-01-15', '10:00', clinicTimezone);
      expect(utc).toBe('2026-01-15T15:00:00.000Z');
      expect(formatTimeInTimezone(utc, clinicTimezone)).toBe('10:00 AM');
    });
  });

  describe('Dynamic Multi-Timezone Support (No Hardcoded Timezones)', () => {
    it('correctly converts for clinic in America/Los_Angeles (UTC-7)', () => {
      const utc = toUtcIsoInTimezone('2026-10-15', '10:00', 'America/Los_Angeles');
      expect(utc).toBe('2026-10-15T17:00:00.000Z');
      expect(formatTimeInTimezone(utc, 'America/Los_Angeles')).toBe('10:00 AM');
    });

    it('correctly converts for clinic in Europe/London (UTC+1 in October)', () => {
      const utc = toUtcIsoInTimezone('2026-10-15', '10:00', 'Europe/London');
      expect(utc).toBe('2026-10-15T09:00:00.000Z');
      expect(formatTimeInTimezone(utc, 'Europe/London')).toBe('10:00 AM');
    });

    it('correctly converts for clinic in Asia/Tokyo (UTC+9)', () => {
      const utc = toUtcIsoInTimezone('2026-10-15', '10:00', 'Asia/Tokyo');
      expect(utc).toBe('2026-10-15T01:00:00.000Z');
      expect(formatTimeInTimezone(utc, 'Asia/Tokyo')).toBe('10:00 AM');
    });
  });

  describe('Edge Cases and Fallbacks', () => {
    it('accepts valid Date objects directly', () => {
      const d = new Date('2026-10-15T14:00:00Z');
      expect(formatTimeInTimezone(d, 'America/New_York')).toBe('10:00 AM');
      expect(formatDateInTimezone(d, 'America/New_York')).toBe('10/15/2026');
    });

    it('accepts epoch millisecond timestamp numbers directly (e.g. Date.now() crash fix)', () => {
      const epochMs = new Date('2026-10-15T14:00:00Z').getTime();
      expect(formatTimeInTimezone(epochMs, 'America/New_York')).toBe('10:00 AM');
      expect(formatDateInTimezone(epochMs, 'America/New_York')).toBe('10/15/2026');
    });

    it('gracefully handles null and undefined date inputs without throwing', () => {
      expect(formatDateInTimezone(null)).toBe('—');
      expect(formatTimeInTimezone(undefined)).toBe('—');
      expect(formatDateTimeInTimezone(null)).toBe('—');
    });

    it('gracefully handles invalid date string inputs without throwing', () => {
      expect(formatDateInTimezone('invalid-date')).toBe('—');
      expect(formatTimeInTimezone('not-a-timestamp')).toBe('—');
      expect(formatDateTimeInTimezone('gibberish')).toBe('—');
    });

    it('gracefully falls back to UTC when an invalid timezone string is provided', () => {
      const timestamp = '2026-10-15T14:00:00Z';
      // In UTC, 14:00 is 02:00 PM
      expect(formatTimeInTimezone(timestamp, 'Invalid/Timezone_Name')).toBe('02:00 PM');
    });

    it('handles receptionist conversation records with missing or malformed optional timestamps', () => {
      const malformedConversation = {
        id: 'conv-123',
        lastActivity: undefined,
        lastMessageAt: null,
        updatedAt: 'malformed-time',
      };

      const result = formatTimeInTimezone(
        malformedConversation.lastActivity ||
        malformedConversation.lastMessageAt ||
        malformedConversation.updatedAt,
        'America/New_York'
      );
      expect(result).toBe('—');
    });

    it('throws descriptive error on malformed time string for toUtcIsoInTimezone', () => {
      expect(() => toUtcIsoInTimezone('2026-10-15', 'invalid-time', 'America/New_York')).toThrow(
        /Invalid time format/
      );
    });
  });
});
