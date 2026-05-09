// GET  /api/respond?event=<id>&action=accept&token=<sig>   → accept (one-click)
// GET  /api/respond?event=<id>&action=decline&token=<sig>  → confirmation page
// POST /api/respond?event=<id>&action=decline&token=<sig>  → cancel the event
//
// Signed with HMAC so only the recipient of the owner-notification email can
// act. The two-step decline guards against URL pre-fetchers (corporate
// antivirus, link previewers) that would otherwise cancel the event just by
// inspecting the email.

import { config } from '../../src/lib/config.js';
import { getCalendarClient, CALENDAR_ID } from './_lib/google.js';
import { verifyAction } from './_lib/sign.js';

export default async (request) => {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event');
  const action  = url.searchParams.get('action');
  const token   = url.searchParams.get('token');

  if (!eventId || !action || !token) return page('Invalid link', 'This link is missing required parameters.', 400);
  if (!['accept', 'decline'].includes(action)) return page('Invalid link', 'Unknown action.', 400);
  if (!verifyAction(eventId, action, token)) return page('Invalid link', 'This link is no longer valid.', 403);

  let calendar;
  try { calendar = getCalendarClient(); }
  catch (err) {
    console.error('GCal client init failed', err);
    return page('Server error', 'Could not reach Google Calendar.', 500);
  }

  if (action === 'accept') return handleAccept(calendar, eventId);
  if (action === 'decline' && request.method === 'POST') return handleDecline(calendar, eventId);
  return declineConfirmPage(eventId, token);
};

async function handleAccept(calendar, eventId) {
  let ev;
  try { ev = (await calendar.events.get({ calendarId: CALENDAR_ID, eventId })).data; }
  catch { return page('Not found', 'This booking no longer exists.', 404); }

  const ownerEmail = config.owner.email;
  const attendees = (ev.attendees ?? []).map((a) =>
    a.email === ownerEmail ? { ...a, responseStatus: 'accepted' } : a
  );
  if (!attendees.some((a) => a.email === ownerEmail)) {
    attendees.push({ email: ownerEmail, responseStatus: 'accepted', organizer: true });
  }

  try {
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates: 'all',
      requestBody: { attendees },
    });
  } catch (err) {
    console.error('Accept patch failed', err);
    return page('Error', 'Could not record your response.', 500);
  }
  return page('Accepted ✓', `You've accepted this booking. The guest will see your response.`);
}

async function handleDecline(calendar, eventId) {
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: 'all' });
  } catch (err) {
    if (err?.code === 404 || err?.code === 410) {
      return page('Already cancelled', 'This booking is already cancelled.', 200);
    }
    console.error('Decline delete failed', err);
    return page('Error', 'Could not cancel the booking.', 500);
  }
  return page('Cancelled', 'The booking has been cancelled and the guest has been notified.');
}

function declineConfirmPage(eventId, token) {
  const body = `
    <h1>Cancel this booking?</h1>
    <p>The guest will be notified that the meeting was cancelled.</p>
    <form method="POST" action="/api/respond?event=${encodeURIComponent(eventId)}&action=decline&token=${encodeURIComponent(token)}" style="margin-top: 1.5rem;">
      <button type="submit" class="btn danger">Yes, cancel the booking</button>
      <a href="https://calendar.google.com/" class="btn ghost">Keep it</a>
    </form>
  `;
  return htmlResponse('Cancel booking?', body);
}

function page(title, message, status = 200) {
  const body = `
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="https://calendar.google.com/">Open Google Calendar →</a></p>
  `;
  return htmlResponse(title, body, status);
}

function htmlResponse(title, body, status = 200) {
  const doc = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — scheduler</title>
<style>
  body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1.5rem; color: #1c1917; }
  h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
  a { color: #c2410c; }
  .btn { display: inline-block; padding: 0.625rem 1rem; border: 1px solid #d4d4d4; border-radius: 6px; background: #fafafa; color: #1c1917; text-decoration: none; font: inherit; cursor: pointer; }
  .btn.danger { background: #c2410c; color: #fff; border-color: #c2410c; }
  .btn.ghost { margin-left: 0.5rem; }
</style>
</head><body>${body}</body></html>`;
  return new Response(doc, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
