/**
 * Shared Calendar Date & Timezone utilities.
 *
 * Provides authoritative date calculations strictly in the clinic's configured
 * IANA timezone, preventing browser-local timezone leaks, off-by-one-day errors,
 * and DST boundary issues.
 */

import {
  normalizeDate,
  getSafeTimezone,
  toUtcIsoInTimezone,
} from './dateTime.js';

export interface CalendarDayCell {
  dateStr: string; // 'YYYY-MM-DD'
  isCurrentMonth: boolean;
  dayNumber: number;
  isToday: boolean;
  weekdayIndex: number; // 0 = Mon, 6 = Sun
}

export interface PositionedAppointment {
  appointment: any;
  startMinutes: number; // minutes from midnight (0..1439)
  endMinutes: number;
  durationMinutes: number;
  column: number; // 0-indexed column within overlap cluster
  totalColumns: number; // total concurrent columns in cluster
}

/**
 * Returns today's date formatted as 'YYYY-MM-DD' in the clinic's local timezone.
 */
export function getClinicToday(timeZone?: string): string {
  const safeTz = getSafeTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(new Date());
}

/**
 * Converts any UTC date or ISO string to 'YYYY-MM-DD' in the clinic's timezone.
 */
export function getLocalDateString(utcInput: unknown, timeZone?: string): string {
  const d = normalizeDate(utcInput);
  if (!d) return '';
  const safeTz = getSafeTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(d);
}

/**
 * Returns the minutes from midnight (0..1439) in the clinic's local timezone.
 */
export function getClinicLocalTimeMinutes(utcInput: unknown, timeZone?: string): number {
  const d = normalizeDate(utcInput);
  if (!d) return 0;
  const safeTz = getSafeTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
  let h = parseInt(parts.hour, 10);
  if (h === 24) h = 0;
  const m = parseInt(parts.minute, 10);
  return h * 60 + m;
}

/**
 * Parses 'YYYY-MM-DD' into numeric parts.
 */
export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

/**
 * Formats numeric year, month, day into 'YYYY-MM-DD'.
 */
export function toDateStr(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds or subtracts days from a 'YYYY-MM-DD' string safely using pure UTC math.
 */
export function addDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toDateStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Adds or subtracts months from a 'YYYY-MM-DD' string.
 */
export function addMonths(dateStr: string, months: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  return toDateStr(targetYear, targetMonth, targetDay);
}

/**
 * Returns ISO weekday: 1 = Monday, ..., 7 = Sunday for a 'YYYY-MM-DD'.
 */
export function getIsoWeekday(dateStr: string): number {
  const { year, month, day } = parseDateParts(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay(); // 0 = Sun, 1 = Mon ...
  return (dayOfWeek + 6) % 7 + 1;
}

/**
 * Returns Monday through Sunday week boundaries and day list for any dateStr.
 */
export function getWeekRange(dateStr: string): {
  weekStart: string;
  weekEnd: string;
  days: string[];
} {
  const isoDay = getIsoWeekday(dateStr);
  const offset = isoDay - 1; // 0 for Monday, 6 for Sunday
  const weekStart = addDays(dateStr, -offset);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const weekEnd = days[6];
  return { weekStart, weekEnd, days };
}

/**
 * Returns full monthly grid (Monday-Sunday aligned) for any dateStr.
 */
export function getMonthGrid(dateStr: string, timeZone?: string): {
  year: number;
  month: number;
  days: CalendarDayCell[];
} {
  const { year, month } = parseDateParts(dateStr);
  const todayStr = getClinicToday(timeZone);

  const firstOfMonth = toDateStr(year, month, 1);
  const firstIsoDay = getIsoWeekday(firstOfMonth);
  const leadingOffset = firstIsoDay - 1; // days to back up to reach previous Monday

  const totalDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastOfMonth = toDateStr(year, month, totalDaysInMonth);
  const lastIsoDay = getIsoWeekday(lastOfMonth);
  const trailingDays = 7 - lastIsoDay; // days forward to complete Sunday

  const gridStart = addDays(firstOfMonth, -leadingOffset);
  const totalGridCells = leadingOffset + totalDaysInMonth + trailingDays;

  const days: CalendarDayCell[] = [];
  for (let i = 0; i < totalGridCells; i++) {
    const curDateStr = addDays(gridStart, i);
    const { year: curY, month: curM, day: curD } = parseDateParts(curDateStr);
    const isCurrentMonth = curY === year && curM === month;
    const weekdayIndex = i % 7; // 0 = Mon, 6 = Sun

    days.push({
      dateStr: curDateStr,
      isCurrentMonth,
      dayNumber: curD,
      isToday: curDateStr === todayStr,
      weekdayIndex,
    });
  }

  return { year, month, days };
}

/**
 * Computes authoritative UTC date boundaries [dateFrom, dateTo) for querying the appointment API.
 */
export function getDateRangeForView(
  dateStr: string,
  viewMode: 'day' | 'week' | 'month',
  timeZone?: string
): { dateFrom: string; dateTo: string } {
  const safeTz = getSafeTimezone(timeZone);

  if (viewMode === 'day') {
    const dateFrom = toUtcIsoInTimezone(dateStr, '00:00:00', safeTz);
    const dateTo = toUtcIsoInTimezone(addDays(dateStr, 1), '00:00:00', safeTz);
    return { dateFrom, dateTo };
  }

  if (viewMode === 'week') {
    const { weekStart, weekEnd } = getWeekRange(dateStr);
    const dateFrom = toUtcIsoInTimezone(weekStart, '00:00:00', safeTz);
    const dateTo = toUtcIsoInTimezone(addDays(weekEnd, 1), '00:00:00', safeTz);
    return { dateFrom, dateTo };
  }

  // Month mode: fetch entire visible calendar grid including padding days
  const grid = getMonthGrid(dateStr, safeTz);
  const firstDay = grid.days[0].dateStr;
  const lastDay = grid.days[grid.days.length - 1].dateStr;
  const dateFrom = toUtcIsoInTimezone(firstDay, '00:00:00', safeTz);
  const dateTo = toUtcIsoInTimezone(addDays(lastDay, 1), '00:00:00', safeTz);
  return { dateFrom, dateTo };
}

/**
 * Formats header title for the current calendar range (e.g. "October 2026", "Oct 12 – 18, 2026").
 */
export function formatCalendarTitle(
  dateStr: string,
  viewMode: 'day' | 'week' | 'month',
  timeZone?: string
): string {
  const safeTz = getSafeTimezone(timeZone);
  const { year, month, day } = parseDateParts(dateStr);

  if (viewMode === 'day') {
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return d.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (viewMode === 'week') {
    const { weekStart, weekEnd } = getWeekRange(dateStr);
    const { month: sm, day: sd } = parseDateParts(weekStart);
    const { year: ey, month: em, day: ed } = parseDateParts(weekEnd);

    const startD = new Date(Date.UTC(year, sm - 1, sd, 12, 0, 0));
    const endD = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));

    const startMonth = startD.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
    const endMonth = endD.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });

    if (startMonth === endMonth) {
      return `${startMonth} ${sd} – ${ed}, ${ey}`;
    }
    return `${startMonth} ${sd} – ${endMonth} ${ed}, ${ey}`;
  }

  // Month
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Layouts appointments for a single day column using collision clustering.
 * Overlapping appointments are assigned non-colliding subcolumns.
 */
export function layoutDayAppointments(
  appointments: any[],
  timeZone?: string
): PositionedAppointment[] {
  if (!appointments || appointments.length === 0) return [];

  // 1. Calculate start & end minutes in clinic timezone
  const items = appointments.map((appt) => {
    const startMinutes = getClinicLocalTimeMinutes(appt.startsAt, timeZone);
    const duration = appt.durationMinutes || 30;
    const endMinutes = startMinutes + duration;
    return {
      appointment: appt,
      startMinutes,
      endMinutes,
      durationMinutes: duration,
      column: 0,
      totalColumns: 1,
    };
  });

  // Sort by startMinutes ASC, duration DESC
  items.sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return b.durationMinutes - a.durationMinutes;
  });

  // 2. Group into collision clusters
  const clusters: typeof items[] = [];
  let currentCluster: typeof items = [];
  let clusterEnd = -1;

  for (const item of items) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterEnd = item.endMinutes;
    } else if (item.startMinutes < clusterEnd) {
      // Overlaps with current cluster
      currentCluster.push(item);
      if (item.endMinutes > clusterEnd) {
        clusterEnd = item.endMinutes;
      }
    } else {
      // Cluster finished
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.endMinutes;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // 3. For each cluster, assign columns using greedy graph coloring
  const result: PositionedAppointment[] = [];

  for (const cluster of clusters) {
    const columnEndTimes: number[] = [];

    for (const item of cluster) {
      let placed = false;
      for (let col = 0; col < columnEndTimes.length; col++) {
        if (columnEndTimes[col] <= item.startMinutes) {
          item.column = col;
          columnEndTimes[col] = item.endMinutes;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.column = columnEndTimes.length;
        columnEndTimes.push(item.endMinutes);
      }
    }

    const totalColumns = columnEndTimes.length;
    for (const item of cluster) {
      item.totalColumns = totalColumns;
      result.push(item);
    }
  }

  return result;
}
