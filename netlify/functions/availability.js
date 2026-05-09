// GET /.netlify/functions/availability?type=<slug>&date=<YYYY-MM-DD>&tz=<IANA>
// Returns slot start times (UTC ISO strings) that are open for booking.

import { config, getMeetingType } from '../../src/lib/config.js';
import { generateCandidateSlots, intervalsOverlap } from '../../src/lib/slots.js';
import { getCalendarClient, CALENDAR_ID, getConflictCalendarIds, aggregateBusy } from './_lib/google.js';

export default async (request) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const date = url.searchParams.get('date');
  const tz   = url.searchParams.get('tz');

  if (!type || !date || !tz) {
    return json({ error: 'Missing required query params: type, date, tz' }, 400);
  }
  const meetingType = getMeetingType(type);
  if (!meetingType) {
    return json({ error: `Unknown meeting type: ${type}` }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  // Reject dates outside the booking window.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requested = new Date(`${date}T00:00:00`);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + config.bookingWindowDays);
  if (requested < today || requested > maxDate) {
    return json({ slots: [], timezone: config.owner.timezone });
  }

  const candidates = generateCandidateSlots({
    date,
    availability: config.availability,
    durationMinutes: meetingType.duration,
    ownerTimezone: config.owner.timezone,
  });
  if (candidates.length === 0) {
    return json({ slots: [], timezone: config.owner.timezone });
  }

  // Query GCal freebusy for the day window.
  const dayStartUtc = new Date(candidates[0]);
  const dayEndUtc = new Date(new Date(candidates.at(-1)).getTime() + meetingType.duration * 60_000);

  let busy = [];
  try {
    const calendar = getCalendarClient();
    const calendarIds = await getConflictCalendarIds(calendar);
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStartUtc.toISOString(),
        timeMax: dayEndUtc.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      },
    });
    busy = aggregateBusy(fb.data);
  } catch (err) {
    console.error('freebusy query failed', err);
    return json({ error: 'Calendar lookup failed' }, 500);
  }

  const buffer = config.availability.bufferMinutes * 60_000;
  const open = candidates.filter((iso) => {
    const start = new Date(iso).getTime() - buffer;
    const end = new Date(iso).getTime() + meetingType.duration * 60_000 + buffer;
    return !busy.some((b) => intervalsOverlap(start, end, b.start, b.end));
  });

  return json({ slots: open, timezone: config.owner.timezone });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
