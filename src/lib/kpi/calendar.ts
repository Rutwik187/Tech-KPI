import { TZDate } from '@date-fns/tz';

export interface WorkCalendar {
  timezone: string;
  workingDays: number[];
  workdayStart: string;
  workdayEnd: string;
  holidays: Set<string>;
  extraDaysOff?: Set<string>;
}

const HOUR_MS = 60 * 60 * 1000;

export function dateKey(input: Date | string, timezone = 'Asia/Kolkata'): string {
  const date = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? localDate(input, '00:00', timezone)
    : new TZDate(typeof input === 'string' ? new Date(input) : input, timezone);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A date and clock time are interpreted in the selected office timezone. */
export function localDate(date: string, time = '00:00', timezone = 'Asia/Kolkata'): TZDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError('Use a valid date and a time in HH:mm format.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const result = new TZDate(year, month - 1, day, hour, minute, 0, 0, timezone);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new RangeError('Invalid date.');
  }
  return result;
}

export function shiftDate(date: string, days: number, timezone = 'Asia/Kolkata'): string {
  const result = localDate(date, '12:00', timezone);
  result.setDate(result.getDate() + days);
  return dateKey(result, timezone);
}

export function isWorkingDay(date: string, calendar: WorkCalendar): boolean {
  const weekday = localDate(date, '12:00', calendar.timezone).getDay() || 7;
  return calendar.workingDays.includes(weekday)
    && !calendar.holidays.has(date)
    && !calendar.extraDaysOff?.has(date);
}

function validateCalendar(calendar: WorkCalendar) {
  if (!calendar.workingDays.some((day) => day >= 1 && day <= 7)) {
    throw new RangeError('Select at least one working day.');
  }
  if (calendar.workdayEnd <= calendar.workdayStart) {
    throw new RangeError('Office hours must end after they start.');
  }
  localDate('2026-01-01', calendar.workdayStart, calendar.timezone);
  localDate('2026-01-01', calendar.workdayEnd, calendar.timezone);
}

/** Counts elapsed time only during office hours. Leave and holidays pause the clock. */
export function workingHoursBetween(start: Date, end: Date, calendar: WorkCalendar): number {
  validateCalendar(calendar);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new RangeError('Invalid date.');
  }
  if (end <= start) return 0;
  let date = dateKey(start, calendar.timezone);
  const last = dateKey(end, calendar.timezone);
  let milliseconds = 0;
  while (date <= last) {
    if (isWorkingDay(date, calendar)) {
      const officeStart = localDate(date, calendar.workdayStart, calendar.timezone).getTime();
      const officeEnd = localDate(date, calendar.workdayEnd, calendar.timezone).getTime();
      milliseconds += Math.max(0, Math.min(end.getTime(), officeEnd) - Math.max(start.getTime(), officeStart));
    }
    date = shiftDate(date, 1, calendar.timezone);
  }
  return milliseconds / HOUR_MS;
}

/** Moves forward in working time, preserving a deadline exactly at office closing. */
export function addWorkingHours(start: Date, hours: number, calendar: WorkCalendar): Date {
  validateCalendar(calendar);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(hours) || hours < 0) {
    throw new RangeError('Use a valid start time and non-negative hours.');
  }
  let date = dateKey(start, calendar.timezone);
  let cursor = start.getTime();
  let remaining = hours * HOUR_MS;
  // Avoid an infinite loop when a malformed calendar lists only excluded dates.
  for (let searchedDays = 0; searchedDays < 36_600; searchedDays++) {
    if (isWorkingDay(date, calendar)) {
      const officeStart = localDate(date, calendar.workdayStart, calendar.timezone).getTime();
      const officeEnd = localDate(date, calendar.workdayEnd, calendar.timezone).getTime();
      cursor = Math.max(cursor, officeStart);
      if (cursor < officeEnd) {
        const available = officeEnd - cursor;
        if (remaining <= available) return new Date(cursor + remaining);
        remaining -= available;
      }
    }
    date = shiftDate(date, 1, calendar.timezone);
    cursor = localDate(date, '00:00', calendar.timezone).getTime();
  }
  throw new RangeError('Cannot find a working deadline in this calendar.');
}
