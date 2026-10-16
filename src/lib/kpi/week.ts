import { dateKey, localDate, shiftDate } from './calendar';

export function getWeekStart(input: Date | string = new Date(), timezone = 'Asia/Kolkata'): string {
  const key = dateKey(input, timezone);
  const weekday = localDate(key, '12:00', timezone).getDay() || 7;
  return shiftDate(key, 1 - weekday, timezone);
}

export const weekStartOf = getWeekStart;

export function getWeekRange(weekStart: string, timezone = 'Asia/Kolkata'): { start: Date; end: Date } {
  const monday = getWeekStart(weekStart, timezone);
  return {
    start: new Date(localDate(monday, '00:00', timezone).getTime()),
    end: new Date(localDate(shiftDate(monday, 7, timezone), '00:00', timezone).getTime() - 1),
  };
}

export function previousWeekStart(weekStart: string, timezone = 'Asia/Kolkata'): string {
  return shiftDate(getWeekStart(weekStart, timezone), -7, timezone);
}

export function listWeekStarts(from: string, to: string, timezone = 'Asia/Kolkata'): string[] {
  const weeks: string[] = [];
  let cursor = getWeekStart(from, timezone);
  const last = getWeekStart(to, timezone);
  while (cursor <= last) {
    weeks.push(cursor);
    cursor = shiftDate(cursor, 7, timezone);
  }
  return weeks;
}

/** Monthly reports include only weeks whose Monday belongs to the month. */
export function monthWeekStarts(month: string, timezone = 'Asia/Kolkata'): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RangeError('Use a month in YYYY-MM format.');
  const first = `${month}-01`;
  localDate(first, '00:00', timezone);
  let cursor = getWeekStart(first, timezone);
  if (cursor < first) cursor = shiftDate(cursor, 7, timezone);
  const weeks: string[] = [];
  while (cursor.startsWith(month)) {
    weeks.push(cursor);
    cursor = shiftDate(cursor, 7, timezone);
  }
  return weeks;
}
