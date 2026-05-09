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

// Calendar IDs to check for free/busy conflicts. Defaults to every calendar
// the user has currently "shown" in their GCal UI (`selected: true`) — same
// behavior as Calendly. Hidden, default-unselected, and holiday-style
// calendars are skipped. Always includes the booking calendar itself.
export async function getConflictCalendarIds(calendar) {
  const { data } = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const ids = (data.items ?? [])
    .filter((c) => !c.hidden && c.selected === true)
    .map((c) => c.id);
  if (!ids.includes(CALENDAR_ID)) ids.push(CALENDAR_ID);
  return ids;
}

// Aggregate busy windows from a freebusy.query response across all calendars.
export function aggregateBusy(freebusyData) {
  return Object.values(freebusyData?.calendars ?? {}).flatMap((c) => c.busy ?? []);
}
