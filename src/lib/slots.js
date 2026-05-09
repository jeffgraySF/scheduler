// Pure slot-generation logic. No I/O.
//
// Given a calendar date (in the owner's timezone), the owner's availability
// rules, and a meeting duration, produce candidate slot start times as UTC
// ISO strings. The Netlify function then filters these against GCal freebusy.

import { fromZonedTime } from 'date-fns-tz';

/**
 * @param {object} args
 * @param {string} args.date              ISO date string "YYYY-MM-DD" in owner timezone
 * @param {object} args.availability      config.availability
 * @param {number} args.durationMinutes
 * @param {string} args.ownerTimezone     IANA timezone, e.g. "America/Los_Angeles"
 * @returns {string[]} array of UTC ISO strings for slot start times
 */
export function generateCandidateSlots({ date, availability, durationMinutes, ownerTimezone }) {
  const { days, startHour, endHour, bufferMinutes } = availability;

  const dayOfWeek = getDayOfWeekInZone(date, ownerTimezone);
  if (!days.includes(dayOfWeek)) return [];

  const stepMinutes = durationMinutes + bufferMinutes;
  const startMinute = startHour * 60;
  const endMinute = endHour * 60;
  const lastValidStart = endMinute - durationMinutes;

  const slots = [];
  for (let m = startMinute; m <= lastValidStart; m += stepMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const localIso = `${date}T${hh}:${mm}:00`;
    const utcDate = fromZonedTime(localIso, ownerTimezone);
    slots.push(utcDate.toISOString());
  }
  return slots;
}

/**
 * Day of week (0=Sun..6=Sat) for a YYYY-MM-DD date interpreted in the given zone.
 */
function getDayOfWeekInZone(dateStr, timezone) {
  const noonUtc = fromZonedTime(`${dateStr}T12:00:00`, timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const wk = formatter.format(noonUtc);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wk];
}

/**
 * Returns true if [startA, endA) overlaps [startB, endB). Times are Date or ISO strings.
 */
export function intervalsOverlap(startA, endA, startB, endB) {
  const a1 = new Date(startA).getTime();
  const a2 = new Date(endA).getTime();
  const b1 = new Date(startB).getTime();
  const b2 = new Date(endB).getTime();
  return a1 < b2 && b1 < a2;
}
