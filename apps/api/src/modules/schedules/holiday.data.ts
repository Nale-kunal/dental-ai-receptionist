/**
 * Authoritative, location-aware public holiday dataset and generator
 * Supporting multi-national dental clinics (US, GB, CA, AU, IN).
 * Dynamically computes fixed-date and floating holidays (e.g. Memorial Day, Thanksgiving).
 */

export interface BaseHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  countryCode: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, n: number): string {
  // dayOfWeek: 0 = Sunday, 1 = Monday, etc.
  const firstDay = new Date(year, month - 1, 1).getDay();
  let day = 1 + ((dayOfWeek - firstDay + 7) % 7) + (n - 1) * 7;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function lastWeekdayOfMonth(year: number, month: number, dayOfWeek: number): string {
  const lastDate = new Date(year, month, 0).getDate();
  const lastDay = new Date(year, month - 1, lastDate).getDay();
  const day = lastDate - ((lastDay - dayOfWeek + 7) % 7);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Easter calculation (Meeus/Jones/Butcher algorithm)
function getEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addFixedHoliday(
  list: BaseHoliday[],
  year: number,
  month: number,
  day: number,
  name: string,
  countryCode: string,
  addObserved: boolean = true
) {
  const actualDate = `${year}-${pad(month)}-${pad(day)}`;
  list.push({ date: actualDate, name, countryCode });

  if (addObserved) {
    const d = new Date(year, month - 1, day);
    const dow = d.getDay();
    if (dow === 6) {
      // Saturday -> Observed on preceding Friday
      const obs = new Date(year, month - 1, day - 1);
      const obsDate = `${obs.getFullYear()}-${pad(obs.getMonth() + 1)}-${pad(obs.getDate())}`;
      list.push({ date: obsDate, name: `${name} (Observed)`, countryCode });
    } else if (dow === 0) {
      // Sunday -> Observed on following Monday
      const obs = new Date(year, month - 1, day + 1);
      const obsDate = `${obs.getFullYear()}-${pad(obs.getMonth() + 1)}-${pad(obs.getDate())}`;
      list.push({ date: obsDate, name: `${name} (Observed)`, countryCode });
    }
  }
}

export function getPublicHolidays(countryCode: string = 'US', year: number = new Date().getFullYear()): BaseHoliday[] {
  const code = (countryCode || 'US').toUpperCase().trim();
  const holidays: BaseHoliday[] = [];

  const easter = getEaster(year);
  const easterDate = new Date(year, easter.month - 1, easter.day);

  const goodFridayDate = new Date(easterDate);
  goodFridayDate.setDate(easterDate.getDate() - 2);
  const goodFridayStr = `${year}-${pad(goodFridayDate.getMonth() + 1)}-${pad(goodFridayDate.getDate())}`;

  const easterMondayDate = new Date(easterDate);
  easterMondayDate.setDate(easterDate.getDate() + 1);
  const easterMondayStr = `${year}-${pad(easterMondayDate.getMonth() + 1)}-${pad(easterMondayDate.getDate())}`;

  if (code === 'US') {
    addFixedHoliday(holidays, year, 1, 1, "New Year's Day", 'US');
    holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: 'Martin Luther King Jr. Day', countryCode: 'US' });
    holidays.push({ date: nthWeekdayOfMonth(year, 2, 1, 3), name: "Presidents' Day", countryCode: 'US' });
    holidays.push({ date: lastWeekdayOfMonth(year, 5, 1), name: 'Memorial Day', countryCode: 'US' });
    addFixedHoliday(holidays, year, 6, 19, 'Juneteenth National Independence Day', 'US');
    addFixedHoliday(holidays, year, 7, 4, 'Independence Day (4th of July)', 'US');
    holidays.push({ date: nthWeekdayOfMonth(year, 9, 1, 1), name: 'Labor Day', countryCode: 'US' });
    holidays.push({ date: nthWeekdayOfMonth(year, 10, 1, 2), name: 'Columbus Day / Indigenous Peoples Day', countryCode: 'US' });
    addFixedHoliday(holidays, year, 11, 11, 'Veterans Day', 'US');
    holidays.push({ date: nthWeekdayOfMonth(year, 11, 4, 4), name: 'Thanksgiving Day', countryCode: 'US' });
    addFixedHoliday(holidays, year, 12, 25, 'Christmas Day', 'US');
  } else if (code === 'GB' || code === 'UK') {
    addFixedHoliday(holidays, year, 1, 1, "New Year's Day", 'GB');
    holidays.push(
      { date: goodFridayStr, name: 'Good Friday', countryCode: 'GB' },
      { date: easterMondayStr, name: 'Easter Monday', countryCode: 'GB' },
      { date: nthWeekdayOfMonth(year, 5, 1, 1), name: 'Early May Bank Holiday', countryCode: 'GB' },
      { date: lastWeekdayOfMonth(year, 5, 1), name: 'Spring Bank Holiday', countryCode: 'GB' },
      { date: lastWeekdayOfMonth(year, 8, 1), name: 'Summer Bank Holiday', countryCode: 'GB' }
    );
    // UK Christmas & Boxing Day substitute rules
    const xDow = new Date(year, 11, 25).getDay();
    if (xDow === 6) {
      // Sat Dec 25 -> Mon Dec 27 is Christmas sub, Tue Dec 28 is Boxing Day sub
      holidays.push(
        { date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'GB' },
        { date: `${year}-12-26`, name: 'Boxing Day', countryCode: 'GB' },
        { date: `${year}-12-27`, name: 'Christmas Day (Substitute Day)', countryCode: 'GB' },
        { date: `${year}-12-28`, name: 'Boxing Day (Substitute Day)', countryCode: 'GB' }
      );
    } else if (xDow === 0) {
      // Sun Dec 25 -> Tue Dec 27 is Christmas sub, Mon Dec 26 is Boxing Day
      holidays.push(
        { date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'GB' },
        { date: `${year}-12-26`, name: 'Boxing Day', countryCode: 'GB' },
        { date: `${year}-12-27`, name: 'Christmas Day (Substitute Day)', countryCode: 'GB' }
      );
    } else if (xDow === 5) {
      // Fri Dec 25, Sat Dec 26 -> Mon Dec 28 is Boxing Day sub
      holidays.push(
        { date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'GB' },
        { date: `${year}-12-26`, name: 'Boxing Day', countryCode: 'GB' },
        { date: `${year}-12-28`, name: 'Boxing Day (Substitute Day)', countryCode: 'GB' }
      );
    } else {
      holidays.push(
        { date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'GB' },
        { date: `${year}-12-26`, name: 'Boxing Day', countryCode: 'GB' }
      );
    }
  } else if (code === 'CA') {
    addFixedHoliday(holidays, year, 1, 1, "New Year's Day", 'CA');
    holidays.push({ date: goodFridayStr, name: 'Good Friday', countryCode: 'CA' });
    holidays.push({ date: lastWeekdayOfMonth(year, 5, 1), name: 'Victoria Day', countryCode: 'CA' });
    addFixedHoliday(holidays, year, 7, 1, 'Canada Day', 'CA');
    holidays.push({ date: nthWeekdayOfMonth(year, 9, 1, 1), name: 'Labour Day', countryCode: 'CA' });
    holidays.push({ date: nthWeekdayOfMonth(year, 10, 1, 2), name: 'Thanksgiving', countryCode: 'CA' });
    addFixedHoliday(holidays, year, 11, 11, 'Remembrance Day', 'CA');
    addFixedHoliday(holidays, year, 12, 25, 'Christmas Day', 'CA');
    addFixedHoliday(holidays, year, 12, 26, 'Boxing Day', 'CA');
  } else if (code === 'AU') {
    addFixedHoliday(holidays, year, 1, 1, "New Year's Day", 'AU');
    addFixedHoliday(holidays, year, 1, 26, 'Australia Day', 'AU');
    holidays.push(
      { date: goodFridayStr, name: 'Good Friday', countryCode: 'AU' },
      { date: easterMondayStr, name: 'Easter Monday', countryCode: 'AU' }
    );
    addFixedHoliday(holidays, year, 4, 25, 'Anzac Day', 'AU');
    holidays.push({ date: nthWeekdayOfMonth(year, 6, 1, 2), name: "King's Birthday", countryCode: 'AU' });
    addFixedHoliday(holidays, year, 12, 25, 'Christmas Day', 'AU');
    addFixedHoliday(holidays, year, 12, 26, 'Boxing Day', 'AU');
  } else if (code === 'IN') {
    holidays.push(
      { date: `${year}-01-26`, name: 'Republic Day', countryCode: 'IN' },
      { date: goodFridayStr, name: 'Good Friday', countryCode: 'IN' },
      { date: `${year}-08-15`, name: 'Independence Day', countryCode: 'IN' },
      { date: `${year}-10-02`, name: 'Mahatma Gandhi Jayanti', countryCode: 'IN' },
      { date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'IN' }
    );
  } else {
    // International standard holidays
    addFixedHoliday(holidays, year, 1, 1, "New Year's Day", code);
    holidays.push(
      { date: goodFridayStr, name: 'Good Friday', countryCode: code },
      { date: `${year}-05-01`, name: 'Labor Day', countryCode: code }
    );
    addFixedHoliday(holidays, year, 12, 25, 'Christmas Day', code);
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}
