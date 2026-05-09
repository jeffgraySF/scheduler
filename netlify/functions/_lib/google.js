// Shared GCal client for Netlify functions.

import { google } from 'googleapis';

export function getCalendarClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google OAuth env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
  }

  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  return google.calendar({ version: 'v3', auth: oauth2 });
}

// Calendar to write bookings to.
export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// Calendar IDs are stable across requests; we cache them on the warm Lambda
// to avoid an extra calendarList.list() per availability/book call.
const CALENDAR_IDS_TTL_MS = 10 * 60_000;
let calendarIdsCache = null; // { ids, expires }

async function fetchConflictCalendarIds(calendar) {
  const { data } = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const ids = (data.items ?? [])
    .filter((c) => !c.hidden && c.selected === true)
    .map((c) => c.id);
  if (!ids.includes(CALENDAR_ID)) ids.push(CALENDAR_ID);
  return ids;
}

// Returns every calendar the user has currently "shown" in their GCal UI
// (`selected: true`) — Calendly-equivalent. Hidden and default-off
// calendars are skipped. The booking calendar is always included.
export async function getConflictCalendarIds(calendar) {
  const now = Date.now();
  if (calendarIdsCache && calendarIdsCache.expires > now) return calendarIdsCache.ids;
  const ids = await fetchConflictCalendarIds(calendar);
  calendarIdsCache = { ids, expires: now + CALENDAR_IDS_TTL_MS };
  return ids;
}

// Returns all busy windows in [timeMin, timeMax] across every conflict-checked
// calendar. timeMin/timeMax are ISO strings.
export async function getBusyWindows(calendar, timeMin, timeMax) {
  const ids = await getConflictCalendarIds(calendar);
  const { data } = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: ids.map((id) => ({ id })) },
  });
  return Object.values(data?.calendars ?? {}).flatMap((c) => c.busy ?? []);
}
