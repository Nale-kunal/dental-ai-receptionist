/**
 * Timezone-aware date & time utilities for Dental Clinic Admin Dashboard.
 *
 * Ensures all appointment dates, times, and schedule slots are displayed
 * and interpreted in the clinic's authoritative timezone (e.g., 'America/New_York')
 * rather than the client browser's local timezone.
 */

export interface FormatOptions extends Intl.DateTimeFormatOptions {
  locale?: string;
}

/**
 * Normalizes any date input (string, Date, epoch number, null, undefined, or custom timestamp object)
 * into a valid Date object. Returns null if input is missing or cannot be parsed.
 *
 * Never throws 'd.getTime is not a function' or crashes the render loop.
 */
export function normalizeDate(input: unknown): Date | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }

  let d: Date;

  if (input instanceof Date) {
    d = input;
  } else if (typeof input === 'number') {
    if (isNaN(input) || !isFinite(input)) return null;
    // Handle both milliseconds (>1e11) and seconds (<=1e11) epoch timestamps
    d = input > 1e11 ? new Date(input) : new Date(input * 1000);
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Check if numeric string
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      d = num > 1e11 ? new Date(num) : new Date(num * 1000);
    } else {
      d = new Date(trimmed);
    }
  } else if (typeof input === 'object' && input !== null) {
    const obj = input as any;
    if (typeof obj.toDate === 'function') {
      d = obj.toDate();
    } else if (typeof obj.toISOString === 'function') {
      d = new Date(obj.toISOString());
    } else if (typeof obj.seconds === 'number') {
      d = new Date(obj.seconds * 1000);
    } else if (typeof obj.getTime === 'function') {
      d = input as Date;
    } else {
      return null;
    }
  } else {
    return null;
  }

  return isNaN(d.getTime()) ? null : d;
}

/**
 * Validates and normalizes an IANA timezone string.
 * Falls back safely to 'UTC' if the timezone is invalid or unsupported by Intl.
 */
export function getSafeTimezone(timeZone?: string): string {
  if (!timeZone || typeof timeZone !== 'string') return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Formats a UTC date/timestamp string, epoch number, or Date into a localized date string in the clinic's timezone.
 * Defaults to 'en-US' locale and MM/DD/YYYY format.
 */
export function formatDateInTimezone(
  dateInput: unknown,
  timeZone?: string,
  options?: FormatOptions
): string {
  const d = normalizeDate(dateInput);
  if (!d) return '—';

  const safeTz = getSafeTimezone(timeZone);
  const { locale = 'en-US', ...formatOptions } = options || {};

  try {
    return d.toLocaleDateString(locale, {
      timeZone: safeTz,
      ...formatOptions,
    });
  } catch {
    try {
      return d.toLocaleDateString('en-US', { timeZone: 'UTC' });
    } catch {
      return '—';
    }
  }
}

/**
 * Formats a UTC date/timestamp string, epoch number, or Date into a localized time string in the clinic's timezone.
 * Defaults to 12-hour format with AM/PM (e.g. '10:00 AM').
 */
export function formatTimeInTimezone(
  dateInput: unknown,
  timeZone?: string,
  options?: FormatOptions
): string {
  const d = normalizeDate(dateInput);
  if (!d) return '—';

  const safeTz = getSafeTimezone(timeZone);
  const { locale = 'en-US', ...formatOptions } = options || {};

  try {
    return d.toLocaleTimeString(locale, {
      timeZone: safeTz,
      hour: '2-digit',
      minute: '2-digit',
      ...formatOptions,
    });
  } catch {
    try {
      return d.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }
}

/**
 * Formats a UTC date/timestamp string, epoch number, or Date into a localized date and time string in the clinic's timezone.
 * E.g., '10/15/2026 at 10:00 AM'.
 */
export function formatDateTimeInTimezone(
  dateInput: unknown,
  timeZone?: string,
  options?: FormatOptions
): string {
  const d = normalizeDate(dateInput);
  if (!d) return '—';

  const datePart = formatDateInTimezone(d, timeZone, options);
  const timePart = formatTimeInTimezone(d, timeZone, options);
  if (datePart === '—' && timePart === '—') return '—';
  if (datePart === '—') return timePart;
  if (timePart === '—') return datePart;
  return `${datePart} at ${timePart}`;
}

/**
 * Converts a local clinic date string ('YYYY-MM-DD') and local clinic time string ('HH:mm' or 'HH:mm:ss' or 'HH:mm AM/PM')
 * in the specified clinic timeZone into an authoritative ISO UTC string (e.g. '2026-10-15T14:00:00.000Z').
 */
export function toUtcIsoInTimezone(
  dateStr: string,
  timeStr: string,
  timeZone: string = 'UTC'
): string {
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim();

  // Match 24h or 12h time
  const match = cleanTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i);
  if (!match) {
    throw new Error(`Invalid time format '${timeStr}'. Expected HH:mm or HH:mm AM/PM.`);
  }

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = match[3] ? parseInt(match[3], 10) : 0;
  const mer = match[4] ? match[4].toUpperCase() : null;

  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;

  const [year, month, day] = cleanDate.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date format '${dateStr}'. Expected YYYY-MM-DD.`);
  }

  // Create initial UTC guess
  let d = new Date(Date.UTC(year, month - 1, day, h, m, s));

  // Determine timezone offset difference by formatting d in the target timeZone
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  // Iteratively converge to the exact minute
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
    let tzH = parseInt(parts.hour, 10);
    if (tzH === 24) tzH = 0;
    const tzM = parseInt(parts.minute, 10);
    const tzDay = parseInt(parts.day, 10);

    const diffMinutes = (day - tzDay) * 24 * 60 + (h - tzH) * 60 + (m - tzM);
    if (diffMinutes === 0) break;
    d = new Date(d.getTime() + diffMinutes * 60000);
  }

  return d.toISOString();
}
