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
import { getCalendarClient, CALENDAR_ID, getBusyWindows } from './_lib/google.js';
import { json } from './_lib/http.js';
import { signAction } from './_lib/sign.js';

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

  // Pre-check across all calendars (work, kids' sports, etc.) — catches the
  // common case where a busy event landed between page load and submit.
  const buffer = config.availability.bufferMinutes * 60_000;
  const checkStart = new Date(start.getTime() - buffer).toISOString();
  const checkEnd = new Date(end.getTime() + buffer).toISOString();
  try {
    const busy = await getBusyWindows(calendar, checkStart, checkEnd);
    if (busy.some((b) => intervalsOverlap(start, end, b.start, b.end))) {
      return json({ error: 'Slot no longer available' }, 409);
    }
  } catch (err) {
    console.error('Pre-insert freebusy failed', err);
    return json({ error: 'Calendar lookup failed' }, 500);
  }

  const bookingId = randomUUID();
  const description = buildDescription({ name, email, timezone, answers, meetingType });
  let inserted;
  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `${meetingType.name} with ${name}`,
        description,
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString() },
        attendees: [
          { email: config.owner.email, organizer: true },
          { email, displayName: name },
        ],
        conferenceData: {
          createRequest: {
            requestId: bookingId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
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

  // GCal's privateExtendedProperty filter requires an exact value match — no
  // wildcards — so we list all events in the slot window and filter for our
  // tag in memory. (Earlier `<key>=*` form silently returned zero matches.)
  try {
    const list = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: checkStart,
      timeMax: checkEnd,
      singleEvents: true,
    });
    const overlapping = (list.data.items ?? []).filter((ev) => {
      if (!ev.extendedProperties?.private?.[BOOKING_PROP_KEY]) return false;
      if (!ev.start?.dateTime || !ev.end?.dateTime) return false;
      return intervalsOverlap(start, end, ev.start.dateTime, ev.end.dateTime);
    });
    if (overlapping.length > 1) {
      const winner = overlapping
        .map((ev) => ({ ev, created: Date.parse(ev.created) }))
        .sort((a, b) => a.created - b.created)[0].ev;
      if (winner.id !== inserted.id) {
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: inserted.id, sendUpdates: 'none' })
          .catch((e) => console.error('Self-delete failed', e));
        return json({ error: 'Slot no longer available' }, 409);
      }
    }
  } catch (err) {
    console.error('Reconciliation list failed (proceeding)', err);
  }

  await sendEmails({ name, email, timezone, slot, meetingType, eventId: inserted.id }).catch((e) => {
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

function formatInZone(slot, timezone) {
  return new Date(slot).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short',
  });
}

async function sendEmails({ name, email, timezone, slot, meetingType, eventId }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping emails');
    return;
  }
  const resend = new Resend(apiKey);
  const guestTime = formatInZone(slot, timezone);
  const ownerTime = formatInZone(slot, config.owner.timezone);

  const baseUrl = (process.env.URL || process.env.SCHEDULER_BASE_URL || '').replace(/\/$/, '');
  const acceptUrl = baseUrl
    && `${baseUrl}/api/respond?event=${encodeURIComponent(eventId)}&action=accept&token=${signAction(eventId, 'accept')}`;
  const declineUrl = baseUrl
    && `${baseUrl}/api/respond?event=${encodeURIComponent(eventId)}&action=decline&token=${signAction(eventId, 'decline')}`;

  const actionButtons = (acceptUrl && declineUrl) ? `
    <p style="margin-top: 24px;">
      <a href="${acceptUrl}" style="display: inline-block; padding: 10px 18px; background: #16a34a; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">Accept</a>
      <a href="${declineUrl}" style="display: inline-block; padding: 10px 18px; background: #fff; color: #b91c1c; border: 1px solid #b91c1c; text-decoration: none; border-radius: 6px; margin-left: 8px; font-weight: 500;">Decline / cancel</a>
    </p>
    <p style="font-size: 12px; color: #888;">Accept makes your response visible to the guest. Decline cancels the booking and notifies them.</p>
  ` : '';

  await Promise.all([
    resend.emails.send({
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
    }),
    resend.emails.send({
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
        ${actionButtons}
      `,
    }),
  ]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
