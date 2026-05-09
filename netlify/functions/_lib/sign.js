// HMAC signing for action links in emails (accept/decline).
// Token = first 32 hex chars of HMAC-SHA256(secret, "<eventId>|<action>").

import { createHmac, timingSafeEqual } from 'node:crypto';

function getSecret() {
  const s = process.env.SCHEDULER_SIGNING_SECRET;
  if (!s) throw new Error('SCHEDULER_SIGNING_SECRET not set');
  return s;
}

export function signAction(eventId, action) {
  return createHmac('sha256', getSecret())
    .update(`${eventId}|${action}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyAction(eventId, action, token) {
  if (!token || typeof token !== 'string') return false;
  const expected = signAction(eventId, action);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
