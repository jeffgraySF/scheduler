// POST /.netlify/functions/book
// Body: { type, slot, name, email, timezone, answers }
//
// Race-condition guard: pre-insert freebusy check, then post-insert
// reconciliation. After creating our event, we list events overlapping the
// slot window. If multiple booking-tagged events exist (i.e. another booking
// landed concurrently), the one with the earliest `created` timestamp wins;
// the loser deletes itself and returns 409.

import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { config, getMeetingType } from '../../src/lib/config.js';
import { intervalsOverlap } from '../../src/lib/slots.js';
import { getCalendarClient, CALENDAR_ID } from './_lib/google.js';

const BOOKING_PROP_KEY = 'schedulerBookingId';

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { type, slot, name, email, timezone, answers } = body ?? {};
  if (!type || !slot || !name || !email || !timezone) {
    return json({ error: 'Missing required fields' }, 400);
  }
  const meetingType = getMeetingType(type);
  if (!meetingType) return json({ error: `Unknown meeting type: ${type}` }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Invalid email' }, 400);
  }
  // Required custom-question answers
  for (const q of meetingType.questions ?? []) {
    if (q.required && !(answers?.[q.id] ?? '').trim()) {
      return json({ error: `Answer required: ${q.label}` }, 400);
    }
  }

  const start = new Date(slot);
  if (isNaN(start.getTime())) return json({ error: 'Invalid slot' }, 400);
  const end = new Date(start.getTime() + meetingType.duration * 60_000);

  let calendar;
  try { calendar = getCalendarClient(); }
  catch (err) {
    console.error('GCal client init failed', err);
    return json({ error: 'Server misconfigured' }, 500);
  }

  // Pre-check: is the slot already taken?
  const buffer = config.availability.bufferMinutes * 60_000;
  const checkStart = new Date(start.getTime() - buffer).toISOString();
  const checkEnd = new Date(end.getTime() + buffer).toISOString();
  try {
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: checkStart,
        timeMax: checkEnd,
        items: [{ id: CALENDAR_ID }],
      },
    });
    const busy = fb.data.calendars?.[CALENDAR_ID]?.busy ?? [];
    const conflict = busy.some((b) => intervalsOverlap(start, end, b.start, b.end));
    if (conflict) return json({ error: 'Slot no longer available' }, 409);
  } catch (err) {
    console.error('Pre-insert freebusy failed', err);
    return json({ error: 'Calendar lookup failed' }, 500);
  }

  // Insert the event tagged with a unique booking id.
  const bookingId = randomUUID();
  const description = buildDescription({ name, email, timezone, answers, meetingType });
  let inserted;
  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      requestBody: {
        summary: `${meetingType.name} with ${name}`,
        description,
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString() },
        attendees: [
          { email: config.owner.email, organizer: true },
          { email, displayName: name },
        ],
        extendedProperties: {
          private: { [BOOKING_PROP_KEY]: bookingId },
        },
      },
    });
    inserted = res.data;
  } catch (err) {
    console.error('GCal insert failed', err);
    return json({ error: 'Could not create calendar event' }, 500);
  }

  // Post-insert reconciliation: did anyone else slip in?
  try {
    const list = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: checkStart,
      timeMax: checkEnd,
      singleEvents: true,
      privateExtendedProperty: `${BOOKING_PROP_KEY}=*`, // any value
    });
    const ours = inserted;
    const overlapping = (list.data.items ?? []).filter((ev) => {
      if (!ev.start?.dateTime || !ev.end?.dateTime) return false;
      return intervalsOverlap(start, end, ev.start.dateTime, ev.end.dateTime);
    });
    if (overlapping.length > 1) {
      const sorted = overlapping
        .map((ev) => ({ ev, created: new Date(ev.created).getTime() }))
        .sort((a, b) => a.created - b.created);
      const winner = sorted[0].ev;
      if (winner.id !== ours.id) {
        // We lost — delete ourselves and return 409.
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: ours.id, sendUpdates: 'none' }).catch((e) => console.error('Self-delete failed', e));
        return json({ error: 'Slot no longer available' }, 409);
      }
    }
  } catch (err) {
    // Reconciliation failure isn't fatal — log and proceed. The pre-check
    // already filtered most collisions; this is a best-effort second line.
    console.error('Reconciliation list failed (proceeding)', err);
  }

  // Send emails (don't block response on failures — log and continue).
  await sendEmails({ name, email, timezone, slot, meetingType }).catch((e) => {
    console.error('Email send failed', e);
  });

  return json({ ok: true, eventId: inserted.id, slot: start.toISOString() });
};

function buildDescription({ name, email, timezone, answers, meetingType }) {
  const lines = [
    `Booked via scheduler.`,
    ``,
    `Guest: ${name} <${email}>`,
    `Guest timezone: ${timezone}`,
    ``,
  ];
  for (const q of meetingType.questions ?? []) {
    const a = answers?.[q.id];
    if (a) lines.push(`${q.label}\n${a}\n`);
  }
  return lines.join('\n');
}

async function sendEmails({ name, email, timezone, slot, meetingType }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping emails');
    return;
  }
  const resend = new Resend(apiKey);

  const guestTime = new Date(slot).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short',
  });
  const ownerTime = new Date(slot).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: config.owner.timezone, timeZoneName: 'short',
  });

  // Guest confirmation — replies go to the owner's real inbox
  await resend.emails.send({
    from,
    to: email,
    replyTo: config.owner.email,
    subject: `Your ${meetingType.name} with ${config.owner.name} is confirmed`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your ${escapeHtml(meetingType.name)} with ${escapeHtml(config.owner.name)} is confirmed for <strong>${escapeHtml(guestTime)}</strong>.</p>
      <p>You'll receive a Google Calendar invite shortly. Reply to this email if anything changes.</p>
      <p>— ${escapeHtml(config.owner.name)}</p>
    `,
  });

  // Owner notification — replies go directly to the guest
  await resend.emails.send({
    from,
    to: config.owner.email,
    replyTo: email,
    subject: `New booking: ${meetingType.name} with ${name}`,
    html: `
      <p>New ${escapeHtml(meetingType.name)} booking.</p>
      <ul>
        <li><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</li>
        <li>Time (your tz): ${escapeHtml(ownerTime)}</li>
        <li>Time (guest tz): ${escapeHtml(guestTime)}</li>
      </ul>
    `,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
